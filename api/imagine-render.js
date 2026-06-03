// api/imagine-render.js
// Vercel serverless Node function (auto-deployed by Vercel from the api/
// folder; same-origin to the SPA at /api/imagine-render).
//
// Phase 2F.1 SPIKE — confirms @napi-rs/canvas loads in Vercel's Node
// runtime and can return a PNG. The earlier skia_canvas attempt in
// Supabase Edge Functions failed because that runtime disallows FFI;
// Vercel's Node runtime supports native modules.
//
// If this endpoint deploys cleanly and the Mayday Graphics UI shows a
// solid bordered indigo rectangle in the preview pane, the renderer
// host is proven and we can port Triton's lib/serverRenderCard.ts
// element-by-element in 2F.2..2F.5.
//
// Auth: Supabase JWT in Authorization: Bearer. We validate by calling
// supabase.auth.getUser(jwt). No role check (Graphics is open to any
// authed user per Q16).
//
// Input  (POST JSON): { widget_id: string, filters: object, size: { width, height, label } }
// Output (200): image/png bytes. Headers expose x-imagine-renderer.

const { createCanvas } = require('@napi-rs/canvas');
const { createClient } = require('@supabase/supabase-js');

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  // Same-origin in production; allow * for early local-dev testing.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, apikey');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'x-imagine-renderer, x-imagine-widget');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  // Validate JWT
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    json(res, 401, { error: 'Unauthorized' });
    return;
  }
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    json(res, 500, { error: 'Supabase env vars not configured on Vercel function' });
    return;
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    json(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Parse body (Vercel auto-parses JSON when Content-Type: application/json)
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const widget_id = typeof body.widget_id === 'string' ? body.widget_id : null;
  if (!widget_id) {
    json(res, 400, { error: 'widget_id required' });
    return;
  }
  const sizeIn = (body.size && typeof body.size === 'object') ? body.size : {};
  const width = Math.max(64, Math.min(4096, Number(sizeIn.width) || 1080));
  const height = Math.max(64, Math.min(4096, Number(sizeIn.height) || 1080));

  let pngBytes;
  try {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#6366f1';
    const inset = 24;
    ctx.fillRect(inset, inset, width - inset * 2, height - inset * 2);

    ctx.fillStyle = '#0f0f1a';
    const innerInset = inset + 16;
    ctx.fillRect(innerInset, innerInset, width - innerInset * 2, height - innerInset * 2);

    pngBytes = await canvas.toBuffer('image/png');
  } catch (err) {
    console.error('napi-rs/canvas render failed:', err);
    json(res, 500, { error: `Render failed: ${err.message}` });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('x-imagine-renderer', 'napi-spike-2f1');
  res.setHeader('x-imagine-widget', widget_id);
  res.end(pngBytes);
};
