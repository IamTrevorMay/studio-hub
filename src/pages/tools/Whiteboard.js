import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { getDisplayName } from '../../lib/displayName';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily, shadows, transitions } from '../../lib/styleTokens';

// Whiteboard — a shared, MS-Paint-style canvas on an infinite pannable
// surface. Boards live in `whiteboards` (one row per board, whole scene in
// `content`); every staff member can draw on any board, only the creator or
// an admin can rename/delete one.
//
// The scene is a flat list of vector objects, not a bitmap, so zooming stays
// crisp and the eraser/fill work on whole objects:
//   stroke  { points:[[x,y]…], color, width }
//   line | arrow  { x1,y1,x2,y2, color, width }
//   rect | ellipse { x,y,w,h, color, width, fill }
//   text    { x,y, text, color, size }
//   image   { x,y,w,h, url }

const PALETTE = ['#ffffff', '#0e1420', '#ef4444', '#f59e0b', '#facc15', '#22c55e', '#38bdf8', '#5b8fc7', '#8b5cf6', '#ec4899'];
const STROKE_WIDTHS = [2, 4, 8, 16];
const TEXT_SIZES = [14, 20, 28, 40, 64];
const CANVAS_BG = '#0e1420';
const GRID_COLOR = 'rgba(255,255,255,0.07)';
const SELECT_COLOR = '#5b8fc7';
const MIN_SCALE = 0.08;
const MAX_SCALE = 8;
const HANDLE_PX = 9;          // resize handle size, in screen pixels
const HIT_SLOP = 6;           // extra hit-test tolerance, in screen pixels
const MAX_IMAGE_WORLD = 520;  // longest side of a freshly dropped image
const DUP_OFFSET = 24;        // world units a duplicate/paste is nudged by
const MAX_FILL_PIXELS = 6e6;  // ceiling on the flood-fill work buffer
const MAX_FILL_SCALE = 2;     // device px per world unit while flood filling
const FILL_ALPHA = 64;        // alpha at which a pixel counts as a barrier
const FILL_MARGIN = 24;       // world-unit skirt around the barrier bounds
const HISTORY_LIMIT = 60;
const AUTOSAVE_MS = 900;

const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `o_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

// ─── Geometry helpers ────────────────────────────────────────────────

function normRect(o) {
  return {
    x: o.w < 0 ? o.x + o.w : o.x,
    y: o.h < 0 ? o.y + o.h : o.y,
    w: Math.abs(o.w),
    h: Math.abs(o.h),
  };
}

// Text is measured with a scratch 2d context so bounds/hit-tests don't need
// the live canvas (export renders off-screen too).
let measureCtx = null;
function measureText(o) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${o.size}px ${fontFamily}`;
  const lines = String(o.text || '').split('\n');
  let w = 0;
  lines.forEach((line) => { w = Math.max(w, measureCtx.measureText(line || ' ').width); });
  return { w, h: lines.length * o.size * 1.25, lines };
}

function objBounds(o) {
  if (o.type === 'stroke') {
    if (!o.points?.length) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of o.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const pad = (o.width || 2) / 2;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }
  if (o.type === 'line' || o.type === 'arrow') {
    const pad = (o.width || 2) / 2;
    return {
      x: Math.min(o.x1, o.x2) - pad,
      y: Math.min(o.y1, o.y2) - pad,
      w: Math.abs(o.x2 - o.x1) + pad * 2,
      h: Math.abs(o.y2 - o.y1) + pad * 2,
    };
  }
  if (o.type === 'text') {
    const m = measureText(o);
    return { x: o.x, y: o.y, w: m.w, h: m.h };
  }
  return normRect(o); // rect | ellipse | image
}

function boundsOfAll(objs) {
  if (!objs.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  objs.forEach((o) => {
    const b = objBounds(o);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// `slop` arrives in world units (screen slop / scale) so hit tests feel the
// same at every zoom level. `solid` treats an unfilled shape as if it were
// filled — the fill tool needs a click *inside* an outline-only rectangle to
// count, where selection deliberately wants only the outline itself.
function hitTest(o, px, py, slop, solid = false) {
  const b = objBounds(o);
  if (px < b.x - slop || py < b.y - slop || px > b.x + b.w + slop || py > b.y + b.h + slop) return false;

  if (o.type === 'stroke') {
    const tol = (o.width || 2) / 2 + slop;
    for (let i = 1; i < o.points.length; i++) {
      const [x1, y1] = o.points[i - 1];
      const [x2, y2] = o.points[i];
      if (distToSegment(px, py, x1, y1, x2, y2) <= tol) return true;
    }
    return o.points.length === 1 && Math.hypot(px - o.points[0][0], py - o.points[0][1]) <= tol;
  }
  if (o.type === 'line' || o.type === 'arrow') {
    return distToSegment(px, py, o.x1, o.y1, o.x2, o.y2) <= (o.width || 2) / 2 + slop;
  }
  if (o.type === 'text' || o.type === 'image') return true;

  const r = normRect(o);
  if (solid || (o.fill && o.fill !== 'none')) {
    if (o.type === 'ellipse') {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const rx = Math.max(r.w / 2, 0.01);
      const ry = Math.max(r.h / 2, 0.01);
      return ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;
    }
    return true;
  }
  // Outline only — must be near the edge.
  const tol = (o.width || 2) / 2 + slop;
  if (o.type === 'ellipse') {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const rx = Math.max(r.w / 2, 0.01);
    const ry = Math.max(r.h / 2, 0.01);
    const d = Math.sqrt(((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2);
    return Math.abs(d - 1) * Math.min(rx, ry) <= tol;
  }
  const insideX = px > r.x + tol && px < r.x + r.w - tol;
  const insideY = py > r.y + tol && py < r.y + r.h - tol;
  return !(insideX && insideY);
}

function translateObj(o, dx, dy) {
  if (o.type === 'stroke') return { ...o, points: o.points.map(([x, y]) => [x + dx, y + dy]) };
  if (o.type === 'line' || o.type === 'arrow') return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
  return { ...o, x: o.x + dx, y: o.y + dy };
}

// Scale about (ox, oy). Stroke widths / font sizes follow the average factor
// so a resized shape keeps its visual weight.
function scaleObj(o, ox, oy, sx, sy) {
  const mx = (x) => ox + (x - ox) * sx;
  const my = (y) => oy + (y - oy) * sy;
  const avg = (Math.abs(sx) + Math.abs(sy)) / 2;
  if (o.type === 'stroke') {
    return { ...o, points: o.points.map(([x, y]) => [mx(x), my(y)]), width: Math.max(0.5, (o.width || 2) * avg) };
  }
  if (o.type === 'line' || o.type === 'arrow') {
    return { ...o, x1: mx(o.x1), y1: my(o.y1), x2: mx(o.x2), y2: my(o.y2), width: Math.max(0.5, (o.width || 2) * avg) };
  }
  if (o.type === 'text') {
    return { ...o, x: mx(o.x), y: my(o.y), size: Math.max(6, (o.size || 20) * avg) };
  }
  const r = normRect(o);
  return { ...o, x: mx(r.x), y: my(r.y), w: r.w * Math.abs(sx), h: r.h * Math.abs(sy) };
}

// ─── Rendering ───────────────────────────────────────────────────────

function drawObject(ctx, o, imgCache, onImageLoad) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = o.color || '#ffffff';
  ctx.lineWidth = o.width || 2;

  if (o.type === 'stroke') {
    const pts = o.points || [];
    if (pts.length === 1) {
      ctx.fillStyle = o.color || '#ffffff';
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], Math.max(0.5, (o.width || 2) / 2), 0, Math.PI * 2);
      ctx.fill();
    } else if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      // Quadratic midpoints smooth out the raw pointer samples.
      for (let i = 1; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.stroke();
    }
  } else if (o.type === 'line' || o.type === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(o.x1, o.y1);
    ctx.lineTo(o.x2, o.y2);
    ctx.stroke();
    if (o.type === 'arrow') {
      const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      const head = Math.max(10, (o.width || 2) * 3.5);
      ctx.beginPath();
      ctx.moveTo(o.x2, o.y2);
      ctx.lineTo(o.x2 - head * Math.cos(angle - Math.PI / 7), o.y2 - head * Math.sin(angle - Math.PI / 7));
      ctx.moveTo(o.x2, o.y2);
      ctx.lineTo(o.x2 - head * Math.cos(angle + Math.PI / 7), o.y2 - head * Math.sin(angle + Math.PI / 7));
      ctx.stroke();
    }
  } else if (o.type === 'rect') {
    const r = normRect(o);
    if (o.fill && o.fill !== 'none') {
      ctx.fillStyle = o.fill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  } else if (o.type === 'ellipse') {
    const r = normRect(o);
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w / 2, 0.01), Math.max(r.h / 2, 0.01), 0, 0, Math.PI * 2);
    if (o.fill && o.fill !== 'none') {
      ctx.fillStyle = o.fill;
      ctx.fill();
    }
    ctx.stroke();
  } else if (o.type === 'text') {
    ctx.fillStyle = o.color || '#ffffff';
    ctx.font = `${o.size}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    String(o.text || '').split('\n').forEach((line, i) => {
      ctx.fillText(line, o.x, o.y + i * o.size * 1.25);
    });
  } else if (o.type === 'image') {
    const r = normRect(o);
    let img = imgCache.get(o.url);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => onImageLoad?.();
      img.src = o.url;
      imgCache.set(o.url, img);
    }
    if (img.complete && img.naturalWidth) {
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }
  ctx.restore();
}

// ─── Flood fill ──────────────────────────────────────────────────────
//
// Pen strokes are paths, not regions, so "fill inside this doodle" can't be
// answered from the geometry. Instead the barrier objects are rasterised into
// a scratch buffer, a scanline flood runs from the click, and the resulting
// mask is committed as an image object. Anything the flood can reach that
// touches the buffer edge is an open region — the caller falls back to
// painting the board background there, the way Paint floods the whole canvas
// when you click outside every shape.

function hexToRgb(hex) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Barriers are drawn on a transparent buffer, so only alpha matters — a
// stroke's own color is irrelevant to where the flood stops. The alpha
// threshold sits low enough that antialiased edges count as solid, which is
// what stops a fill leaking through a hairline gap.
function rasterizeBarriers(objs, area, scale, imgCache) {
  const w = Math.max(1, Math.round(area.w * scale));
  const h = Math.max(1, Math.round(area.h * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
  objs.forEach((o) => drawObject(ctx, o, imgCache, null));
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

function floodRegion(mask, seedX, seedY) {
  const { data, w, h } = mask;
  if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return null;
  const blocked = (i) => data[i * 4 + 3] >= FILL_ALPHA;
  if (blocked(seedY * w + seedX)) return null;

  const filled = new Uint8Array(w * h);
  const stack = [seedX, seedY];
  let count = 0;
  let open = false;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    const row = y * w;
    if (filled[row + x] || blocked(row + x)) continue;

    let x1 = x;
    while (x1 >= 0 && !filled[row + x1] && !blocked(row + x1)) x1--;
    x1++;
    let x2 = x;
    while (x2 < w && !filled[row + x2] && !blocked(row + x2)) x2++;
    x2--;

    if (x1 === 0 || x2 === w - 1 || y === 0 || y === h - 1) open = true;
    if (x1 < minX) minX = x1;
    if (x2 > maxX) maxX = x2;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    for (let xx = x1; xx <= x2; xx++) {
      filled[row + xx] = 1;
      count++;
      if (y > 0) {
        const up = row - w + xx;
        if (!filled[up] && !blocked(up)) { stack.push(xx, y - 1); }
      }
      if (y < h - 1) {
        const down = row + w + xx;
        if (!filled[down] && !blocked(down)) { stack.push(xx, y + 1); }
      }
    }
  }
  return { filled, count, open, minX, minY, maxX, maxY };
}

// Crops the mask to what was actually filled and paints it in `color`.
function maskToCanvas(mask, region, color) {
  const { w } = mask;
  const cw = region.maxX - region.minX + 1;
  const ch = region.maxY - region.minY + 1;
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(cw, ch);
  const { r, g, b } = hexToRgb(color);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (!region.filled[(y + region.minY) * w + (x + region.minX)]) continue;
      const i = (y * cw + x) * 4;
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

function handlePositions(b) {
  const { x, y, w, h } = b;
  return [
    { k: 'nw', x, y },
    { k: 'n', x: x + w / 2, y },
    { k: 'ne', x: x + w, y },
    { k: 'e', x: x + w, y: y + h / 2 },
    { k: 'se', x: x + w, y: y + h },
    { k: 's', x: x + w / 2, y: y + h },
    { k: 'sw', x, y: y + h },
    { k: 'w', x, y: y + h / 2 },
  ];
}

const CURSOR_FOR_TOOL = {
  select: 'default',
  pan: 'grab',
  pen: 'crosshair',
  eraser: 'crosshair',
  line: 'crosshair',
  arrow: 'crosshair',
  rect: 'crosshair',
  ellipse: 'crosshair',
  text: 'text',
  fill: 'crosshair',
};

const HANDLE_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

// ─── Tool icons ──────────────────────────────────────────────────────

function Icon({ name }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    select: <path d="M4 3l7 15 2-6 6-2z" {...p} />,
    pan: <path d="M7 11V5.5a1.5 1.5 0 013 0V10m0-1V4.5a1.5 1.5 0 013 0V10m0-.5V6a1.5 1.5 0 013 0v6.5a6 6 0 01-6 6h-1a5 5 0 01-4.2-2.3L5 13.5a1.5 1.5 0 012.4-1.8L9 13" {...p} />,
    pen: <path d="M3 18l1-4L14.5 3.5a1.8 1.8 0 012.5 2.5L6.5 16.5z" {...p} />,
    eraser: <g {...p}><path d="M9 17h9" /><path d="M4.5 14.5l6-6a1.5 1.5 0 012.2 0l3.3 3.3a1.5 1.5 0 010 2.2L11 19H7.5z" /></g>,
    line: <path d="M4 17L17 4" {...p} />,
    arrow: <g {...p}><path d="M4 17L17 4" /><path d="M11 4h6v6" /></g>,
    rect: <rect x="3.5" y="5.5" width="14" height="10" rx="1.5" {...p} />,
    ellipse: <ellipse cx="10.5" cy="10.5" rx="7" ry="5.5" {...p} />,
    text: <g {...p}><path d="M5 5h11" /><path d="M10.5 5v12" /><path d="M8 17h5" /></g>,
    fill: <g {...p}><path d="M9 3l7.5 7.5a1 1 0 010 1.4L11 17.5a1 1 0 01-1.4 0L4 11.9a1 1 0 010-1.4z" /><path d="M17.5 15.5c0 1-1.5 2.2-1.5 2.2s-1.5-1.2-1.5-2.2a1.5 1.5 0 013 0z" /></g>,
    undo: <path d="M4 9h9a4.5 4.5 0 010 9H8M4 9l4-4M4 9l4 4" {...p} />,
    redo: <path d="M17 9H8a4.5 4.5 0 000 9h5M17 9l-4-4M17 9l-4 4" {...p} />,
    image: <g {...p}><rect x="3" y="4.5" width="15" height="12" rx="2" /><circle cx="7.5" cy="9" r="1.4" /><path d="M4 15l4.5-4.5 3.5 3.5 2.5-2 3 3" /></g>,
    download: <g {...p}><path d="M10.5 3v10" /><path d="M6.5 9.5l4 4 4-4" /><path d="M3.5 16.5h14" /></g>,
    trash: <g {...p}><path d="M4 6h13" /><path d="M8 6V4.5A1.5 1.5 0 019.5 3h2A1.5 1.5 0 0113 4.5V6" /><path d="M5.5 6l.8 10.5A1.5 1.5 0 007.8 18h5.4a1.5 1.5 0 001.5-1.4L15.5 6" /></g>,
    back: <path d="M12 4l-6 6.5 6 6.5" {...p} />,
    plus: <g {...p}><path d="M10.5 4v13" /><path d="M4 10.5h13" /></g>,
  };
  return <svg width="21" height="21" viewBox="0 0 21 21" aria-hidden="true">{paths[name]}</svg>;
}

const TOOLS = [
  { key: 'select', label: 'Select', hint: 'V' },
  { key: 'pan', label: 'Pan', hint: 'H · hold Space' },
  { key: 'pen', label: 'Pen', hint: 'P' },
  { key: 'eraser', label: 'Eraser', hint: 'E' },
  { key: 'line', label: 'Line', hint: 'L' },
  { key: 'arrow', label: 'Arrow', hint: 'A' },
  { key: 'rect', label: 'Rectangle', hint: 'R' },
  { key: 'ellipse', label: 'Ellipse', hint: 'O' },
  { key: 'text', label: 'Text', hint: 'T' },
  { key: 'fill', label: 'Fill', hint: 'F · click a shape, or empty space for the background' },
];

const SHAPE_TOOLS = new Set(['line', 'arrow', 'rect', 'ellipse']);

// ─── Board editor ────────────────────────────────────────────────────

function BoardCanvas({ board, onBack, onTitleChange }) {
  const { user, isAdmin } = useAuth();
  const confirm = useConfirm();

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const imgCache = useRef(new Map());

  const [objects, setObjects] = useState([]);
  const [bg, setBg] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#ffffff');
  const [fill, setFill] = useState('none');
  const [width, setWidth] = useState(4);
  const [textSize, setTextSize] = useState(20);
  const [selectedIds, setSelectedIds] = useState([]);
  const [zoomPct, setZoomPct] = useState(100);
  const [textDraft, setTextDraft] = useState(null);
  const textAreaRef = useRef(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [remoteEdit, setRemoteEdit] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  // Refs that the draw loop reads — keeps pointer moves off the React path.
  const objectsRef = useRef([]);
  const bgRef = useRef(null);
  const viewRef = useRef({ x: 0, y: 0, scale: 1 });
  const draftRef = useRef(null);       // in-progress object
  const overrideRef = useRef(null);    // { [id]: transformedObj } during move/resize
  const marqueeRef = useRef(null);     // { x, y, w, h } in world units
  const selectedRef = useRef([]);
  const toolRef = useRef(tool);
  const spaceRef = useRef(false);
  const dragRef = useRef(null);
  const rafRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const lastLocalSaveRef = useRef(0);
  const historyRef = useRef({ past: [], future: [] });
  const drawRef = useRef(() => {});
  const skipNextSaveRef = useRef(true);
  const clipboardRef = useRef([]);
  const pasteCountRef = useRef(0);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });

  useEffect(() => { objectsRef.current = objects; }, [objects]);
  useEffect(() => { bgRef.current = bg; }, [bg]);
  useEffect(() => { selectedRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { toolRef.current = tool; }, [tool]);

  const canManage = board.created_by === user?.id || isAdmin;

  // rAF-batched redraw. Goes through a ref so `draw` can schedule follow-up
  // frames (image loads) without the two callbacks depending on each other.
  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current();
    });
  }, []);

  // ─── Draw ───
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    const ctx = canvas.getContext('2d');
    const view = viewRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bgRef.current || CANVAS_BG;
    ctx.fillRect(0, 0, cw, ch);

    // World transform
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);

    // Dot grid — skipped when zoomed far out so it doesn't turn into mush.
    if (view.scale > 0.4) {
      const step = 40;
      const x0 = Math.floor((-view.x / view.scale) / step) * step;
      const y0 = Math.floor((-view.y / view.scale) / step) * step;
      const x1 = x0 + cw / view.scale + step;
      const y1 = y0 + ch / view.scale + step;
      ctx.fillStyle = GRID_COLOR;
      const r = 1 / view.scale;
      for (let x = x0; x < x1; x += step) {
        for (let y = y0; y < y1; y += step) {
          ctx.fillRect(x - r / 2, y - r / 2, r, r);
        }
      }
    }

    const override = overrideRef.current;
    const list = objectsRef.current;
    for (const o of list) {
      drawObject(ctx, override?.[o.id] || o, imgCache.current, scheduleDraw);
    }
    if (draftRef.current) drawObject(ctx, draftRef.current, imgCache.current, scheduleDraw);

    // Selection chrome, drawn in world units but with screen-constant weights.
    const sel = selectedRef.current;
    if (sel.length && !draftRef.current) {
      const selObjs = list.filter((o) => sel.includes(o.id)).map((o) => override?.[o.id] || o);
      const b = boundsOfAll(selObjs);
      if (b) {
        const px = 1 / view.scale;
        ctx.strokeStyle = SELECT_COLOR;
        ctx.lineWidth = px;
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.setLineDash([]);
        const hs = HANDLE_PX * px;
        ctx.fillStyle = SELECT_COLOR;
        handlePositions(b).forEach((h) => ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs));
      }
    }

    if (marqueeRef.current) {
      const m = normRect(marqueeRef.current);
      const px = 1 / view.scale;
      ctx.strokeStyle = SELECT_COLOR;
      ctx.fillStyle = 'rgba(91,143,199,0.12)';
      ctx.lineWidth = px;
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.strokeRect(m.x, m.y, m.w, m.h);
    }
  }, [scheduleDraw]);

  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => { scheduleDraw(); }, [objects, selectedIds, bg, scheduleDraw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const ro = new ResizeObserver(() => scheduleDraw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [scheduleDraw]);

  // ─── Load ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: loadErr } = await supabase
        .from('whiteboards').select('content').eq('id', board.id).single();
      if (cancelled) return;
      if (loadErr) {
        setError('Could not load this board.');
        setLoaded(true);
        return;
      }
      const objs = Array.isArray(data?.content?.objects) ? data.content.objects : [];
      skipNextSaveRef.current = true;
      setObjects(objs);
      objectsRef.current = objs;
      setBg(data?.content?.bg || null);
      historyRef.current = { past: [], future: [] };
      setHistory({ canUndo: false, canRedo: false });
      // Centre the view on whatever is already drawn.
      const wrap = wrapRef.current;
      const b = boundsOfAll(objs);
      if (wrap && b && b.w > 0 && b.h > 0) {
        const scale = Math.min(1, Math.min((wrap.clientWidth - 120) / b.w, (wrap.clientHeight - 120) / b.h));
        viewRef.current = {
          scale,
          x: wrap.clientWidth / 2 - (b.x + b.w / 2) * scale,
          y: wrap.clientHeight / 2 - (b.y + b.h / 2) * scale,
        };
        setZoomPct(Math.round(scale * 100));
      } else if (wrap) {
        viewRef.current = { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2, scale: 1 };
      }
      setLoaded(true);
      scheduleDraw();
    })();
    return () => { cancelled = true; };
  }, [board.id, scheduleDraw]);

  // ─── Save ───
  const save = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveState('saving');
    const payload = { objects: objectsRef.current, bg: bgRef.current };
    const { error: saveErr } = await supabase
      .from('whiteboards')
      .update({ content: payload, updated_by: user?.id || null })
      .eq('id', board.id);
    savingRef.current = false;
    if (saveErr) {
      setSaveState('error');
      setError('Autosave failed — your last changes are not stored yet.');
    } else {
      dirtyRef.current = false;
      lastLocalSaveRef.current = Date.now();
      setSaveState('saved');
      setError(null);
    }
  }, [board.id, user?.id]);

  useEffect(() => {
    if (!loaded) return undefined;
    // The state settle right after load isn't an edit — saving there would
    // bump updated_at and pop a "someone else edited" banner for everyone
    // else who has the board open.
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return undefined;
    }
    dirtyRef.current = true;
    setSaveState('idle');
    const t = setTimeout(save, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [objects, bg, loaded, save]);

  // Flush on unmount so a quick back-out doesn't drop the last strokes.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => () => { if (dirtyRef.current) saveRef.current(); }, []);

  // ─── Someone else saved this board ───
  useEffect(() => {
    const channel = supabase
      .channel(`whiteboard_${board.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'whiteboards', filter: `id=eq.${board.id}` },
        (payload) => {
          if (payload.new?.updated_by === user?.id) return;
          if (Date.now() - lastLocalSaveRef.current < 1500) return;
          setRemoteEdit({ at: payload.new?.updated_at, content: payload.new?.content });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [board.id, user?.id]);

  const acceptRemote = useCallback(() => {
    const c = remoteEdit?.content;
    if (c) {
      const objs = Array.isArray(c.objects) ? c.objects : [];
      skipNextSaveRef.current = true;
      setObjects(objs);
      objectsRef.current = objs;
      setBg(c.bg || null);
      historyRef.current = { past: [], future: [] };
      setHistory({ canUndo: false, canRedo: false });
      setSelectedIds([]);
      dirtyRef.current = false;
    }
    setRemoteEdit(null);
    scheduleDraw();
  }, [remoteEdit, scheduleDraw]);

  // ─── History ───
  // Snapshots carry the background too, so filling the canvas is undoable.
  const syncHistory = useCallback(() => {
    const h = historyRef.current;
    setHistory({ canUndo: h.past.length > 0, canRedo: h.future.length > 0 });
  }, []);

  const snapshot = useCallback(() => ({
    objects: JSON.parse(JSON.stringify(objectsRef.current)),
    bg: bgRef.current,
  }), []);

  const pushHistory = useCallback(() => {
    const h = historyRef.current;
    h.past.push(snapshot());
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    h.future = [];
    syncHistory();
  }, [snapshot, syncHistory]);

  const restore = useCallback((state) => {
    objectsRef.current = state.objects;
    setObjects(state.objects);
    setBg(state.bg);
    setSelectedIds([]);
    selectedRef.current = [];
    syncHistory();
  }, [syncHistory]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.past.length) return;
    h.future.push(snapshot());
    restore(h.past.pop());
  }, [snapshot, restore]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.future.length) return;
    h.past.push(snapshot());
    restore(h.future.pop());
  }, [snapshot, restore]);

  const commit = useCallback((updater) => {
    pushHistory();
    setObjects((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      objectsRef.current = next;
      return next;
    });
  }, [pushHistory]);

  const commitBg = useCallback((next) => {
    pushHistory();
    setBg(next);
  }, [pushHistory]);

  // ─── Duplicate / clipboard ───
  // The clipboard is in-app only: system-clipboard paste stays reserved for
  // images, so copying a shape here can't collide with pasting a screenshot.
  const cloneObjects = useCallback((objs, dx, dy) => objs.map((o) => ({
    ...translateObj(JSON.parse(JSON.stringify(o)), dx, dy),
    id: uid(),
  })), []);

  const selectedObjects = useCallback(() => {
    const ids = new Set(selectedRef.current);
    return objectsRef.current.filter((o) => ids.has(o.id));
  }, []);

  const addAndSelect = useCallback((copies) => {
    if (!copies.length) return;
    commit((prev) => [...prev, ...copies]);
    const ids = copies.map((c) => c.id);
    setSelectedIds(ids);
    selectedRef.current = ids;
    setTool('select');
  }, [commit]);

  const duplicateSelection = useCallback(() => {
    const src = selectedObjects();
    if (!src.length) return;
    addAndSelect(cloneObjects(src, DUP_OFFSET, DUP_OFFSET));
  }, [selectedObjects, cloneObjects, addAndSelect]);

  const copySelection = useCallback(() => {
    const src = selectedObjects();
    if (!src.length) return false;
    clipboardRef.current = JSON.parse(JSON.stringify(src));
    pasteCountRef.current = 0;
    return true;
  }, [selectedObjects]);

  const cutSelection = useCallback(() => {
    if (!copySelection()) return;
    const ids = new Set(selectedRef.current);
    commit((prev) => prev.filter((o) => !ids.has(o.id)));
    setSelectedIds([]);
    selectedRef.current = [];
  }, [copySelection, commit]);

  const pasteClipboard = useCallback(() => {
    const src = clipboardRef.current;
    if (!src?.length) return false;
    pasteCountRef.current += 1;
    const nudge = DUP_OFFSET * pasteCountRef.current;
    addAndSelect(cloneObjects(src, nudge, nudge));
    return true;
  }, [cloneObjects, addAndSelect]);

  // ─── View helpers ───
  const toWorld = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (e.clientX - rect.left - v.x) / v.scale,
      y: (e.clientY - rect.top - v.y) / v.scale,
    };
  }, []);

  const zoomTo = useCallback((nextScale, anchorX, anchorY) => {
    const v = viewRef.current;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    const wrap = wrapRef.current;
    const ax = anchorX ?? (wrap ? wrap.clientWidth / 2 : 0);
    const ay = anchorY ?? (wrap ? wrap.clientHeight / 2 : 0);
    // Keep the anchor point pinned while the scale changes.
    viewRef.current = {
      scale: s,
      x: ax - (ax - v.x) * (s / v.scale),
      y: ay - (ay - v.y) * (s / v.scale),
    };
    setZoomPct(Math.round(s * 100));
    scheduleDraw();
  }, [scheduleDraw]);

  const fitToContent = useCallback(() => {
    const wrap = wrapRef.current;
    const b = boundsOfAll(objectsRef.current);
    if (!wrap) return;
    if (!b || b.w <= 0 || b.h <= 0) {
      viewRef.current = { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2, scale: 1 };
      setZoomPct(100);
      scheduleDraw();
      return;
    }
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((wrap.clientWidth - 120) / b.w, (wrap.clientHeight - 120) / b.h)));
    viewRef.current = {
      scale,
      x: wrap.clientWidth / 2 - (b.x + b.w / 2) * scale,
      y: wrap.clientHeight / 2 - (b.y + b.h / 2) * scale,
    };
    setZoomPct(Math.round(scale * 100));
    scheduleDraw();
  }, [scheduleDraw]);

  // ─── Pointer ───
  const topObjectAt = useCallback((p, solid = false) => {
    const slop = HIT_SLOP / viewRef.current.scale;
    const list = objectsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      if (hitTest(list[i], p.x, p.y, slop, solid)) return list[i];
    }
    return null;
  }, []);

  const handleAt = useCallback((e) => {
    const sel = selectedRef.current;
    if (!sel.length) return null;
    const selObjs = objectsRef.current.filter((o) => sel.includes(o.id));
    const b = boundsOfAll(selObjs);
    if (!b) return null;
    const p = toWorld(e);
    const tol = (HANDLE_PX / viewRef.current.scale);
    return handlePositions(b).find((h) => Math.abs(p.x - h.x) <= tol && Math.abs(p.y - h.y) <= tol) || null;
  }, [toWorld]);

  // ─── Flood fill ───
  const uploadCanvas = useCallback(async (canvas) => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    const path = `${board.id}/${uid()}.png`;
    const { error: upErr } = await supabase.storage
      .from('whiteboard-images')
      .upload(path, blob, { contentType: 'image/png', upsert: false });
    if (upErr) {
      setError(`Fill upload failed: ${upErr.message}`);
      return null;
    }
    return supabase.storage.from('whiteboard-images').getPublicUrl(path).data.publicUrl;
  }, [board.id]);

  // Returns true when it filled a closed region; false means "open region",
  // and the caller paints the board background instead.
  const floodFillAt = useCallback(async (p) => {
    // Earlier fills are excluded from the barrier pass so a region can be
    // re-filled with a new color instead of being blocked by its own paint.
    const barriers = objectsRef.current.filter((o) => o.origin !== 'fill');
    if (!barriers.length) return false;
    const bounds = boundsOfAll(barriers);
    if (!bounds) return false;
    const area = {
      x: bounds.x - FILL_MARGIN,
      y: bounds.y - FILL_MARGIN,
      w: bounds.w + FILL_MARGIN * 2,
      h: bounds.h + FILL_MARGIN * 2,
    };
    // Outside everything → nothing to be enclosed by.
    if (p.x < area.x || p.y < area.y || p.x > area.x + area.w || p.y > area.y + area.h) return false;

    const scale = Math.min(MAX_FILL_SCALE, Math.sqrt(MAX_FILL_PIXELS / Math.max(1, area.w * area.h)));
    let mask;
    try {
      mask = rasterizeBarriers(barriers, area, scale, imgCache.current);
    } catch (err) {
      // A cross-origin image on the board taints the buffer and getImageData
      // throws — fall back rather than pretending the fill worked.
      setError('Could not read the canvas to flood fill (an image blocked it).');
      return true;
    }

    const region = floodRegion(mask, Math.round((p.x - area.x) * scale), Math.round((p.y - area.y) * scale));
    if (!region) return false;
    if (region.open) return false;
    // A closed but sub-pixel nook: swallow the click rather than surprising
    // someone by repainting the whole background.
    if (region.count < 4) return true;

    setBusy('Filling region…');
    const cropped = maskToCanvas(mask, region, color);
    const url = await uploadCanvas(cropped);
    setBusy(null);
    if (!url) return true;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    const obj = {
      id: uid(),
      type: 'image',
      origin: 'fill',
      url,
      x: area.x + region.minX / scale,
      y: area.y + region.minY / scale,
      w: (region.maxX - region.minX + 1) / scale,
      h: (region.maxY - region.minY + 1) / scale,
    };
    img.onload = () => { imgCache.current.set(url, img); scheduleDraw(); };
    img.src = url;
    commit((prev) => [...prev, obj]);
    return true;
  }, [color, commit, uploadCanvas, scheduleDraw]);

  const eraseAt = useCallback((p, first) => {
    const slop = (HIT_SLOP + 4) / viewRef.current.scale;
    const list = objectsRef.current;
    const victim = [...list].reverse().find((o) => hitTest(o, p.x, p.y, slop));
    if (!victim) return;
    if (first) pushHistory();
    const next = list.filter((o) => o.id !== victim.id);
    objectsRef.current = next;
    setObjects(next);
    scheduleDraw();
  }, [pushHistory, scheduleDraw]);

  const openTextEditor = useCallback((p, existing) => {
    const v = viewRef.current;
    setTextDraft({
      id: existing?.id || null,
      x: existing?.x ?? p.x,
      y: existing?.y ?? p.y,
      value: existing?.text || '',
      size: existing?.size || textSize,
      color: existing?.color || color,
      screenX: (existing?.x ?? p.x) * v.scale + v.x,
      screenY: (existing?.y ?? p.y) * v.scale + v.y,
      scale: v.scale,
    });
  }, [color, textSize]);

  const onPointerDown = useCallback((e) => {
    if (textDraft) return; // let the textarea's blur commit first
    const canvas = canvasRef.current;
    const t = toolRef.current;
    const panning = e.button === 1 || spaceRef.current || t === 'pan';
    canvas.setPointerCapture(e.pointerId);

    if (panning) {
      dragRef.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
      return;
    }
    if (e.button !== 0) return;
    const p = toWorld(e);

    if (t === 'pen') {
      draftRef.current = { id: uid(), type: 'stroke', color, width, points: [[p.x, p.y]] };
      dragRef.current = { mode: 'draw' };
      scheduleDraw();
      return;
    }
    if (t === 'eraser') {
      dragRef.current = { mode: 'erase', removed: [], snapshot: objectsRef.current };
      eraseAt(p, true);
      return;
    }
    if (SHAPE_TOOLS.has(t)) {
      const base = { id: uid(), color, width };
      draftRef.current = (t === 'line' || t === 'arrow')
        ? { ...base, type: t, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
        : { ...base, type: t, fill, x: p.x, y: p.y, w: 0, h: 0 };
      dragRef.current = { mode: 'draw', start: p };
      return;
    }
    if (t === 'text') {
      // Deferred to pointerup: mousedown's default action clears focus after
      // React commits, which would blur (and so discard) a textarea mounted
      // here on the way down.
      dragRef.current = { mode: 'text', start: p };
      return;
    }
    if (t === 'fill') {
      const hit = topObjectAt(p, true);
      // A vector shape knows its own interior — recolor it directly and skip
      // the raster path, so the result stays editable geometry.
      if (hit && hit.type !== 'image') {
        commit((prev) => prev.map((o) => {
          if (o.id !== hit.id) return o;
          if (o.type === 'rect' || o.type === 'ellipse') return { ...o, fill: color };
          return { ...o, color };
        }));
        return;
      }
      // Placed artwork isn't paintable; an earlier fill is (it re-floods).
      if (hit && hit.origin !== 'fill') return;
      floodFillAt(p).then((filled) => {
        if (!filled) commitBg(color);      // open region → paint the backdrop
      });
      return;
    }

    // Select tool
    const h = handleAt(e);
    if (h) {
      const selObjs = objectsRef.current.filter((o) => selectedRef.current.includes(o.id));
      dragRef.current = { mode: 'resize', handle: h.k, start: p, bounds: boundsOfAll(selObjs), snapshot: selObjs };
      return;
    }
    const hit = topObjectAt(p);
    if (hit) {
      const already = selectedRef.current.includes(hit.id);
      const next = e.shiftKey
        ? (already ? selectedRef.current.filter((id) => id !== hit.id) : [...selectedRef.current, hit.id])
        : (already ? selectedRef.current : [hit.id]);
      setSelectedIds(next);
      selectedRef.current = next;
      dragRef.current = { mode: 'move', start: p, snapshot: objectsRef.current.filter((o) => next.includes(o.id)) };
    } else {
      if (!e.shiftKey) { setSelectedIds([]); selectedRef.current = []; }
      marqueeRef.current = { x: p.x, y: p.y, w: 0, h: 0 };
      dragRef.current = { mode: 'marquee', start: p, additive: e.shiftKey, base: selectedRef.current };
    }
    scheduleDraw();
  }, [color, width, fill, textDraft, toWorld, topObjectAt, handleAt, commit, commitBg, eraseAt, floodFillAt, openTextEditor, scheduleDraw]);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'pan') {
      viewRef.current = { ...viewRef.current, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) };
      scheduleDraw();
      return;
    }
    const p = toWorld(e);
    if (d.mode === 'draw') {
      const draft = draftRef.current;
      if (!draft) return;
      if (draft.type === 'stroke') {
        const last = draft.points[draft.points.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) * viewRef.current.scale >= 1.5) draft.points.push([p.x, p.y]);
      } else if (draft.type === 'line' || draft.type === 'arrow') {
        let { x, y } = p;
        if (e.shiftKey) {
          // Snap to the nearest 45°.
          const dx = x - draft.x1;
          const dy = y - draft.y1;
          const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          x = draft.x1 + Math.cos(a) * len;
          y = draft.y1 + Math.sin(a) * len;
        }
        draft.x2 = x;
        draft.y2 = y;
      } else {
        draft.w = p.x - d.start.x;
        draft.h = p.y - d.start.y;
        if (e.shiftKey) {
          const s = Math.max(Math.abs(draft.w), Math.abs(draft.h));
          draft.w = Math.sign(draft.w || 1) * s;
          draft.h = Math.sign(draft.h || 1) * s;
        }
      }
      scheduleDraw();
      return;
    }
    if (d.mode === 'erase') { eraseAt(p, false); return; }
    if (d.mode === 'move') {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      const map = {};
      d.snapshot.forEach((o) => { map[o.id] = translateObj(o, dx, dy); });
      overrideRef.current = map;
      scheduleDraw();
      return;
    }
    if (d.mode === 'resize') {
      const b = d.bounds;
      if (!b) return;
      const k = d.handle;
      const left = k.includes('w');
      const right = k.includes('e');
      const top = k.includes('n');
      const bottom = k.includes('s');
      const ox = left ? b.x + b.w : b.x;
      const oy = top ? b.y + b.h : b.y;
      let sx = 1;
      let sy = 1;
      if (left || right) sx = b.w === 0 ? 1 : (right ? (p.x - b.x) / b.w : (b.x + b.w - p.x) / b.w);
      if (top || bottom) sy = b.h === 0 ? 1 : (bottom ? (p.y - b.y) / b.h : (b.y + b.h - p.y) / b.h);
      if (e.shiftKey && (left || right) && (top || bottom)) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
      sx = Math.abs(sx) < 0.02 ? 0.02 * Math.sign(sx || 1) : sx;
      sy = Math.abs(sy) < 0.02 ? 0.02 * Math.sign(sy || 1) : sy;
      const map = {};
      d.snapshot.forEach((o) => { map[o.id] = scaleObj(o, ox, oy, sx, sy); });
      overrideRef.current = map;
      scheduleDraw();
      return;
    }
    if (d.mode === 'marquee') {
      marqueeRef.current = { x: d.start.x, y: d.start.y, w: p.x - d.start.x, h: p.y - d.start.y };
      scheduleDraw();
    }
  }, [toWorld, eraseAt, scheduleDraw]);

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current;
    dragRef.current = null;
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    if (!d) return;

    if (d.mode === 'text') {
      openTextEditor(d.start, null);
      return;
    }
    if (d.mode === 'draw') {
      const draft = draftRef.current;
      draftRef.current = null;
      if (draft) {
        const b = objBounds(draft);
        const tiny = draft.type !== 'stroke' && b.w < 2 && b.h < 2;
        if (!tiny) commit((prev) => [...prev, draft]);
      }
      scheduleDraw();
      return;
    }
    if (d.mode === 'move' || d.mode === 'resize') {
      const map = overrideRef.current;
      overrideRef.current = null;
      if (map) commit((prev) => prev.map((o) => map[o.id] || o));
      scheduleDraw();
      return;
    }
    if (d.mode === 'marquee') {
      const m = normRect(marqueeRef.current || { x: 0, y: 0, w: 0, h: 0 });
      marqueeRef.current = null;
      if (m.w > 2 || m.h > 2) {
        const inside = objectsRef.current.filter((o) => {
          const b = objBounds(o);
          return b.x < m.x + m.w && b.x + b.w > m.x && b.y < m.y + m.h && b.y + b.h > m.y;
        }).map((o) => o.id);
        const next = d.additive ? Array.from(new Set([...d.base, ...inside])) : inside;
        setSelectedIds(next);
        selectedRef.current = next;
      }
      scheduleDraw();
    }
  }, [commit, openTextEditor, scheduleDraw]);

  // Trackpad: two-finger scroll pans, ctrl/⌘ + scroll zooms (browser pinch
  // arrives as ctrl+wheel). Bound natively so preventDefault sticks.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = canvas.getBoundingClientRect();
        zoomTo(viewRef.current.scale * Math.exp(-e.deltaY / 220), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        viewRef.current = { ...viewRef.current, x: viewRef.current.x - e.deltaX, y: viewRef.current.y - e.deltaY };
        scheduleDraw();
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomTo, scheduleDraw]);

  // ─── Text ───
  // Keyed on where the box was opened, not on the draft object, so typing
  // doesn't re-focus and stomp the caret on every keystroke.
  const textOpenKey = textDraft ? `${textDraft.id || 'new'}:${textDraft.x}:${textDraft.y}` : null;
  useEffect(() => {
    if (!textOpenKey) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = textAreaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(raf);
  }, [textOpenKey]);

  const commitText = useCallback(() => {
    const d = textDraft;
    setTextDraft(null);
    if (!d) return;
    const value = d.value.replace(/\s+$/, '');
    if (!value) {
      if (d.id) commit((prev) => prev.filter((o) => o.id !== d.id));
      return;
    }
    if (d.id) {
      commit((prev) => prev.map((o) => (o.id === d.id ? { ...o, text: value, color: d.color, size: d.size } : o)));
    } else {
      commit((prev) => [...prev, { id: uid(), type: 'text', x: d.x, y: d.y, text: value, color: d.color, size: d.size }]);
    }
  }, [textDraft, commit]);

  const onDoubleClick = useCallback((e) => {
    if (toolRef.current !== 'select') return;
    const p = toWorld(e);
    const hit = topObjectAt(p);
    if (hit?.type === 'text') {
      setSelectedIds([]);
      selectedRef.current = [];
      openTextEditor(p, hit);
    }
  }, [toWorld, topObjectAt, openTextEditor]);

  // ─── Images ───
  const placeImage = useCallback(async (file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    setBusy("Uploading image…");
    setError(null);
    const ext = (file.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${board.id}/${uid()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('whiteboard-images')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setBusy(null);
      setError(`Image upload failed: ${upErr.message}`);
      return;
    }
    const { data } = supabase.storage.from('whiteboard-images').getPublicUrl(path);
    const url = data.publicUrl;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ratio = Math.min(1, MAX_IMAGE_WORLD / Math.max(img.naturalWidth, img.naturalHeight));
      const w = img.naturalWidth * ratio;
      const h = img.naturalHeight * ratio;
      const wrap = wrapRef.current;
      const v = viewRef.current;
      const cx = ((wrap?.clientWidth || 0) / 2 - v.x) / v.scale;
      const cy = ((wrap?.clientHeight || 0) / 2 - v.y) / v.scale;
      imgCache.current.set(url, img);
      const obj = { id: uid(), type: 'image', url, x: cx - w / 2, y: cy - h / 2, w, h };
      commit((prev) => [...prev, obj]);
      setSelectedIds([obj.id]);
      selectedRef.current = [obj.id];
      setBusy(null);
      scheduleDraw();
    };
    img.onerror = () => { setBusy(null); setError('Image uploaded but could not be loaded.'); };
    img.src = url;
  }, [board.id, commit, scheduleDraw]);


  useEffect(() => {
    const onPaste = (e) => {
      if (textDraft) return;
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
      if (item) {
        e.preventDefault();
        placeImage(item.getAsFile());
        return;
      }
      // No image on the system clipboard — fall back to whatever was copied
      // inside the board.
      if (pasteClipboard()) e.preventDefault();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [placeImage, pasteClipboard, textDraft]);

  // ─── Keyboard ───
  useEffect(() => {
    const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const onKeyDown = (e) => {
      if (isTyping(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (meta && e.key.toLowerCase() === 'c') { if (copySelection()) e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'x') { e.preventDefault(); cutSelection(); return; }
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const all = objectsRef.current.map((o) => o.id);
        setSelectedIds(all);
        selectedRef.current = all;
        setTool('select');
        scheduleDraw();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedRef.current.length) return;
        e.preventDefault();
        const ids = new Set(selectedRef.current);
        commit((prev) => prev.filter((o) => !ids.has(o.id)));
        setSelectedIds([]);
        selectedRef.current = [];
        return;
      }
      if (e.key === 'Escape') { setSelectedIds([]); selectedRef.current = []; scheduleDraw(); return; }
      if (e.code === 'Space') { spaceRef.current = true; return; }
      if (meta) return;
      const map = { v: 'select', h: 'pan', p: 'pen', b: 'pen', e: 'eraser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', t: 'text', f: 'fill' };
      const next = map[e.key.toLowerCase()];
      if (next) setTool(next);
      if (e.key === '0') { zoomTo(1); }
    };
    const onKeyUp = (e) => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [undo, redo, commit, duplicateSelection, copySelection, cutSelection, zoomTo, scheduleDraw]);

  // ─── Export ───
  const exportPng = useCallback(() => {
    const objs = objectsRef.current;
    const b = boundsOfAll(objs);
    const pad = 40;
    const scale = 2;
    const w = Math.max(320, (b?.w || 800) + pad * 2);
    const h = Math.max(240, (b?.h || 600) + pad * 2);
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = bgRef.current || CANVAS_BG;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.translate(pad - (b?.x || 0), pad - (b?.y || 0));
    objs.forEach((o) => drawObject(ctx, o, imgCache.current, null));
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(board.title || 'whiteboard').replace(/[^\w\-. ]+/g, '_')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }, [board.title]);

  const clearBoard = useCallback(async () => {
    if (!objectsRef.current.length) return;
    if (!(await confirm('Clear everything on this board? This can be undone with ⌘Z until you leave the page.'))) return;
    commit(() => []);
    setSelectedIds([]);
    selectedRef.current = [];
  }, [confirm, commit]);

  const applyToSelection = useCallback((patch) => {
    const ids = new Set(selectedRef.current);
    if (!ids.size) return;
    commit((prev) => prev.map((o) => (ids.has(o.id) ? { ...o, ...patch(o) } : o)));
  }, [commit]);

  const cursor = CURSOR_FOR_TOOL[tool] || 'default';
  const { canUndo, canRedo } = history;
  const showFillPicker = tool === 'rect' || tool === 'ellipse' || tool === 'fill';
  const showSizePicker = tool === 'text';

  return (
    <div style={styles.editorRoot}>
      <div style={styles.editorTop}>
        <button onClick={onBack} style={styles.iconBtn} title="Back to boards"><Icon name="back" /></button>
        <BoardTitle board={board} canManage={canManage} onTitleChange={onTitleChange} />
        <span style={styles.saveState}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <label style={{ ...styles.iconBtn, cursor: busy ? 'wait' : 'pointer' }} title="Add an image (or just paste one)">
          <Icon name="image" />
          <input
            type="file"
            accept="image/*"
            style={styles.hiddenInput}
            onChange={(e) => { placeImage(e.target.files?.[0]); e.target.value = ''; }}
          />
        </label>
        <button onClick={exportPng} style={styles.iconBtn} title="Download as PNG"><Icon name="download" /></button>
        <button onClick={clearBoard} style={styles.iconBtn} title="Clear the board"><Icon name="trash" /></button>
      </div>

      {(error || remoteEdit) && (
        <div style={styles.banner}>
          {remoteEdit ? (
            <>
              <span>Someone else saved changes to this board.</span>
              <button onClick={acceptRemote} style={styles.bannerBtn}>Load their version</button>
              <button onClick={() => setRemoteEdit(null)} style={styles.bannerGhostBtn}>Keep mine</button>
            </>
          ) : (
            <>
              <span>{error}</span>
              <button onClick={() => setError(null)} style={styles.bannerGhostBtn}>Dismiss</button>
            </>
          )}
        </div>
      )}

      <div style={styles.editorBody}>
        <div style={styles.rail}>
          {TOOLS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTool(t.key)}
              title={`${t.label} · ${t.hint}`}
              style={{ ...styles.railBtn, ...(tool === t.key ? styles.railBtnActive : null) }}
            >
              <Icon name={t.key} />
            </button>
          ))}
          <div style={styles.railDivider} />
          <button onClick={undo} disabled={!canUndo} title="Undo · ⌘Z" style={{ ...styles.railBtn, opacity: canUndo ? 1 : 0.35 }}><Icon name="undo" /></button>
          <button onClick={redo} disabled={!canRedo} title="Redo · ⇧⌘Z" style={{ ...styles.railBtn, opacity: canRedo ? 1 : 0.35 }}><Icon name="redo" /></button>
        </div>

        <div style={styles.canvasArea}>
          <div style={styles.optionBar}>
            <span style={styles.optionLabel}>Color</span>
            <div style={styles.swatches}>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => { setColor(c); applyToSelection((o) => (o.type === 'image' ? {} : { color: c })); }}
                  title={c}
                  style={{
                    ...styles.swatch,
                    background: c,
                    ...(color === c ? styles.swatchActive : null),
                  }}
                />
              ))}
              <label style={styles.customSwatch} title="Custom color">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={styles.hiddenInput} />
                <span style={styles.customSwatchInner} />
              </label>
            </div>

            {showFillPicker && (
              <>
                <span style={styles.optionLabel}>Fill</span>
                <div style={styles.swatches}>
                  <button
                    onClick={() => { setFill('none'); applyToSelection((o) => (o.type === 'rect' || o.type === 'ellipse' ? { fill: 'none' } : {})); }}
                    title="No fill"
                    style={{ ...styles.swatch, background: 'transparent', ...(fill === 'none' ? styles.swatchActive : null) }}
                  >
                    <span style={styles.noFillSlash} />
                  </button>
                  {PALETTE.map((c) => (
                    <button
                      key={`fill-${c}`}
                      onClick={() => { setFill(c); applyToSelection((o) => (o.type === 'rect' || o.type === 'ellipse' ? { fill: c } : {})); }}
                      title={c}
                      style={{ ...styles.swatch, background: c, ...(fill === c ? styles.swatchActive : null) }}
                    />
                  ))}
                </div>
              </>
            )}

            {showSizePicker ? (
              <>
                <span style={styles.optionLabel}>Size</span>
                <div style={styles.swatches}>
                  {TEXT_SIZES.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setTextSize(s); applyToSelection((o) => (o.type === 'text' ? { size: s } : {})); }}
                      style={{ ...styles.sizeBtn, ...(textSize === s ? styles.sizeBtnActive : null) }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <span style={styles.optionLabel}>Width</span>
                <div style={styles.swatches}>
                  {STROKE_WIDTHS.map((w) => (
                    <button
                      key={w}
                      onClick={() => { setWidth(w); applyToSelection((o) => (o.type === 'text' || o.type === 'image' ? {} : { width: w })); }}
                      title={`${w}px`}
                      style={{ ...styles.widthBtn, ...(width === w ? styles.widthBtnActive : null) }}
                    >
                      <span style={{ ...styles.widthDot, width: w + 3, height: w + 3 }} />
                    </button>
                  ))}
                </div>
              </>
            )}

            <div style={{ flex: 1 }} />
            {selectedIds.length > 0 && <span style={styles.selCount}>{selectedIds.length} selected</span>}
            <span style={styles.hintText}>
              {tool === 'fill' ? 'Click a shape to fill it · click inside a closed drawing to flood it · open space paints the background'
                : tool === 'select' ? 'Drag to move · handles to resize · ⌘D duplicates · double-click text to edit'
                  : 'Space + drag pans · ⌘ + scroll zooms'}
            </span>
          </div>

          <div
            ref={wrapRef}
            style={styles.canvasWrap}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); placeImage(e.dataTransfer?.files?.[0]); }}
          >
            <canvas
              ref={canvasRef}
              style={{ ...styles.canvas, cursor }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={onDoubleClick}
            />
            {!loaded && <div style={styles.canvasLoading}>Loading board…</div>}
            {textDraft && (
              <textarea
                ref={textAreaRef}
                value={textDraft.value}
                placeholder="Type…"
                onChange={(e) => setTextDraft((d) => ({ ...d, value: e.target.value }))}
                onBlur={commitText}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
                }}
                style={{
                  ...styles.textOverlay,
                  left: textDraft.screenX,
                  top: textDraft.screenY,
                  color: textDraft.color,
                  fontSize: textDraft.size * textDraft.scale,
                  lineHeight: 1.25,
                }}
              />
            )}
            <div style={styles.zoomBar}>
              <button onClick={() => zoomTo(viewRef.current.scale / 1.25)} style={styles.zoomBtn} title="Zoom out">−</button>
              <button onClick={() => zoomTo(1)} style={styles.zoomPct} title="Reset to 100%">{zoomPct}%</button>
              <button onClick={() => zoomTo(viewRef.current.scale * 1.25)} style={styles.zoomBtn} title="Zoom in">+</button>
              <button onClick={fitToContent} style={styles.zoomFit} title="Fit the drawing to the screen">Fit</button>
            </div>
            {busy && <div style={styles.uploadPill}>{busy}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline-editable board title. Non-owners see it as plain text (the DB
// trigger rejects their rename anyway).
function BoardTitle({ board, canManage, onTitleChange }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(board.title);
  useEffect(() => { setValue(board.title); }, [board.title]);

  if (!canManage || !editing) {
    return (
      <button
        style={{ ...styles.boardTitle, cursor: canManage ? 'text' : 'default' }}
        onClick={() => canManage && setEditing(true)}
        title={canManage ? 'Rename this board' : 'Only the board owner can rename it'}
      >
        {board.title}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { setEditing(false); onTitleChange(value.trim() || 'Untitled board'); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setValue(board.title); setEditing(false); } }}
      style={styles.titleInput}
    />
  );
}

// ─── Board list ──────────────────────────────────────────────────────

function relativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Whiteboard({ onBack }) {
  const { user, isAdmin } = useAuth();
  const confirm = useConfirm();
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [creating, setCreating] = useState(false);

  const fetchBoards = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('whiteboards')
      .select('id, title, created_by, updated_at, created_at, creator:profiles!whiteboards_created_by_fkey(id, full_name, nickname)')
      .order('updated_at', { ascending: false });
    if (error) setListError(error.message);
    else { setBoards(data || []); setListError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchBoards(); }, [fetchBoards]);

  const activeBoard = useMemo(() => boards.find((b) => b.id === activeId) || null, [boards, activeId]);

  const createBoard = useCallback(async () => {
    setCreating(true);
    const { data, error } = await supabase
      .from('whiteboards')
      .insert({ title: 'Untitled board', created_by: user?.id, updated_by: user?.id })
      .select('id, title, created_by, updated_at, created_at, creator:profiles!whiteboards_created_by_fkey(id, full_name, nickname)')
      .single();
    setCreating(false);
    if (error) { setListError(error.message); return; }
    setBoards((prev) => [data, ...prev]);
    setActiveId(data.id);
  }, [user?.id]);

  const deleteBoard = useCallback(async (board, e) => {
    e.stopPropagation();
    if (!(await confirm(`Delete "${board.title}"? This cannot be undone.`))) return;
    const { error } = await supabase.from('whiteboards').delete().eq('id', board.id);
    if (error) { setListError(error.message); return; }
    setBoards((prev) => prev.filter((b) => b.id !== board.id));
  }, [confirm]);

  const renameBoard = useCallback(async (title) => {
    if (!activeId) return;
    const { error } = await supabase.from('whiteboards').update({ title }).eq('id', activeId);
    if (error) { setListError(error.message); return; }
    setBoards((prev) => prev.map((b) => (b.id === activeId ? { ...b, title } : b)));
  }, [activeId]);

  if (activeBoard) {
    return (
      <BoardCanvas
        key={activeBoard.id}
        board={activeBoard}
        onBack={() => { setActiveId(null); fetchBoards(); }}
        onTitleChange={renameBoard}
      />
    );
  }

  return (
    <div style={styles.listRoot}>
      <div style={styles.listHeader}>
        <div>
          <h1 style={styles.heading}>Whiteboard</h1>
          <p style={styles.subheading}>Shared canvases for shot plans, set diagrams, and anything you'd sketch on a napkin.</p>
        </div>
        <div style={styles.headerActions}>
          {onBack && <button onClick={onBack} style={styles.ghostBtn}>Back</button>}
          <button onClick={createBoard} disabled={creating} style={styles.primaryBtn}>
            {creating ? 'Creating…' : '+ New board'}
          </button>
        </div>
      </div>

      {listError && <div style={styles.listError}>{listError}</div>}

      {loading ? (
        <div style={styles.emptyState}>Loading boards…</div>
      ) : boards.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}><Icon name="pen" /></div>
          <h3 style={styles.emptyTitle}>No boards yet</h3>
          <p style={styles.emptyDesc}>Boards are shared with the whole team — anyone on staff can draw on them.</p>
          <button onClick={createBoard} disabled={creating} style={styles.primaryBtn}>+ New board</button>
        </div>
      ) : (
        <div style={styles.grid}>
          {boards.map((b) => {
            const mine = b.created_by === user?.id;
            return (
              <button key={b.id} onClick={() => setActiveId(b.id)} style={styles.card}>
                <div style={styles.cardCanvasStub}>
                  <Icon name="pen" />
                </div>
                <div style={styles.cardTitle}>{b.title}</div>
                <div style={styles.cardMeta}>
                  <span>{relativeTime(b.updated_at)}</span>
                  <span>{mine ? 'You' : getDisplayName(b.creator) || 'Team'}</span>
                </div>
                {(mine || isAdmin) && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => deleteBoard(b, e)}
                    onKeyDown={(e) => { if (e.key === 'Enter') deleteBoard(b, e); }}
                    style={styles.cardDelete}
                    title="Delete board"
                  >
                    <Icon name="trash" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const styles = {
  // List
  listRoot: {
    padding: `${spacing.xxxl}px ${spacing.xxl}px`,
    fontFamily,
    color: colors.text,
    minHeight: '100%',
    background: colors.bg,
  },
  listHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginBottom: spacing.xxl,
  },
  heading: {
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
    margin: 0,
    color: colors.text,
  },
  subheading: {
    fontSize: fontSizes.md,
    color: colors.textSubtle,
    margin: `${spacing.xs}px 0 0`,
  },
  headerActions: { display: 'flex', gap: spacing.sm, flexShrink: 0 },
  primaryBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`,
    background: colors.accent,
    border: 'none',
    borderRadius: radii.md,
    color: colors.white,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  ghostBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    color: colors.textMuted,
    fontSize: fontSizes.md,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  listError: {
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radii.md,
    background: colors.danger.bg,
    border: `1px solid ${colors.danger.border}`,
    color: colors.danger.fgSoft,
    fontSize: fontSizes.sm,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: spacing.lg,
  },
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
    padding: spacing.lg,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    color: colors.text,
    transition: transitions.fast,
  },
  cardCanvasStub: {
    height: 72,
    borderRadius: radii.md,
    background: CANVAS_BG,
    border: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.textDim,
  },
  cardTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: fontSizes.xs,
    color: colors.textDim,
  },
  cardDelete: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    borderRadius: radii.sm,
    color: colors.textDim,
    background: colors.bgOverlay,
    cursor: 'pointer',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.huge}px ${spacing.xxl}px`,
    color: colors.textSubtle,
    fontSize: fontSizes.md,
    textAlign: 'center',
  },
  emptyIcon: { color: colors.textDim },
  emptyTitle: { fontSize: fontSizes.xl, fontWeight: fontWeights.semibold, color: colors.text, margin: 0 },
  emptyDesc: { fontSize: fontSizes.md, color: colors.textSubtle, margin: 0, maxWidth: 420 },

  // Editor shell
  editorRoot: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: colors.bg,
    fontFamily,
    color: colors.text,
    overflow: 'hidden',
  },
  editorTop: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderBottom: `1px solid ${colors.border}`,
    flexShrink: 0,
  },
  boardTitle: {
    background: 'transparent',
    border: 'none',
    color: colors.text,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    fontFamily: 'inherit',
    padding: `${spacing.xs}px ${spacing.sm}px`,
  },
  titleInput: {
    background: colors.bgInput,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.sm,
    color: colors.text,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    fontFamily: 'inherit',
    padding: `${spacing.xs}px ${spacing.sm}px`,
    outline: 'none',
  },
  saveState: {
    fontSize: fontSizes.xs,
    color: colors.textDim,
    minWidth: 56,
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: radii.md,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  hiddenInput: { display: 'none' },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.sm}px ${spacing.lg}px`,
    background: colors.warning.bg,
    borderBottom: `1px solid ${colors.warning.border}`,
    color: colors.warning.fgSoft,
    fontSize: fontSizes.sm,
    flexShrink: 0,
  },
  bannerBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`,
    borderRadius: radii.sm,
    background: colors.accent,
    border: 'none',
    color: colors.white,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  bannerGhostBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`,
    borderRadius: radii.sm,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  editorBody: { display: 'flex', flex: 1, minHeight: 0 },
  rail: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRight: `1px solid ${colors.border}`,
    background: colors.bgRaised,
    flexShrink: 0,
  },
  railBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 38,
    height: 38,
    borderRadius: radii.md,
    background: 'transparent',
    border: '1px solid transparent',
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  railBtnActive: {
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
    color: colors.accentFg,
  },
  railDivider: {
    height: 1,
    background: colors.border,
    margin: `${spacing.xs}px 0`,
  },
  canvasArea: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  optionBar: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bgRaised,
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  optionLabel: {
    fontSize: fontSizes.xs,
    color: colors.textDim,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  swatches: { display: 'flex', alignItems: 'center', gap: spacing.xs },
  swatch: {
    position: 'relative',
    width: 20,
    height: 20,
    borderRadius: radii.sm,
    border: `1px solid ${colors.borderStrong}`,
    cursor: 'pointer',
    padding: 0,
  },
  swatchActive: {
    outline: `2px solid ${colors.accent}`,
    outlineOffset: '1px',
  },
  noFillSlash: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    background: colors.danger.fg,
    transform: 'rotate(-45deg)',
  },
  customSwatch: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: radii.sm,
    border: `1px solid ${colors.borderStrong}`,
    cursor: 'pointer',
    background: 'conic-gradient(#ef4444, #f59e0b, #22c55e, #38bdf8, #8b5cf6, #ec4899, #ef4444)',
  },
  customSwatchInner: { width: 8, height: 8, borderRadius: radii.circle, background: colors.bg },
  widthBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    borderRadius: radii.sm,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    cursor: 'pointer',
    padding: 0,
  },
  widthBtnActive: { background: colors.accentSoft, border: `1px solid ${colors.accentBorder}` },
  widthDot: { display: 'block', borderRadius: radii.circle, background: colors.text },
  sizeBtn: {
    minWidth: 30,
    height: 26,
    borderRadius: radii.sm,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  sizeBtnActive: {
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
    color: colors.accentFg,
  },
  selCount: { fontSize: fontSizes.xs, color: colors.accentFg },
  hintText: { fontSize: fontSizes.xs, color: colors.textDim },
  canvasWrap: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    background: CANVAS_BG,
  },
  canvas: { display: 'block', width: '100%', height: '100%', touchAction: 'none' },
  canvasLoading: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.textDim,
    fontSize: fontSizes.md,
  },
  textOverlay: {
    position: 'absolute',
    minWidth: 120,
    minHeight: 32,
    padding: 0,
    background: 'transparent',
    border: `1px dashed ${colors.accentBorder}`,
    outline: 'none',
    resize: 'none',
    fontFamily,
    overflow: 'hidden',
  },
  zoomBar: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.lg,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    boxShadow: shadows.md,
  },
  zoomBtn: {
    width: 26,
    height: 26,
    borderRadius: radii.sm,
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    fontSize: fontSizes.lg,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  zoomPct: {
    minWidth: 48,
    height: 26,
    borderRadius: radii.sm,
    background: 'transparent',
    border: 'none',
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  zoomFit: {
    height: 26,
    padding: `0 ${spacing.sm}px`,
    borderRadius: radii.sm,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  uploadPill: {
    position: 'absolute',
    left: '50%',
    bottom: spacing.lg,
    transform: 'translateX(-50%)',
    padding: `${spacing.xs}px ${spacing.md}px`,
    borderRadius: radii.pill,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    color: colors.textMuted,
    fontSize: fontSizes.sm,
  },
};
