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

const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const { createClient } = require('@supabase/supabase-js');
const { renderSceneToPNG } = require('./_lib/imagineRenderer');

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function buildDemoScene(widgetId, width, height) {
  // 2F.3 demo: exercises shape + text (from 2F.2) plus the three new
  // element types — rc-stat-box and stat-card. player-image is left off
  // by default to keep the demo fast (it fetches a real MLB headshot);
  // set Pose a sample `player-image` element from a test scene to verify
  // that path.
  const cardW = (width - 96) / 2;
  const cardH = height * 0.18;
  const cardY = height * 0.7;

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
        y: height * 0.18,
        width: width - 96,
        height: height * 0.16,
        zIndex: 2,
        props: {
          text: widgetId,
          fontSize: Math.round(height * 0.11),
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
        y: height * 0.36,
        width: width - 96,
        height: height * 0.07,
        zIndex: 3,
        props: {
          text: `${width} × ${height} · 2F.3 demo scene`,
          fontSize: Math.round(height * 0.032),
          fontWeight: 400,
          color: 'rgba(255,255,255,0.6)',
          textAlign: 'center',
        },
      },
      {
        id: 'body',
        type: 'text',
        x: 64,
        y: height * 0.46,
        width: width - 128,
        height: height * 0.18,
        zIndex: 4,
        props: {
          text: 'Scene loop + shape + text from 2F.2. New in 2F.3: rc-stat-box and stat-card below, plus player-image (off by default — needs a real player id).',
          fontSize: Math.round(height * 0.022),
          fontWeight: 400,
          color: 'rgba(255,255,255,0.7)',
          textAlign: 'center',
          lineHeight: 1.5,
        },
      },
      {
        id: 'rc-box',
        type: 'rc-stat-box',
        x: 48,
        y: cardY,
        width: cardW,
        height: cardH,
        zIndex: 5,
        props: {
          label: 'rc-stat-box',
          value: '2.41',
          fontSize: Math.round(cardH * 0.42),
          color: '#06b6d4',
          bgColor: 'rgba(255,255,255,0.04)',
          borderRadius: 16,
        },
      },
      {
        id: 'stat-card',
        type: 'stat-card',
        x: width / 2 + 24,
        y: cardY,
        width: cardW,
        height: cardH,
        zIndex: 5,
        props: {
          label: 'stat-card',
          value: '+1.7%',
          sublabel: 'vs league avg',
          fontSize: Math.round(cardH * 0.4),
          color: '#a5b4fc',
          bgColor: 'rgba(99,102,241,0.08)',
          borderColor: 'rgba(99,102,241,0.4)',
          borderWidth: 1,
          borderRadius: 16,
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
    pngBytes = await renderSceneToPNG(scene, { createCanvas, GlobalFonts, loadImage });
  } catch (err) {
    console.error('renderSceneToPNG failed:', err);
    json(res, 500, { error: `Render failed: ${err.message}` });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('x-imagine-renderer', 'napi-2f3');
  res.setHeader('x-imagine-widget', widget_id);
  res.end(pngBytes);
};
