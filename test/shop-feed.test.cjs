'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCES, httpsURL, parseRSS, parseBlog, createService } = require('../lib/shop-feed.cjs');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8').replace(/^\uFEFF/, '');
const now = Date.parse('2026-11-07T00:00:00Z');
test('note feed: newest 2 articles, own account only, with thumbnail', () => {
  const rows = parseRSS(fixture('automation-note.xml'), 'note', now);
  assert.equal(rows.length, 2); assert.ok(rows[0].image.startsWith('https://assets.st-note.com/'));
  assert.ok(rows.every(p => p.url.startsWith('https://note.com/fastina_net/n/')));
});
test('BASE empty feed is a valid empty news list', () => assert.deepEqual(parseRSS(fixture('automation-base.xml'), 'news', now), []));
test('WordPress published metadata has thumbnails and dates', () => {
  const rows = parseBlog(fixture('automation-wp-posts.json'), now);
  assert.equal(rows.length, 3); assert.ok(rows[0].image.startsWith('https://blog.fastina.net/')); assert.ok(rows[0].date.endsWith('Z'));
});
test('exclude password-protected and future posts; strip markup', () => {
  const posts = [ { title: { rendered: '<b>Hidden</b>' }, link: 'https://blog.fastina.net/hidden/', date_gmt: '2026-10-01T00:00:00', content: { protected: true } }, { title: { rendered: 'Future' }, link: 'https://blog.fastina.net/future/', date_gmt: '2030-01-01T00:00:00' }, { title: { rendered: '<b>Visible &amp; safe</b>' }, link: 'https://blog.fastina.net/visible/', date_gmt: '2026-10-01T00:00:00' } ];
  assert.deepEqual(parseBlog(JSON.stringify(posts), now).map(p => p.title), ['Visible & safe']);
});
test('reject hostile XML and foreign links', () => {
  assert.throws(() => parseRSS('<!DOCTYPE rss [<!ENTITY x "boom">]><rss><channel/></rss>', 'note'));
  assert.throws(() => parseRSS('<html>error</html>', 'news'));
  assert.equal(httpsURL('javascript:alert(1)'), ''); assert.equal(httpsURL('https://note.com/other/n/abc', 'note'), ''); assert.equal(httpsURL('https://a:b@note.com/fastina_net/n/abc', 'note'), '');
});
test('cache and retain last good source on upstream error; recover', async () => {
  let time = now, fail = false, calls = 0;
  const bodies = { blog: fixture('automation-wp-posts.json'), note: fixture('automation-note.xml'), news: fixture('automation-base.xml') };
  const service = createService(async url => { calls++; if (fail && url === SOURCES.note) throw new Error('offline'); const key = Object.keys(SOURCES).find(k => SOURCES[k] === url); return new Response(bodies[key]); }, () => time);
  const first = await service(); assert.equal(first.statusCode, 200); assert.equal(calls, 3);
  await service(); assert.equal(calls, 3);
  time += 1801000; fail = true; const stale = await service(); assert.equal(stale.payload.note.length, 2); assert.equal(stale.payload.status.note.stale, true);
  time += 301000; fail = false; assert.equal((await service()).payload.status.note.ok, true);
});
test('all failures return 503; simultaneous callers share refresh', async () => {
  let calls = 0; const service = createService(async () => { calls++; throw new Error('offline'); }, () => now);
  const results = await Promise.all([service(), service()]); assert.equal(results[0].statusCode, 503); assert.equal(calls, 3);
});
