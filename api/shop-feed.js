'use strict';
const { createService } = require('../lib/shop-feed.cjs');
const getFeed = createService();
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const result = await getFeed();
  res.setHeader('Cache-Control', result.statusCode === 200 ? `public, max-age=60, s-maxage=${result.ttl}, stale-while-revalidate=86400` : 'no-store');
  return res.status(result.statusCode).json(result.payload);
};
