// api/_lib/tritonProxy.js
//
// Shared helper for the Imagine widget data proxies. Validates a Supabase
// JWT (Graphics is open to any authed user per Q16), forwards the request
// to Triton's Next route at the same path + query, and streams the JSON
// body back to the caller. CORS is same-origin in production so no
// Access-Control headers are needed in prod; we set them anyway so local
// `vercel dev` against another port keeps working.
//
// Why proxy at all: Triton's pitches table doesn't exist in Mayday and
// porting it would mean shipping the full Statcast schema + ingestion.
// Triton's Next routes are the system of record; the Vercel proxy adds
// (a) Mayday-side auth and (b) a same-origin URL so widget fetches don't
// hit cross-origin CORS issues.

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_TRITON_ORIGIN = 'https://www.tritonapex.io';

async function proxyToTriton(req, res, path, opts = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, apikey');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') {
    res.status(405).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Auth: any valid Supabase JWT.
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Supabase env vars not configured on Vercel function' }));
    return;
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    res.status(401).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Forward query params verbatim. req.url includes the path + query.
  const tritonOrigin = process.env.TRITON_ORIGIN
    || process.env.REACT_APP_TRITON_ORIGIN
    || DEFAULT_TRITON_ORIGIN;
  const qIdx = req.url.indexOf('?');
  const query = qIdx >= 0 ? req.url.slice(qIdx) : '';
  const upstreamUrl = `${tritonOrigin}${path}${query}`;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'GET',
      // upstreamHeaders lets a route add auth for key-protected Triton
      // endpoints (e.g. pitch-video's Bearer consumer key) without the
      // key ever reaching the browser.
      headers: { 'Accept': 'application/json', ...(opts.upstreamHeaders || {}) },
      // 25s ceiling for very large heatmap queries
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    console.error(`Triton proxy fetch failed (${path}):`, err);
    res.status(502).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `Triton fetch failed: ${err.message}` }));
    return;
  }

  const body = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  // Pass through cache headers when present; Triton's heatmap-data sends
  // a 5min public cache that's safe to reuse.
  const cc = upstream.headers.get('cache-control');
  if (cc) res.setHeader('Cache-Control', cc);
  res.setHeader('x-imagine-proxy', path);
  res.end(body);
}

module.exports = { proxyToTriton };
