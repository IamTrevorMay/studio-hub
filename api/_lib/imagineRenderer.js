// api/_lib/imagineRenderer.js
//
// Port of Triton-Tools/lib/serverRenderCard.ts. Pure node module that
// turns a Scene (see types in src/pages/tools/graphics/registry/sceneTypes.ts)
// into a PNG Buffer using @napi-rs/canvas.
//
// 2F.2 covers: scene loop wrapper, font registration, drawUniversalBg
// (shape element), drawUniversalBorder, text element with word-wrap and
// auto-shrink-to-fit. Other element types render as a universal-bg
// fallback for now; their per-type drawX fns land in 2F.3..2F.5.
//
// Underscore prefix on the dir name (_lib) tells Vercel "this is a helper,
// not an endpoint" so it doesn't get exposed as /api/_lib/imagineRenderer.

// ── Font setup (once per process / cold start) ───────────────────────────
let _fontReady = false;
let _fontFamily = 'sans-serif';

async function ensureFont(GlobalFonts) {
  if (_fontReady) return;
  try {
    // fontsource ships TTFs that @napi-rs/canvas can register from buffer.
    const urls = [
      'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.woff2',
      'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-600-normal.woff2',
      'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-700-normal.woff2',
    ];
    let registered = false;
    for (const url of urls) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          GlobalFonts.register(buf, 'Inter');
          registered = true;
        }
      } catch { /* skip */ }
    }
    if (registered) _fontFamily = 'Inter';
  } catch { /* fall back to default */ }

  try {
    const families = GlobalFonts.families;
    if (families && families.length > 0) {
      const hasInter = families.some((f) => f.family === 'Inter');
      if (hasInter) _fontFamily = 'Inter';
      else if (_fontFamily === 'sans-serif') _fontFamily = families[0].family;
    }
  } catch { /* ignore */ }
  _fontReady = true;
}

function FONT() { return _fontFamily; }

// ── Canvas helpers ───────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function applyBgFillStyle(ctx, hexOrRgba, opacity) {
  if (opacity == null || opacity >= 1) {
    ctx.fillStyle = hexOrRgba;
    return;
  }
  // Convert #RRGGBB → rgba with the given opacity. If it's already rgba/named,
  // just assign — Triton's renderer does the same simple substring math.
  if (typeof hexOrRgba === 'string' && hexOrRgba.startsWith('#')) {
    const hex = hexOrRgba.replace('#', '');
    if (hex.length >= 6) {
      const r = parseInt(hex.substring(0, 2), 16) || 0;
      const g = parseInt(hex.substring(2, 4), 16) || 0;
      const b = parseInt(hex.substring(4, 6), 16) || 0;
      ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`;
      return;
    }
  }
  ctx.fillStyle = hexOrRgba;
}

// ── Universal helpers (shape element + per-element border) ───────────────
function drawUniversalBg(ctx, el) {
  const p = el.props || {};
  if (p.bgColor && p.bgColor !== 'transparent') {
    applyBgFillStyle(ctx, p.bgColor, p.bgOpacity);
    const rad = p.borderRadius != null ? p.borderRadius : 12;
    roundRect(ctx, el.x, el.y, el.width, el.height, rad);
    ctx.fill();
  }
}

function drawUniversalBorder(ctx, el) {
  const p = el.props || {};
  if (p.borderWidth > 0) {
    ctx.strokeStyle = p.borderColor || '#06b6d4';
    ctx.lineWidth = p.borderWidth;
    const r = p.borderRadius != null ? p.borderRadius : 12;
    roundRect(ctx, el.x, el.y, el.width, el.height, r);
    ctx.stroke();
  }
}

// ── Text element (with word-wrap + auto-shrink) ──────────────────────────
function drawText(ctx, el) {
  const p = el.props || {};
  let displayText = p.text || '';
  if (p.textTransform === 'uppercase') displayText = displayText.toUpperCase();
  else if (p.textTransform === 'lowercase') displayText = displayText.toLowerCase();

  const baseFontSize = p.fontSize || 16;
  const lineHeightMul = p.lineHeight || 1.2;
  ctx.fillStyle = p.color || '#ffffff';
  ctx.textBaseline = 'middle';

  // Auto-shrink: try the requested fontSize, then step down until the
  // wrapped text fits within el.height (with small overflow tolerance).
  let fontSize = baseFontSize;
  let lines = [];
  while (fontSize >= 12) {
    ctx.font = `${p.fontWeight || 400} ${fontSize}px ${p.fontFamily || FONT()}`;
    const words = displayText.split(' ');
    lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > el.width && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    const totalH = lines.length * fontSize * lineHeightMul;
    if (totalH <= el.height + fontSize * lineHeightMul * 0.3) break;
    fontSize -= 2;
  }

  ctx.font = `${p.fontWeight || 400} ${fontSize}px ${p.fontFamily || FONT()}`;
  const lh = fontSize * lineHeightMul;
  const totalH = lines.length * lh;
  const startY = el.y + (el.height - totalH) / 2 + lh / 2;

  let tx = el.x;
  if (p.textAlign === 'center') { tx = el.x + el.width / 2; ctx.textAlign = 'center'; }
  else if (p.textAlign === 'right') { tx = el.x + el.width; ctx.textAlign = 'right'; }
  else { ctx.textAlign = 'left'; }

  // Optional text-shadow pass (drawn first under the fill).
  if (p.textShadowBlur > 0 || p.textShadowOffsetX || p.textShadowOffsetY) {
    ctx.save();
    ctx.fillStyle = p.textShadowColor || '#000000';
    ctx.shadowColor = p.textShadowColor || '#000000';
    ctx.shadowBlur = p.textShadowBlur || 0;
    ctx.shadowOffsetX = p.textShadowOffsetX || 0;
    ctx.shadowOffsetY = p.textShadowOffsetY || 0;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], tx, startY + i * lh);
    }
    ctx.restore();
    ctx.fillStyle = p.color || '#ffffff';
    ctx.font = `${p.fontWeight || 400} ${fontSize}px ${p.fontFamily || FONT()}`;
    if (p.textAlign === 'center') ctx.textAlign = 'center';
    else if (p.textAlign === 'right') ctx.textAlign = 'right';
    else ctx.textAlign = 'left';
  }

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], tx, startY + i * lh);
  }
}

// ── Per-element dispatch (2F.3..2F.5 will replace the default fallback
// with real drawX fns for stat-card, rc-stat-box, player-image, charts,
// heatmaps, etc.) ────────────────────────────────────────────────────────
async function drawElement(ctx, el) {
  switch (el.type) {
    case 'shape':
      drawUniversalBg(ctx, el);
      return;
    case 'text':
      drawText(ctx, el);
      return;
    default:
      // Until the per-element fns land, render anything else as a generic
      // bg so the slot is visible at the right coords.
      drawUniversalBg(ctx, el);
      return;
  }
}

// ── Scene loop ──────────────────────────────────────────────────────────
async function renderSceneToPNG(scene, { createCanvas, GlobalFonts }) {
  await ensureFont(GlobalFonts);

  const canvas = createCanvas(scene.width, scene.height);
  const ctx = canvas.getContext('2d');

  if (scene.background && scene.background !== 'transparent') {
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, scene.width, scene.height);
  }

  const sorted = [...(scene.elements || [])].sort(
    (a, b) => (a.zIndex || 0) - (b.zIndex || 0),
  );

  for (const el of sorted) {
    if (el.type === 'group') continue;

    ctx.save();
    ctx.globalAlpha = el.opacity != null ? el.opacity : 1;

    if (el.rotation) {
      ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
      ctx.rotate((el.rotation * Math.PI) / 180);
      ctx.translate(-(el.x + el.width / 2), -(el.y + el.height / 2));
    }

    const p = el.props || {};
    if (p.shadowBlur > 0) {
      ctx.shadowColor = p.shadowColor || '#000000';
      ctx.shadowBlur = p.shadowBlur;
      ctx.shadowOffsetX = p.shadowOffsetX || 0;
      ctx.shadowOffsetY = p.shadowOffsetY || 0;
    }

    await drawElement(ctx, el);

    // Reset shadow so the border below isn't shadowed.
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    drawUniversalBorder(ctx, el);
    ctx.restore();
  }

  return await canvas.toBuffer('image/png');
}

module.exports = {
  renderSceneToPNG,
  // exported for 2F.3+ sub-modules to reuse
  roundRect,
  applyBgFillStyle,
  drawUniversalBg,
  drawUniversalBorder,
  drawText,
  FONT,
  ensureFont,
};
