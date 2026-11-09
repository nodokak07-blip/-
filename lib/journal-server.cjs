'use strict';
const crypto = require('node:crypto');
const Model = require('../assets/journal-model.js');
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function createServices({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const base = env.SUPABASE_URL?.replace(/\/$/, '');
  const secret = env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = env.SUPABASE_ANON_KEY;
  function configured() { if (!base?.startsWith('https://') || !secret || !anon) throw new HttpError(503, 'サーバー設定が完了していません。管理者にご連絡ください。'); }
  async function request(path, { method = 'GET', body, token = secret, key = secret, prefer } = {}) {
    configured();
    const response = await fetchImpl(base + path, { method, headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000) });
    let data; try { data = await response.json(); } catch { data = null; }
    if (!response.ok) { const error = new HttpError(response.status === 401 || response.status === 403 ? 401 : 502, '接続先で処理できませんでした。'); error.upstream = response.status; throw error; }
    return data;
  }
  const rest = (table, query = '', options) => request('/rest/v1/' + table + (query ? '?' + query : ''), options);
  async function actor(req, admin = false) {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '');
    if (!match) throw new HttpError(401, 'ログインしてください。');
    const result = await request('/auth/v1/user', { token: match[1], key: anon });
    if (!result?.id) throw new HttpError(401, 'ログインし直してください。');
    if (admin) { const rows = await rest('admins', 'select=user_id&user_id=eq.' + encodeURIComponent(result.id)); if (!rows?.length) throw new HttpError(403, '管理者権限が必要です。'); }
    return result;
  }
  async function rate(req, action, member = '') {
    if (!env.AUTH_RATE_LIMIT_SECRET || env.AUTH_RATE_LIMIT_SECRET.length < 32) throw new HttpError(503, '認証の設定が完了していません。');
    // Vercel overwrites this header. Local development falls back to the socket address.
    const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const digest = value => crypto.createHmac('sha256', env.AUTH_RATE_LIMIT_SECRET).update(value).digest('hex');
    const limit = action === 'login' ? 30 : 5;
    const bucket = action + ':' + digest(ip);
    const ok = await request('/rest/v1/rpc/member_auth_rate_limit', { method: 'POST', body: { p_bucket: bucket, p_limit: limit, p_seconds: action === 'signup' ? 3600 : 900 } });
    if (!ok) throw new HttpError(429, '試行回数が多いため、しばらく待ってからお試しください。');
    if (member && action === 'recover') { const okMember = await request('/rest/v1/rpc/member_auth_rate_limit', { method: 'POST', body: { p_bucket: action + ':id:' + digest(member), p_limit: 5, p_seconds: 900 } }); if (!okMember) throw new HttpError(429, 'しばらく待ってからお試しください。'); }
  }
  return { configured, request, rest, actor, rate, anon };
}
function begin(req, res, methods) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); throw new HttpError(405, 'この操作は利用できません。'); }
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin) { let host; try { host = new URL(origin).host; } catch { throw new HttpError(403, 'リクエスト元を確認してください。'); } if (host !== req.headers.host) throw new HttpError(403, 'リクエスト元を確認してください。'); }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'JSONで送信してください。');
  }
}
function bodyOf(req) {
  if (Number(req.headers['content-length'] || 0) > 100000) throw new HttpError(413, '入力が大きすぎます。');
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new HttpError(400, '入力形式を確認してください。'); } }
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 100000) throw new HttpError(400, '入力形式を確認してください。');
  return body;
}
function fail(res, error) { res.status(error.status || 500).json({ error: error.status ? error.message : '処理できませんでした。時間をおいてお試しください。' }); }
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const recoveryCode = () => crypto.randomBytes(24).toString('hex');
const memberId = () => String(crypto.randomInt(1000000000, 9999999999));
function nickname(value) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 40 || /[@\r\n]/.test(value)) throw new HttpError(400, 'ニックネームは1〜40文字で入力してください。本名やメールは入力しないでください。'); return value.trim(); }
function password(value) { if (typeof value !== 'string' || value.length < 15 || value.length > 128) throw new HttpError(400, 'パスワードは15〜128文字で設定してください。'); return value; }
module.exports = { createServices, begin, bodyOf, fail, HttpError, hash, recoveryCode, memberId, nickname, password, Model };
