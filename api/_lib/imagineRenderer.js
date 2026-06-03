// api/_lib/imagineRenderer.js
//
// Port of Triton-Tools/lib/serverRenderCard.ts. Pure node module that
// turns a Scene (see types in src/pages/tools/graphics/registry/sceneTypes.ts)
// into a PNG Buffer using @napi-rs/canvas.
//
// 2F.2 covers: scene loop wrapper, font registration, drawUniversalBg
// (shape element), drawUniversalBorder, text element with word-wrap and
// auto-shrink-to-fit.
// 2F.3 adds: player-image (with headshot fetch + cover-fit clip), stat-card,
// rc-stat-box.
// 2F.4 adds: rc-table, rc-bar-chart, rc-donut-chart, rc-statline. Other
// element types render as a universal-bg fallback until 2F.5
// (rc-heatmap, rc-zone-plot, rc-movement-plot).
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

// ── Image helper (used by player-image) ─────────────────────────────────
async function fetchImage(url, loadImage) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return await loadImage(buf);
  } catch {
    return null;
  }
}

// ── player-image (headshot + optional name label) ───────────────────────
async function drawPlayerImage(ctx, el, loadImage) {
  const p = el.props || {};
  const { x, y, width: w, height: h } = el;
  const imgH = p.showLabel && p.playerName ? h - 28 : h;
  const radius = p.borderRadius != null ? p.borderRadius : 12;

  ctx.save();

  if (p.borderWidth > 0) {
    ctx.strokeStyle = p.borderColor || '#ffffff';
    ctx.lineWidth = p.borderWidth;
    roundRect(ctx, x, y, w, imgH, radius);
    ctx.stroke();
  }

  if (p.customImageUrl || p.playerId) {
    const imgUrl = p.customImageUrl
      || `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${p.playerId}/headshot/67/current`;
    const img = await fetchImage(imgUrl, loadImage);
    if (img) {
      ctx.save();
      roundRect(ctx, x + 1, y + 1, w - 2, imgH - 2, Math.max(0, radius - 1));
      ctx.clip();
      // Cover fit: crop source so aspect matches box, then drawImage stretched.
      const imgRatio = img.width / img.height;
      const boxRatio = w / imgH;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (imgRatio > boxRatio) {
        sw = img.height * boxRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / boxRatio;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, imgH);
      ctx.restore();
    } else {
      // Fetch failed — render a neutral fill so the slot doesn't go blank.
      ctx.fillStyle = '#27272a';
      roundRect(ctx, x + 1, y + 1, w - 2, imgH - 2, Math.max(0, radius - 1));
      ctx.fill();
    }
  }

  if (p.showLabel && p.playerName) {
    ctx.font = `500 13px ${FONT()}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.playerName, x + w / 2, y + imgH + 14);
  }

  ctx.restore();
}

// ── rc-stat-box (Report Card stat box) ──────────────────────────────────
function drawRCStatBox(ctx, el) {
  const p = el.props || {};
  const { x, y, width: w, height: h } = el;
  const radius = p.borderRadius != null ? p.borderRadius : 12;
  const color = p.color || '#06b6d4';
  const pad = 16;

  ctx.save();
  ctx.fillStyle = p.bgColor || 'rgba(255,255,255,0.04)';
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();

  // Accent bar
  ctx.fillStyle = color;
  ctx.fillRect(x, y + 10, 3, h - 20);

  const labelSize = Math.max(10, (p.fontSize || 44) * 0.28);
  ctx.font = `600 ${labelSize}px ${FONT()}`;
  ctx.fillStyle = '#a1a1aa';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText((p.label || 'Stat').toUpperCase(), x + pad, y + pad);

  ctx.font = `bold ${p.fontSize || 44}px ${FONT()}`;
  ctx.fillStyle = color;
  ctx.fillText(String(p.value != null ? p.value : '--'), x + pad, y + pad + labelSize + 4);
  ctx.restore();
}

// ── stat-card (Scene Composer variant: transparent-by-default + sublabel) ─
function drawStatCard(ctx, el) {
  const p = el.props || {};
  const { x, y, width: w, height: h } = el;
  const radius = p.borderRadius != null ? p.borderRadius : 12;
  const color = p.color || '#06b6d4';
  const bg = p.bgColor || 'transparent';
  const pad = 14;

  ctx.save();
  if (bg && bg !== 'transparent') {
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
  }
  if (p.borderWidth > 0) {
    ctx.strokeStyle = p.borderColor || color;
    ctx.lineWidth = p.borderWidth;
    roundRect(ctx, x, y, w, h, radius);
    ctx.stroke();
  }

  const valueSize = p.fontSize || 44;
  const labelSize = Math.max(10, valueSize * 0.28);
  const sublabelSize = Math.max(10, valueSize * 0.24);
  const hasSublabel = !!p.sublabel;
  const valueText = String(p.value != null ? p.value : '--');
  const labelText = (p.label || '').toUpperCase();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.font = `600 ${labelSize}px ${FONT()}`;
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText(labelText, x + pad, y + pad);

  ctx.font = `bold ${valueSize}px ${FONT()}`;
  ctx.fillStyle = color;
  ctx.fillText(valueText, x + pad, y + pad + labelSize + 4);

  if (hasSublabel) {
    ctx.font = `400 ${sublabelSize}px ${FONT()}`;
    ctx.fillStyle = '#71717a';
    ctx.fillText(String(p.sublabel), x + pad, y + pad + labelSize + 4 + valueSize + 4);
  }

  ctx.restore();
}

// ── rc-table ────────────────────────────────────────────────────────────
function drawRCTable(ctx, el) {
  const p = el.props || {};
  const { x, y, width: w, height: h } = el;
  const cols = p.columns || [];
  const rows = p.rows || [];
  const fontSize = p.fontSize || 16;
  const headerFontSize = p.headerFontSize || 13;
  const radius = p.borderRadius != null ? p.borderRadius : 12;
  const title = p.title || '';

  ctx.save();
  ctx.fillStyle = p.bgColor || '#09090b';
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();

  let titleOffset = 0;
  if (title) {
    titleOffset = 22;
    ctx.fillStyle = p.headerColor || '#a1a1aa';
    ctx.font = `600 ${Math.max(10, headerFontSize + 1)}px ${FONT()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(title, x + w / 2, y + 6);
  }

  if (cols.length === 0) { ctx.restore(); return; }

  const colW = w / cols.length;
  const headerH = headerFontSize + 16 + 1;
  const headerY = y + titleOffset;
  const availableH = h - titleOffset - headerH;
  const rowCount = Math.max(rows.length, 1);
  const rowH = Math.max(0, availableH / rowCount);

  // Header
  ctx.font = `600 ${headerFontSize}px ${FONT()}`;
  ctx.fillStyle = p.headerColor || '#a1a1aa';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < cols.length; i++) {
    ctx.textAlign = 'left';
    ctx.fillText(cols[i].label, x + i * colW + 10, headerY + headerH / 2);
  }

  // Separator
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 8, headerY + headerH);
  ctx.lineTo(x + w - 8, headerY + headerH);
  ctx.stroke();

  // Rows
  const startY = headerY + headerH;
  ctx.font = `400 ${fontSize}px ${FONT()}`;

  const truncate = (text, maxW) => {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  };

  for (let r = 0; r < rows.length; r++) {
    const ry = startY + r * rowH;
    if (ry + rowH > y + h) break;
    for (let c = 0; c < cols.length; c++) {
      const val = String(rows[r][cols[c].key] != null ? rows[r][cols[c].key] : '--');
      ctx.fillStyle = cols[c].key === 'pitch_name'
        ? (rows[r]._color || '#e4e4e7')
        : '#e4e4e7';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncate(val, colW - 14), x + c * colW + 10, ry + rowH / 2);
    }
  }
  ctx.restore();
}

// ── rc-bar-chart (horizontal bars w/ left labels + right values) ────────
function drawRCBarChart(ctx, el) {
  const p = el.props || {};
  const { x, y, width: w, height: h } = el;
  const barData = p.barData || [];
  const fontSize = p.fontSize || 12;
  const radius = p.borderRadius != null ? p.borderRadius : 12;
  const title = p.title || '';

  ctx.save();
  ctx.fillStyle = p.bgColor || '#09090b';
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();

  let titleOffset = 0;
  if (title) {
    titleOffset = 28;
    ctx.fillStyle = '#a1a1aa';
    ctx.font = `600 ${Math.max(10, fontSize)}px ${FONT()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(title, x + w / 2, y + 8);
  }

  if (barData.length === 0) { ctx.restore(); return; }

  const maxVal = Math.max(...barData.map((d) => d.value), 1);
  const pad = { top: 15 + titleOffset, right: 15, bottom: 15, left: 80 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const gap = 6;
  const barH = (plotH - (barData.length - 1) * gap) / barData.length;
  const startY = y + pad.top;

  for (let i = 0; i < barData.length; i++) {
    const d = barData[i];
    const by = startY + i * (barH + gap);
    const bw = (d.value / maxVal) * plotW;

    ctx.fillStyle = '#a1a1aa';
    ctx.font = `500 ${fontSize}px ${FONT()}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.label, x + pad.left - 8, by + barH / 2);

    ctx.fillStyle = '#27272a';
    roundRect(ctx, x + pad.left, by, plotW, barH, 4);
    ctx.fill();

    ctx.fillStyle = d.color || '#06b6d4';
    roundRect(ctx, x + pad.left, by, Math.max(bw, 4), barH, 4);
    ctx.fill();

    if (p.showValues !== false) {
      ctx.fillStyle = '#e4e4e7';
      ctx.font = `600 ${fontSize}px ${FONT()}`;
      ctx.textAlign = 'left';
      ctx.fillText(
        d.value % 1 ? d.value.toFixed(1) : String(d.value),
        x + pad.left + Math.max(bw, 4) + 6,
        by + barH / 2,
      );
    }
  }
  ctx.restore();
}

// ── rc-donut-chart (slices w/ optional outside labels) ──────────────────
function drawRCDonutChart(ctx, el) {
  const p = el.props || {};
  const { x, y, width: w, height: h } = el;
  const usageData = p.usageData || [];
  const innerRadiusRatio = p.innerRadius != null ? p.innerRadius : 0.55;
  const fontSize = p.fontSize || 12;
  const radius = p.borderRadius != null ? p.borderRadius : 12;
  const title = p.title || '';

  ctx.save();
  ctx.fillStyle = p.bgColor || '#09090b';
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();

  let titleOffset = 0;
  if (title) {
    titleOffset = 24;
    ctx.fillStyle = '#a1a1aa';
    ctx.font = `600 ${Math.max(10, fontSize)}px ${FONT()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(title, x + w / 2, y + 6);
  }

  if (usageData.length === 0) { ctx.restore(); return; }

  const total = usageData.reduce((s, d) => s + d.value, 0);
  if (total === 0) { ctx.restore(); return; }

  const cx = x + w / 2;
  const cy = y + (h + titleOffset) / 2;
  const outerR = Math.min(w, h) / 2 - 30;
  const innerR = outerR * innerRadiusRatio;

  let angle = -Math.PI / 2;

  for (const item of usageData) {
    const sliceAngle = (item.value / total) * Math.PI * 2;

    ctx.beginPath();
    ctx.arc(cx, cy, outerR, angle, angle + sliceAngle);
    ctx.arc(cx, cy, innerR, angle + sliceAngle, angle, true);
    ctx.closePath();
    ctx.fillStyle = item.color || '#06b6d4';
    ctx.fill();
    ctx.strokeStyle = p.bgColor || '#09090b';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (p.showLabels !== false && sliceAngle > 0.15) {
      const midAngle = angle + sliceAngle / 2;
      const labelR = outerR + 16;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);
      ctx.fillStyle = '#a1a1aa';
      ctx.font = `500 ${fontSize}px ${FONT()}`;
      ctx.textAlign = midAngle > Math.PI / 2 && midAngle < 3 * Math.PI / 2 ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      const pct = ((item.value / total) * 100).toFixed(0);
      ctx.fillText(`${item.label} ${pct}%`, lx, ly);
    }
    angle += sliceAngle;
  }

  // Center hole (matches bg for clean donut hole)
  ctx.beginPath();
  ctx.arc(cx, cy, innerR - 1, 0, Math.PI * 2);
  ctx.fillStyle = p.bgColor || '#09090b';
  ctx.fill();

  ctx.restore();
}

// ── rc-statline (7-cell baseball line: IP/H/R/SO/BB/W-L/ERA) ────────────
function drawRCStatline(ctx, el) {
  const p = el.props || {};
  const { x, y, width: w, height: h } = el;
  const statline = p.statline || { ip: '?', h: 0, r: 0, k: 0, bb: 0, decision: 'ND', era: '--' };
  const fontSize = p.fontSize || 22;
  const color = p.color || '#ffffff';
  const headerColor = p.headerColor || '#a1a1aa';
  const radius = p.borderRadius != null ? p.borderRadius : 8;
  const title = p.title || '';

  ctx.save();
  ctx.fillStyle = p.bgColor || 'rgba(255,255,255,0.04)';
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();

  const labels = ['IP', 'H', 'R', 'SO', 'BB', 'W/L', 'ERA'];
  const values = [
    statline.ip,
    String(statline.h),
    String(statline.r),
    String(statline.k),
    String(statline.bb),
    statline.decision,
    statline.era,
  ];
  const cellW = w / labels.length;

  let contentY = y;
  let contentH = h;

  if (title) {
    const titleSize = Math.max(9, fontSize * 0.55);
    ctx.font = `600 ${titleSize}px ${FONT()}`;
    ctx.fillStyle = headerColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(title.toUpperCase(), x + w / 2, y + 4);
    contentY = y + titleSize + 8;
    contentH = h - titleSize - 8;
  }

  const labelSize = Math.max(8, fontSize * 0.55);
  const midY = contentY + contentH / 2;

  for (let i = 0; i < labels.length; i++) {
    const cellX = x + i * cellW + cellW / 2;

    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + i * cellW, contentY + 6);
      ctx.lineTo(x + i * cellW, contentY + contentH - 6);
      ctx.stroke();
    }

    ctx.font = `500 ${labelSize}px ${FONT()}`;
    ctx.fillStyle = headerColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(labels[i], cellX, midY - 2);

    const maxValFont = Math.min(fontSize, cellW * 0.55);
    ctx.font = `700 ${maxValFont}px ${FONT()}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.fillText(values[i], cellX, midY + 2);
  }

  ctx.restore();
}

// ── Per-element dispatch (2F.5 will add heatmap + zone-plot + movement). ─
async function drawElement(ctx, el, deps) {
  switch (el.type) {
    case 'shape':
      drawUniversalBg(ctx, el);
      return;
    case 'text':
      drawText(ctx, el);
      return;
    case 'player-image':
      await drawPlayerImage(ctx, el, deps.loadImage);
      return;
    case 'rc-stat-box':
      drawRCStatBox(ctx, el);
      return;
    case 'stat-card':
      drawStatCard(ctx, el);
      return;
    case 'rc-table':
      drawRCTable(ctx, el);
      return;
    case 'rc-bar-chart':
      drawRCBarChart(ctx, el);
      return;
    case 'rc-donut-chart':
      drawRCDonutChart(ctx, el);
      return;
    case 'rc-statline':
      drawRCStatline(ctx, el);
      return;
    default:
      // Until the per-element fns land, render anything else as a generic
      // bg so the slot is visible at the right coords.
      drawUniversalBg(ctx, el);
      return;
  }
}

// ── Scene loop ──────────────────────────────────────────────────────────
async function renderSceneToPNG(scene, { createCanvas, GlobalFonts, loadImage }) {
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

    await drawElement(ctx, el, { loadImage });

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
  // exported for 2F.4+ sub-modules to reuse
  roundRect,
  applyBgFillStyle,
  drawUniversalBg,
  drawUniversalBorder,
  drawText,
  drawPlayerImage,
  drawRCStatBox,
  drawStatCard,
  drawRCTable,
  drawRCBarChart,
  drawRCDonutChart,
  drawRCStatline,
  fetchImage,
  FONT,
  ensureFont,
};
