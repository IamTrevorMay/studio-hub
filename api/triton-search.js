// api/triton-search.js
// Vercel route: /api/triton-search
//
// Same-origin proxy for Triton's player-search RPCs. Holds the Triton anon
// key server-side so the browser bundle never ships it. Enforces Mayday
// JWT first, then calls Triton's PostgREST RPC endpoint with the Triton
// anon key as Authorization.
//
// Request body:
//   { rpc: 'search_players'|'search_batters'|'search_all_players',
//     params: { search_term, result_limit, player_type? } }
//
// Response: { rows: [...] } on success, { error: string } on failure.
//
// Required Vercel env vars:
//   TRITON_SUPABASE_URL — e.g. https://xgzxfsqwtemlcosglhzr.supabase.co
//   TRITON_SUPABASE_ANON_KEY — Triton anon JWT (NOT prefixed REACT_APP_)
//   SUPABASE_URL + SUPABASE_ANON_KEY — Mayday creds for JWT validation

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_RPCS = new Set(['search_players', 'search_batters', 'search_all_players']);

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

  const TRITON_URL = process.env.TRITON_SUPABASE_URL;
  const TRITON_ANON = process.env.TRITON_SUPABASE_ANON_KEY;
  if (!TRITON_URL || !TRITON_ANON) {
    return res.status(500).json({ error: 'Triton env not configured on Vercel function' });
  }

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  const rpc = typeof body.rpc === 'string' ? body.rpc : '';
  if (!ALLOWED_RPCS.has(rpc)) {
    return res.status(400).json({ error: 'invalid rpc' });
  }
  const params = body.params && typeof body.params === 'object' ? body.params : {};
  const searchTerm = typeof params.search_term === 'string' ? params.search_term.slice(0, 80) : '';
  const limit = Math.min(50, Math.max(1, Number(params.result_limit) || 8));
  const playerType = ['all', 'pitcher', 'batter'].includes(params.player_type) ? params.player_type : 'all';
  if (!searchTerm.trim()) {
    return res.status(200).json({ rows: [] });
  }

  const rpcBody = { search_term: searchTerm, result_limit: limit };
  if (rpc === 'search_all_players') rpcBody.player_type = playerType;

  let upstream;
  try {
    upstream = await fetch(`${TRITON_URL}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': TRITON_ANON,
        'Authorization': `Bearer ${TRITON_ANON}`,
      },
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return res.status(502).json({ error: `Triton search failed: ${err.message}` });
  }
  const text = await upstream.text();
  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: `Triton ${upstream.status}: ${text.slice(0, 200)}` });
  }
  let rows;
  try { rows = JSON.parse(text); } catch { rows = []; }
  return res.status(200).json({ rows: Array.isArray(rows) ? rows : [] });
};
