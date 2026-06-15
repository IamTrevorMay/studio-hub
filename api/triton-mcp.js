// api/triton-mcp.js
// Vercel route: /api/triton-mcp
//
// Same-origin proxy for the Triton MCP server (baseball Statcast queries).
// Avoids CORS issues by proxying JSON-RPC calls through Vercel. Requires a
// valid Mayday JWT — any authenticated user can query.
//
// Request body:
//   { action: 'health' }                              → GET /health
//   { action: 'rpc', payload: { jsonrpc, id, ... } }  → POST /mcp
//
// Required Vercel env vars:
//   SUPABASE_URL + SUPABASE_ANON_KEY — Mayday creds for JWT validation
// Optional:
//   TRITON_MCP_ORIGIN — defaults to https://mcp.tritonapex.io

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_MCP_ORIGIN = 'https://mcp.tritonapex.io';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate Mayday JWT
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

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const mcpOrigin = process.env.TRITON_MCP_ORIGIN || DEFAULT_MCP_ORIGIN;
  const action = typeof body.action === 'string' ? body.action : '';

  // ── Health check ──
  if (action === 'health') {
    try {
      const upstream = await fetch(`${mcpOrigin}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      return res.status(200).json({ ok: upstream.ok });
    } catch {
      return res.status(200).json({ ok: false });
    }
  }

  // ── JSON-RPC call ──
  if (action === 'rpc') {
    const payload = body.payload;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Missing payload for rpc action' });
    }

    let upstream;
    try {
      upstream = await fetch(`${mcpOrigin}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      return res.status(502).json({ error: `MCP fetch failed: ${err.message}` });
    }

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
    res.end(text);
    return;
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
};
