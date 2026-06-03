// api/imagine-render.js
// Vercel serverless Node function (auto-deployed by Vercel from the api/
// folder; same-origin to the SPA at /api/imagine-render).
//
// Phase 2F.2 — scene loop + text + shape rendering ported from Triton's
// lib/serverRenderCard.ts. The fn now accepts an optional `scene` in the
// body. If absent, we synthesize a default demo scene (rounded shape +
// title text + subtitle text) so the UI's debounced render still gets a
// readable preview while widget fetchData/buildScene wiring lands in
// 2F.6. Future sub-steps (2F.3..2F.5) add the per-element drawX fns.
//
// Auth: Supabase JWT in Authorization: Bearer. We validate by calling
// supabase.auth.getUser(jwt). No role check (Graphics is open to any
// authed user per Q16).
//
// Input  (POST JSON):
//   { widget_id, filters, size: {width, height, label}, scene?: Scene }
// Output (200): image/png bytes. Headers expose x-imagine-renderer.

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { createClient } = require('@supabase/supabase-js');
const { renderSceneToPNG } = require('./_lib/imagineRenderer');

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function buildDemoScene(widgetId, width, height) {
  return {
    id: 'demo',
    name: `${widgetId} demo`,
    width,
    height,
    background: '#0f0f1a',
    elements: [
      {
        id: 'card-bg',
        type: 'shape',
        x: 24,
        y: 24,
        width: width - 48,
        height: height - 48,
        zIndex: 1,
        props: {
          bgColor: '#1a1a2e',
          bgOpacity: 1,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: '#6366f1',
        },
      },
      {
        id: 'title',
        type: 'text',
        x: 48,
        y: height * 0.32,
        width: width - 96,
        height: height * 0.18,
        zIndex: 2,
        props: {
          text: widgetId,
          fontSize: Math.round(height * 0.12),
          fontWeight: 700,
          color: '#ffffff',
          textAlign: 'center',
          lineHeight: 1.1,
          textTransform: 'uppercase',
        },
      },
      {
        id: 'subtitle',
        type: 'text',
        x: 48,
        y: height * 0.52,
        width: width - 96,
        height: height * 0.08,
        zIndex: 3,
        props: {
          text: `${width} × ${height} · 2F.2 demo scene`,
          fontSize: Math.round(height * 0.035),
          fontWeight: 400,
          color: 'rgba(255,255,255,0.6)',
          textAlign: 'center',
        },
      },
      {
        id: 'body',
        type: 'text',
        x: 64,
        y: height * 0.66,
        width: width - 128,
        height: height * 0.2,
        zIndex: 4,
        props: {
          text: 'Scene loop, shape, and text rendering live. Widget data + buildScene wiring lands in 2F.6; chart and player-image renderers in 2F.3 through 2F.5.',
          fontSize: Math.round(height * 0.025),
          fontWeight: 400,
          color: 'rgba(255,255,255,0.72)',
          textAlign: 'center',
          lineHeight: 1.5,
        },
      },
    ],
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, apikey');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'x-imagine-renderer, x-imagine-widget');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return; }

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
  if (!user) { json(res, 401, { error: 'Unauthorized' }); return; }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const widget_id = typeof body.widget_id === 'string' ? body.widget_id : null;
  if (!widget_id) { json(res, 400, { error: 'widget_id required' }); return; }

  const sizeIn = (body.size && typeof body.size === 'object') ? body.size : {};
  const width = Math.max(64, Math.min(4096, Number(sizeIn.width) || 1080));
  const height = Math.max(64, Math.min(4096, Number(sizeIn.height) || 1080));

  const scene = (body.scene && typeof body.scene === 'object' && Array.isArray(body.scene.elements))
    ? body.scene
    : buildDemoScene(widget_id, width, height);

  let pngBytes;
  try {
    pngBytes = await renderSceneToPNG(scene, { createCanvas, GlobalFonts });
  } catch (err) {
    console.error('renderSceneToPNG failed:', err);
    json(res, 500, { error: `Render failed: ${err.message}` });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('x-imagine-renderer', 'napi-2f2');
  res.setHeader('x-imagine-widget', widget_id);
  res.end(pngBytes);
};
