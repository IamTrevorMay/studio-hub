// api/triton-cron.js
// Vercel route: /api/triton-cron
//
// Server-side proxy for Triton's admin/cron endpoints. Holds
// TRITON_CRON_SECRET so it never ships in the browser bundle. Requires a
// Mayday admin JWT; forwards the request to Triton with the cron secret.
//
// Body:
//   { path: '/api/cron/briefs' | '/api/cron/daily-cards' | '/api/daily-cards-config',
//     method: 'GET' | 'PUT',
//     query?: object,
//     body?: object }
//
// Required Vercel env vars:
//   TRITON_CRON_SECRET — Triton's cron secret (server-side only)
//   SUPABASE_URL + SUPABASE_ANON_KEY — Mayday creds for JWT validation
//
// Whitelist locks down which Triton paths we proxy.

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_TRITON_ORIGIN = 'https://www.tritonapex.io';
const ALLOWED = {
  '/api/cron/briefs': ['GET'],
  '/api/cron/daily-cards': ['GET'],
  '/api/daily-cards-config': ['PUT', 'GET'],
};

const ADMIN_ROLES = new Set(['admin', 'director_creative', 'director_comms']);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const MY_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const MY_ANON = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!MY_URL || !MY_ANON) {
    return res.status(500).json({ error: 'Mayday Supabase env not configured' });
  }
  const sb = createClient(MY_URL, MY_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { data: prof } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!prof || !ADMIN_ROLES.has(prof.role)) {
    return res.status(403).json({ error: 'Admin required' });
  }

  const CRON_SECRET = process.env.TRITON_CRON_SECRET;
  if (!CRON_SECRET) {
    return res.status(500).json({ error: 'TRITON_CRON_SECRET not configured' });
  }

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  const path = typeof body.path === 'string' ? body.path : '';
  const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'GET';
  const allowedMethods = ALLOWED[path];
  if (!allowedMethods || !allowedMethods.includes(method)) {
    return res.status(400).json({ error: `path/method not allowed: ${method} ${path}` });
  }

  const tritonOrigin = process.env.TRITON_ORIGIN
    || process.env.REACT_APP_TRITON_ORIGIN
    || DEFAULT_TRITON_ORIGIN;

  const query = body.query && typeof body.query === 'object'
    ? '?' + new URLSearchParams(Object.entries(body.query).map(([k, v]) => [k, String(v)]))
    : '';

  const fetchInit = {
    method,
    headers: {
      'Authorization': `Bearer ${CRON_SECRET}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  };
  if (method !== 'GET' && body.body) {
    fetchInit.body = JSON.stringify(body.body);
  }

  let upstream;
  try {
    upstream = await fetch(`${tritonOrigin}${path}${query}`, fetchInit);
  } catch (err) {
    return res.status(502).json({ error: `Triton ${path} failed: ${err.message}` });
  }
  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  res.end(text);
};
