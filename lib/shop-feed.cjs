'use strict';
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const SOURCES = Object.freeze({
  blog: 'https://blog.fastina.net/wp-json/wp/v2/posts?status=publish&per_page=10&_embed=wp:featuredmedia&_fields=id,date_gmt,link,title,content.protected,_links,_embedded',
  note: 'https://note.com/fastina_net/rss',
  news: 'https://shop.fastina.net/blog/feed'
});
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, processEntities: false, trimValues: true });
function text(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&#(x[\da-f]+|\d+);|&(amp|quot|apos|lt|gt);/gi, (m, number, entity) => {
    if (number) { const n = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ''; }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[entity.toLowerCase()];
  }).trim().slice(0, 500);
}
function httpsURL(value, source) {
  try {
    const u = new URL(String(value ?? ''));
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    if (source === 'blog' && (u.hostname !== 'blog.fastina.net' || u.pathname.startsWith('/wp-'))) return '';
    if (source === 'note' && (u.hostname !== 'note.com' || !u.pathname.startsWith('/fastina_net/n/'))) return '';
    if (source === 'news' && (u.hostname !== 'shop.fastina.net' || !u.pathname.startsWith('/blog/'))) return '';
    return u.href;
  } catch { return ''; }
}
function normalize(items, source, limit, now) {
  const seen = new Set();
  return items.map(item => ({ source, title: text(item.title), url: httpsURL(item.url, source), image: httpsURL(item.image), date: item.date }))
    .filter(item => item.title && item.url && Number.isFinite(Date.parse(item.date)) && Date.parse(item.date) <= now + 300000)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .filter(item => { if (seen.has(item.url)) return false; seen.add(item.url); return true; })
    .slice(0, limit).map(item => ({ ...item, date: new Date(item.date).toISOString() }));
}
function parseBlog(body, now = Date.now()) {
  const posts = JSON.parse(body);
  if (!Array.isArray(posts)) throw new Error('Invalid WordPress feed');
  return normalize(posts.filter(p => !p.content?.protected).map(p => ({ title: p.title?.rendered, url: p.link, image: p._embedded?.['wp:featuredmedia']?.[0]?.source_url || '', date: p.date_gmt ? p.date_gmt + (/[zZ]|[+-]\d\d:\d\d$/.test(p.date_gmt) ? '' : 'Z') : '' })), 'blog', 3, now);
}
function xmlText(value) { return value && typeof value === 'object' ? value['#text'] || value['@_url'] || '' : value || ''; }
function parseRSS(body, source, now = Date.now()) {
  if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) throw new Error('Invalid XML feed');
  const data = parser.parse(body);
  if (!data.rss || !Object.prototype.hasOwnProperty.call(data.rss, 'channel')) throw new Error('Missing RSS channel');
  let rows = data.rss.channel?.item || [];
  if (!Array.isArray(rows)) rows = [rows];
  return normalize(rows.map(p => ({ title: xmlText(p.title), url: text(xmlText(p.link)), date: xmlText(p.pubDate), image: text(xmlText(p['media:thumbnail'] || p.image || '')) })), source, source === 'note' ? 2 : 3, now);
}
async function fetchBody(url, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { Accept: 'application/json, application/rss+xml, application/xml;q=0.9', 'User-Agent': 'FastinaShopFeed/1.0' } });
  if (!response.ok) { const error = new Error('Feed unavailable'); error.code = 'upstream_http_' + response.status; throw error; }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 2000000) throw new Error('Feed too large');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2000000) { await reader.cancel(); throw new Error('Feed too large'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
async function fetchBlog(fetcher, now) {
  try { return parseBlog(await fetchBody(SOURCES.blog, fetcher), now); }
  catch {
    // Use WordPress's public syndication feed when its REST service is unavailable.
    const rows = parseRSS(await fetchBody('https://blog.fastina.net/feed/', fetcher), 'blog', now);
    return (await Promise.all(rows.map(async row => {
      try {
        const body = await fetchBody(row.url, fetcher);
        if (/class=["'][^"']*post-password-form/i.test(body)) return null;
        const tags = body.match(/<meta\b[^>]*>/gi) || [];
        const tag = tags.find(tag => /(?:property|name)=["']og:image["']/i.test(tag));
        const image = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1];
        return { ...row, image: httpsURL(text(image || '')) };
      } catch { return { ...row, image: '' }; }
    }))).filter(Boolean);
  }
}
function createService(fetcher = fetch, clock = Date.now) {
  const last = {}; let cached; let expires = 0; let pending;
  return async function getFeed() {
    if (cached && clock() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      const now = clock();
      const payload = { version: 1, updatedAt: new Date(now).toISOString(), blog: [], note: [], news: [], status: {} };
      await Promise.all(Object.entries(SOURCES).map(async ([source, url]) => {
        try {
          const items = source === 'blog' ? await fetchBlog(fetcher, now) : parseRSS(await fetchBody(url, fetcher), source, now);
          last[source] = items; payload[source] = items; payload.status[source] = { ok: true, stale: false };
        } catch (error) {
          const reason = String(error.code || error.cause?.code || error.name || 'unavailable').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64);
          payload[source] = last[source] || []; payload.status[source] = { ok: false, stale: Boolean(last[source]), reason };
        }
      }));
      const allFailed = Object.values(payload.status).every(s => !s.ok);
      const partial = Object.values(payload.status).some(s => !s.ok);
      cached = { payload, statusCode: allFailed ? 503 : 200, ttl: partial ? 300 : 1800 };
      expires = now + cached.ttl * 1000;
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  };
}
module.exports = { SOURCES, text, httpsURL, normalize, parseBlog, parseRSS, createService };
