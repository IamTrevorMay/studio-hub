// api/imagine-render.js
// Vercel serverless Node function (auto-deployed by Vercel from the api/
// folder; same-origin to the SPA at /api/imagine-render).
//
// Renderer body lives in api/_lib/imagineRenderer.js — ported in pieces
// from Triton-Tools/lib/serverRenderCard.ts. This file owns the HTTP
// handler, auth, body parsing, and a demo scene used when the request
// doesn't include one (until widget buildScene wiring lands in 2F.6).
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
  // 2F.5 demo: rc-heatmap (synthetic 16x16 grid + spectrum + legend) on
  // the left, rc-donut-chart on the right, rc-statline strip on bottom.
  // Heatmap uses a precomputed gridZ so we don't have to fabricate raw
  // pitch locations just to test the renderer.
  const pitchData = [
    { label: 'FF',  value: 42, color: '#ef4444' },
    { label: 'SL',  value: 22, color: '#0ea5e9' },
    { label: 'CH',  value: 18, color: '#10b981' },
    { label: 'CU',  value: 12, color: '#a855f7' },
    { label: 'SI',  value:  6, color: '#f97316' },
  ];

  // Synthetic 16x16 grid centered on the zone — peaks ~0.95 at center,
  // tapers to ~0 at the corners, with a touch of noise so it doesn't look
  // perfectly radial.
  const nb = 16;
  const gridZ = [];
  for (let r = 0; r < nb; r++) {
    const row = [];
    for (let c = 0; c < nb; c++) {
      const cx = (c - 7.5) / 7.5;
      const cy = (r - 7.5) / 7.5;
      const d = Math.sqrt(cx * cx + cy * cy);
      const v = Math.max(0, 1 - d * 0.75) + (Math.sin(r * 1.3) * Math.cos(c * 0.9)) * 0.05;
      row.push(Math.max(0, Math.min(1, v)));
    }
    gridZ.push(row);
  }

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
        y: height * 0.05,
        width: width - 96,
        height: height * 0.12,
        zIndex: 2,
        props: {
          text: widgetId,
          fontSize: Math.round(height * 0.08),
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
        y: height * 0.18,
        width: width - 96,
        height: height * 0.05,
        zIndex: 3,
        props: {
          text: `${width} × ${height} · 2F.5 demo scene`,
          fontSize: Math.round(height * 0.028),
          fontWeight: 400,
          color: 'rgba(255,255,255,0.55)',
          textAlign: 'center',
        },
      },
      {
        id: 'heatmap',
        type: 'rc-heatmap',
        x: 48,
        y: height * 0.26,
        width: (width - 96) / 2 - 12,
        height: height * 0.42,
        zIndex: 4,
        props: {
          title: 'Whiff Rate',
          metric: 'whiff_pct',
          gridZ,
          colorMode: 'rainbow',
          showZone: true,
          showLegend: true,
          bgColor: '#0f0f12',
          borderRadius: 14,
        },
      },
      {
        id: 'donut',
        type: 'rc-donut-chart',
        x: width / 2 + 12,
        y: height * 0.26,
        width: (width - 96) / 2 - 12,
        height: height * 0.42,
        zIndex: 4,
        props: {
          title: 'Pitch Mix',
          usageData: pitchData,
          innerRadius: 0.55,
          fontSize: Math.round(height * 0.018),
          bgColor: 'rgba(255,255,255,0.04)',
          borderRadius: 14,
        },
      },
      {
        id: 'statline',
        type: 'rc-statline',
        x: 48,
        y: height * 0.74,
        width: width - 96,
        height: height * 0.12,
        zIndex: 5,
        props: {
          title: 'Last Outing',
          statline: { ip: '6.1', h: 4, r: 2, k: 8, bb: 1, decision: 'W', era: '2.41' },
          fontSize: Math.round(height * 0.035),
          color: '#ffffff',
          bgColor: 'rgba(99,102,241,0.10)',
          borderRadius: 12,
        },
      },
      {
        id: 'footnote',
        type: 'text',
        x: 48,
        y: height * 0.89,
        width: width - 96,
        height: height * 0.04,
        zIndex: 6,
        props: {
          text: 'heatmap (synthetic 16×16) + donut + statline live in 2F.5. Zone-plot + movement-plot wired but need pitch data.',
          fontSize: Math.round(height * 0.018),
          fontWeight: 400,
          color: 'rgba(255,255,255,0.45)',
          textAlign: 'center',
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
  res.setHeader('x-imagine-renderer', 'napi-2f6');
  res.setHeader('x-imagine-widget', widget_id);
  res.end(pngBytes);
};
