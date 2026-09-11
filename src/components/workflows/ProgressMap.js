// Progress Map — a read-only "studio floor" mirror of the Workflows Progress
// table, borrowing the Funnel view's mechanics (src/pages/projects/Pipeline.js):
// a pannable/zoomable canvas (scroll to zoom toward the cursor, drag to pan)
// with three zones, top to bottom:
//
//   cloud   tasks whose assignee isn't on the roster below float at the top
//   desks   one shaded container per person from the Progress groups (Team +
//           Contractors mixed on one magnetic-cloud ellipse; contractors get
//           the small "C" badge), stacking that person's pending task cards
//   done    a single "Done · 7d" zone at the bottom collecting completions
//           inside the table's 7-day window
//
// Cards move only because the underlying data moved — the shared pipeline.css
// transition glides them. Every pending card's dotted arrow points where it
// goes when finished: the Done zone. Status coloring matches the table's dots
// (active yellow / hold orange / snoozed purple / pending blue / done green),
// with the same sprint-overlay precedence: Done > Holding > Active.
//
// The view mutates nothing. Clicking a card fires onTaskClick with the same
// contract as ProgressTable (mirror rows — progress-*/sprint-* ids — are not
// clickable).

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../lib/styleTokens';
import '../../pages/projects/pipeline.css';

// ── Geometry (mirrors Pipeline.js) ────────────────────────────
const CANVAS_W   = 1480;
const PAD        = 32;
const CARD_GAP   = 14;
const DESK_COLS  = 3;    // cards per row inside a desk
const DESK_CARD_GAP = 10;
const DESK_PAD_X = 12;
const DESK_HEAD  = 46;
const DESK_MIN_H = 150;
const ZONE_GAP   = 90;
const ZOOM_MIN   = 0.3;
const ZOOM_MAX   = 2.5;

const CARD = { w: 164, h: 58 };       // pending task card
const DONE_CARD = { w: 156, h: 40 };  // smaller chip inside the Done zone
const DONE_COL_GAP = 16;              // gap between per-person Done columns
const DONE_COL_PAD = 10;
const DONE_HEAD = 64;                 // zone title + column name header

// Desks size to their load: 1–3 card columns wide, so empty desks stay small
// and the ring stays tight.
function deskColsFor(count) {
  return Math.max(1, Math.min(DESK_COLS, count));
}
function deskWidthFor(count) {
  const cols = deskColsFor(count);
  return cols * CARD.w + (cols - 1) * DESK_CARD_GAP + 2 * DESK_PAD_X;
}

// Status palette — same hues as the ProgressTable dots/pills.
const STATUS_STYLE = {
  active:  { color: '#facc15', label: 'Active' },
  planned: { color: '#facc15', label: 'Planned' },
  snoozed: { color: '#a855f7', label: 'Snoozed' },
  hold:    { color: '#fb923c', label: 'On Hold' },
  pending: { color: '#8fb4d8', label: 'Pending' },
  done:    { color: '#22c55e', label: 'Done' },
};
const DONE_COLOR = STATUS_STYLE.done.color;

function fmtShort(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Stable 0..1 hash — float phases, desk jitter (same as Pipeline).
function hash01(id, salt = '') {
  const s = String(id) + salt;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h / 9973;
}

function isMirrorRow(task) {
  return typeof task.id !== 'string'
    || task.id.startsWith('progress-')
    || task.id.startsWith('sprint-');
}

export default function ProgressMap({
  groups,
  sprintActiveTaskIds,
  sprintHoldingTaskIds,
  sprintDoneTaskIds,
  onTaskClick,
}) {
  // Avatars/nicknames aren't in the Progress profiles — one lookup here.
  const [avatars, setAvatars] = useState({});
  useEffect(() => {
    const ids = (groups || []).flatMap((g) => (g.profiles || []).map((p) => p.id));
    if (ids.length === 0) return;
    supabase
      .from('profiles')
      .select('id, avatar_url, nickname')
      .in('id', ids)
      .then(({ data }) => {
        if (data) setAvatars(Object.fromEntries(data.map((p) => [p.id, p])));
      });
  }, [groups]);

  // Camera: translate + scale, like the Funnel / Whiteboard.
  const [view, setView] = useState({ x: 0, y: 0, k: 0.9 });
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const fittedRef = useRef(false);

  // ── Derivations ─────────────────────────────────────────────

  // Everyone with a desk, in one alphabetized band (contractors mixed in).
  const members = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const g of groups || []) {
      for (const p of g.profiles || []) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push({ ...p, contractor: g.key === 'contractors' });
      }
    }
    return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [groups]);

  const deskable = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  // Flatten the byAssignee buckets into placed cards with a resolved status,
  // mirroring PersonRow's precedence exactly: sprint Done > Holding > Active,
  // then snooze / on_hold / planned off tasks.status.
  const { pendingCards, doneCards } = useMemo(() => {
    const inSet = (set, t) => !!(set && set.has(t.id));
    const nowMs = Date.now();
    const pending = [];
    const done = [];
    const doneSeen = new Set();
    const pushDone = (t, owner, groupKey) => {
      if (doneSeen.has(t.id)) return;
      doneSeen.add(t.id);
      done.push({ t, owner, groupKey });
    };
    for (const g of groups || []) {
      const by = g.byAssignee || {};
      for (const [ownerId, bucket] of Object.entries(by)) {
        for (const t of bucket.pending || []) {
          if (inSet(sprintDoneTaskIds, t)) { pushDone(t, ownerId, g.key); continue; }
          const sprintHold = inSet(sprintHoldingTaskIds, t);
          const sprintActive = !sprintHold && inSet(sprintActiveTaskIds, t);
          const snoozed = !sprintActive && !sprintHold
            && t.snoozed_until && new Date(t.snoozed_until).getTime() > nowMs;
          let status = 'pending';
          if (sprintActive) status = 'active';
          else if (sprintHold || t.status === 'on_hold') status = 'hold';
          else if (snoozed) status = 'snoozed';
          else if (t.planned_date) status = 'planned';
          pending.push({ t, owner: ownerId, groupKey: g.key, status });
        }
        for (const t of bucket.done || []) pushDone(t, ownerId, g.key);
      }
    }
    // Newest completions first so the zone reads like a feed.
    done.sort((a, b) => new Date(b.t.completed_at || 0) - new Date(a.t.completed_at || 0));
    return { pendingCards: pending, doneCards: done };
  }, [groups, sprintActiveTaskIds, sprintHoldingTaskIds, sprintDoneTaskIds]);

  // ── Layout ──────────────────────────────────────────────────

  const layout = useMemo(() => {
    const cloudCards = pendingCards.filter((c) => !deskable.has(c.owner));
    const byDesk = {};
    for (const c of pendingCards) {
      if (deskable.has(c.owner)) (byDesk[c.owner] = byDesk[c.owner] || []).push(c);
    }

    const n = Math.max(members.length, 1);
    const nameOf = Object.fromEntries(members.map((m) => [m.id, m.name || '']));

    // Ring circumference fits the ACTUAL desk widths (empty desks are narrow),
    // so the floor stays tight instead of spreading to the worst case.
    const deskWs = members.map((m) => deskWidthFor((byDesk[m.id] || []).length));
    const maxDeskW = Math.max(...deskWs, deskWidthFor(1));
    const sumDeskW = deskWs.reduce((s, w) => s + w, 0) || deskWidthFor(1);
    const rx = Math.max(420, ((sumDeskW + n * 56) / (2 * Math.PI)) * 1.25);
    const ry = Math.max(210, rx * 0.42);

    // Done zone grouping happens up front so the canvas width can fit it:
    // one column per person, busiest first.
    const doneByOwner = new Map();
    for (const c of doneCards) {
      if (!doneByOwner.has(c.owner)) doneByOwner.set(c.owner, []);
      doneByOwner.get(c.owner).push(c);
    }
    const owners = [...doneByOwner.keys()].sort((a, b) => {
      const diff = doneByOwner.get(b).length - doneByOwner.get(a).length;
      return diff || (nameOf[a] || '').localeCompare(nameOf[b] || '');
    });
    const colW = DONE_CARD.w + 2 * DONE_COL_PAD;
    const doneW = owners.length
      ? owners.length * colW + (owners.length - 1) * DONE_COL_GAP + 2 * DONE_COL_PAD
      : 320;

    const W = Math.max(
      CANVAS_W,
      Math.ceil(2 * rx + maxDeskW + 2 * PAD + 160),
      doneW + 2 * PAD,
    );

    const positions = {};   // task id → { x, y, w, h, zone }
    const desks = [];

    // Cloud — centered rows, slight jitter.
    const cloudTop = 48;
    const maxRowW = W - 2 * PAD - 120;
    let rows = [[]];
    let rowW = 0;
    for (const c of cloudCards) {
      if (rowW + CARD.w + CARD_GAP > maxRowW && rows[rows.length - 1].length > 0) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push(c);
      rowW += CARD.w + CARD_GAP;
    }
    let cloudY = cloudTop;
    for (const row of rows) {
      if (row.length === 0) continue;
      const total = row.length * CARD.w + (row.length - 1) * CARD_GAP;
      let x = (W - total) / 2;
      for (const c of row) {
        const jy = (hash01(c.t.id, 'cy') - 0.5) * 18;
        positions[c.t.id] = { x, y: cloudY + jy, w: CARD.w, h: CARD.h, zone: 'cloud' };
        x += CARD.w + CARD_GAP;
      }
      cloudY += CARD.h + CARD_GAP + 6;
    }
    const cloudBottom = Math.max(cloudY, cloudTop + 90);

    // Desk band — one ellipse, alternating radial stagger, then a
    // deterministic overlap-relaxation pass (all copied from the Funnel).
    const deskHeight = (memberId) => {
      const cards = byDesk[memberId] || [];
      const cardRows = Math.ceil(cards.length / deskColsFor(cards.length));
      const stack = cardRows * (CARD.h + 10);
      return Math.max(DESK_MIN_H, DESK_HEAD + Math.max(stack, 84) + 16);
    };
    const maxDeskH = Math.max(...members.map((m) => deskHeight(m.id)), DESK_MIN_H);
    const cx = W / 2;
    const cy = cloudBottom + ZONE_GAP + ry + maxDeskH / 2;

    members.forEach((m, i) => {
      const t = -Math.PI / 2 + ((i + 0.5) / n) * 2 * Math.PI;
      const stagger = 1 + (i % 2 === 0 ? 0.1 : -0.1);
      const jx = (hash01(m.id, 'dx') - 0.5) * 20;
      const jy = (hash01(m.id, 'dy') - 0.5) * 28;
      const h = deskHeight(m.id);
      const w = deskWidthFor((byDesk[m.id] || []).length);
      desks.push({
        member: m,
        x: cx + rx * stagger * Math.cos(t) - w / 2 + jx,
        y: cy + ry * stagger * Math.sin(t) - h / 2 + jy,
        w, h,
        contractor: m.contractor,
      });
    });

    const MARGIN = 30;
    for (let pass = 0; pass < 40; pass++) {
      let moved = false;
      for (let a = 0; a < desks.length; a++) {
        for (let b = a + 1; b < desks.length; b++) {
          const A = desks[a], B = desks[b];
          const overlapX = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) + MARGIN;
          const overlapY = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) + MARGIN;
          if (overlapX <= 0 || overlapY <= 0) continue;
          moved = true;
          const dx = (A.x + A.w / 2) - (B.x + B.w / 2);
          const dy = (A.y + A.h / 2) - (B.y + B.h / 2);
          if (overlapX < overlapY) {
            const push = (overlapX / 2 + 1) * (dx >= 0 ? 1 : -1);
            A.x += push; B.x -= push;
          } else {
            const push = (overlapY / 2 + 1) * (dy >= 0 ? 1 : -1);
            A.y += push; B.y -= push;
          }
        }
      }
      if (!moved) break;
    }

    // Up to DESK_COLS cards per row inside a desk; partial rows center.
    for (const d of desks) {
      const cards = byDesk[d.member.id] || [];
      const cols = deskColsFor(cards.length);
      cards.forEach((c, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const rowCount = Math.min(cols, cards.length - row * cols);
        const rowW = rowCount * CARD.w + (rowCount - 1) * DESK_CARD_GAP;
        positions[c.t.id] = {
          x: d.x + (d.w - rowW) / 2 + col * (CARD.w + DESK_CARD_GAP),
          y: d.y + DESK_HEAD + row * (CARD.h + 10),
          w: CARD.w, h: CARD.h, zone: 'desk',
        };
      });
    }

    const bandBottom = Math.max(...desks.map((d) => d.y + d.h), cloudBottom + 200);

    // Done zone — one column per person, chips stacked newest-first.
    const doneTop = bandBottom + ZONE_GAP;
    const doneX = (W - doneW) / 2;
    const doneColumns = [];
    let maxColH = 0;
    owners.forEach((ownerId, ci) => {
      const cards = doneByOwner.get(ownerId);
      const colX = doneX + DONE_COL_PAD + ci * (colW + DONE_COL_GAP);
      cards.forEach((c, i) => {
        positions[c.t.id] = {
          x: colX + DONE_COL_PAD,
          y: doneTop + DONE_HEAD + i * (DONE_CARD.h + 8),
          w: DONE_CARD.w, h: DONE_CARD.h, zone: 'done',
        };
      });
      maxColH = Math.max(maxColH, cards.length * (DONE_CARD.h + 8));
      doneColumns.push({ owner: ownerId, x: colX, w: colW, count: cards.length });
    });
    const doneH = DONE_HEAD + Math.max(maxColH, 60) + 14;
    const done = { x: doneX, y: doneTop, w: doneW, h: doneH };

    return {
      W,
      H: doneTop + doneH + PAD,
      positions,
      desks,
      done,
      doneColumns,
      cloud: { cx: W / 2, bottom: cloudBottom },
    };
  }, [pendingCards, doneCards, members, deskable]);

  // Arrow endpoints — every pending card points at the Done zone.
  const arrows = useMemo(() => {
    const to = { x: layout.done.x + layout.done.w / 2, y: layout.done.y - 6 };
    const out = [];
    for (const c of pendingCards) {
      const pos = layout.positions[c.t.id];
      if (!pos) continue;
      out.push({
        id: c.t.id,
        from: { x: pos.x + pos.w / 2, y: pos.y + pos.h },
        to,
        color: STATUS_STYLE[c.status].color,
      });
    }
    return out;
  }, [pendingCards, layout]);

  // ── Camera (same handlers as the Funnel) ───────────────────

  const fitView = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const k = Math.min((vw - 32) / layout.W, (vh - 32) / layout.H, 1);
    setView({
      k,
      x: (vw - layout.W * k) / 2,
      y: Math.max(16, (vh - layout.H * k) / 2),
    });
  }, [layout.W, layout.H]);

  const hasData = members.length > 0;
  useEffect(() => {
    if (!hasData || fittedRef.current) return;
    fittedRef.current = true;
    fitView();
  }, [hasData, fitView]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * Math.exp(-e.deltaY * 0.0016)));
        const scale = k / v.k;
        return { k, x: px - (px - v.x) * scale, y: py - (py - v.y) * scale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasData]);

  function onMouseDown(e) {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    movedRef.current = false;
  }

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true;
      setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── Render ──────────────────────────────────────────────────

  if (!hasData) {
    return <div style={{ color: colors.textDim, padding: spacing.xl, textAlign: 'center' }}>Loading map…</div>;
  }

  const cloudCount = pendingCards.filter((c) => !deskable.has(c.owner)).length;

  function handleCardClick(c, person, groupKey) {
    if (movedRef.current || isMirrorRow(c.t) || !onTaskClick) return;
    onTaskClick(c.t, person || null, groupKey);
  }

  const memberById = Object.fromEntries(members.map((m) => [m.id, m]));

  return (
    <div
      ref={viewportRef}
      onMouseDown={onMouseDown}
      style={{
        position: 'relative', height: '76vh', overflow: 'hidden',
        borderRadius: radii.md, border: `1px solid ${colors.border}`,
        background: 'rgba(255,255,255,0.012)',
        cursor: dragRef.current ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      {/* Zoom controls */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 6 }}>
        {[
          { label: '−', fn: () => setView((v) => ({ ...v, k: Math.max(ZOOM_MIN, v.k / 1.25) })) },
          { label: '+', fn: () => setView((v) => ({ ...v, k: Math.min(ZOOM_MAX, v.k * 1.25) })) },
          { label: '⤢', fn: fitView, title: 'Fit to view' },
        ].map((b) => (
          <button
            key={b.label} type="button" title={b.title} onClick={b.fn}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: 30, height: 30, borderRadius: radii.sm,
              border: `1px solid ${colors.border}`, background: colors.bgRaised,
              color: colors.textSubtle, fontSize: fontSizes.md, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div style={{
        position: 'absolute', left: 0, top: 0,
        width: layout.W, height: layout.H,
        transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
        transformOrigin: '0 0',
      }}>

        {/* Routing arrows */}
        <svg width={layout.W} height={layout.H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {arrows.map((a) => {
            const midY = (a.from.y + a.to.y) / 2;
            const path = `M ${a.from.x} ${a.from.y} C ${a.from.x} ${midY}, ${a.to.x} ${midY}, ${a.to.x} ${a.to.y}`;
            const dir = a.to.y >= a.from.y ? 1 : -1;
            return (
              <g key={a.id}>
                <path d={path} fill="none" stroke={a.color} strokeWidth="1.4" className="pipe-arrow" />
                <polygon
                  points={`${a.to.x},${a.to.y} ${a.to.x - 4.5},${a.to.y - dir * 8} ${a.to.x + 4.5},${a.to.y - dir * 8}`}
                  fill={a.color}
                  opacity="0.7"
                />
              </g>
            );
          })}
        </svg>

        {/* Cloud label */}
        <div style={{ position: 'absolute', top: 10, left: 0, right: 0, textAlign: 'center', color: colors.textDim, fontSize: fontSizes.xs, letterSpacing: 2, textTransform: 'uppercase' }}>
          ☁ Off-roster{cloudCount ? ` · ${cloudCount}` : ''}
        </div>
        {cloudCount === 0 && (
          <div style={{ position: 'absolute', top: 64, left: 0, right: 0, textAlign: 'center', color: colors.textDim, fontSize: fontSizes.sm, opacity: 0.6 }}>
            Every open task belongs to someone on the floor.
          </div>
        )}

        {/* Desks */}
        {layout.desks.map((d) => {
          const av = avatars[d.member.id];
          return (
            <div key={d.member.id} style={{
              position: 'absolute', left: d.x, top: d.y, width: d.w, height: d.h,
              border: `1.5px dashed ${colors.border}`, borderRadius: radii.md,
              background: 'rgba(255,255,255,0.03)',
            }}>
              <div style={{
                position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)',
                width: 32, height: 32, borderRadius: '50%', overflow: 'hidden',
                border: `2px solid ${colors.border}`, background: colors.bgInput,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: colors.textSubtle, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold,
              }}>
                {av?.avatar_url
                  ? <img src={av.avatar_url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (d.member.name || '?').charAt(0)}
              </div>
              <div style={{ textAlign: 'center', marginTop: 20, color: colors.textSubtle, fontSize: fontSizes.xs, fontWeight: fontWeights.medium }}>
                {av?.nickname || d.member.name}
              </div>
              {d.contractor && (
                <div title="Contractor" style={{
                  position: 'absolute', bottom: -11, left: '50%', transform: 'translateX(-50%)',
                  width: 22, height: 22, borderRadius: '50%',
                  border: `1.5px solid ${colors.border}`, background: colors.bgRaised,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: colors.textDim, fontSize: 10, fontWeight: fontWeights.semibold,
                  opacity: 0.8,
                }}>
                  C
                </div>
              )}
            </div>
          );
        })}

        {/* Pending cards */}
        {pendingCards.map((c) => {
          const pos = layout.positions[c.t.id];
          if (!pos) return null;
          const st = STATUS_STYLE[c.status];
          const phase = hash01(c.t.id);
          const clickable = !isMirrorRow(c.t) && !!onTaskClick;
          const statusLine = c.status === 'planned' && c.t.planned_date
            ? `Planned · ${fmtShort(c.t.planned_date + 'T00:00:00')}`
            : st.label;
          return (
            <div
              key={c.t.id}
              className="pipe-card"
              style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h, zIndex: 2 }}
            >
              <div
                className={pos.zone === 'cloud' ? 'pipe-float' : undefined}
                onClick={() => handleCardClick(c, memberById[c.owner], c.groupKey)}
                title={clickable ? 'Click to edit' : c.t.title}
                style={{
                  position: 'relative',
                  width: '100%', height: '100%', boxSizing: 'border-box',
                  padding: `${spacing.xs}px ${spacing.sm}px`,
                  borderRadius: radii.md, cursor: clickable ? 'pointer' : 'default',
                  border: `1px solid ${st.color}55`,
                  background: `linear-gradient(${st.color}1f, ${st.color}10), ${colors.bgInput}`,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                  textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
                  animationDelay: `${-phase * 5.2}s`, animationDuration: `${4.6 + phase * 1.6}s`,
                }}
              >
                <div style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.t.title}
                </div>
                {c.t.due_date && (
                  <div style={{ color: colors.textSubtle, fontSize: fontSizes.xs }}>
                    Due {fmtShort(c.t.due_date)}
                  </div>
                )}
                <div className="pipe-blink" style={{ color: st.color, fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, letterSpacing: 1, textTransform: 'uppercase' }}>
                  {statusLine}
                </div>
              </div>
            </div>
          );
        })}

        {/* Done zone + its cards */}
        <div style={{
          position: 'absolute', left: layout.done.x, top: layout.done.y,
          width: layout.done.w, height: layout.done.h,
          border: `1.5px solid ${DONE_COLOR}44`, borderRadius: radii.md,
          background: `linear-gradient(${DONE_COLOR}10, transparent), rgba(255,255,255,0.02)`,
          boxSizing: 'border-box',
        }}>
          <div style={{ textAlign: 'center', marginTop: 12, color: DONE_COLOR, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, letterSpacing: 1, textTransform: 'uppercase' }}>
            Done · 7d{doneCards.length ? ` · ${doneCards.length}` : ''}
          </div>
          {doneCards.length === 0 && (
            <div style={{ textAlign: 'center', marginTop: 18, color: colors.textDim, fontSize: fontSizes.xs, opacity: 0.7 }}>
              Nothing finished this week yet.
            </div>
          )}
        </div>

        {/* Per-person Done columns */}
        {layout.doneColumns.map((col) => (
          <div key={col.owner} style={{
            position: 'absolute', left: col.x, top: layout.done.y + 34,
            width: col.w, height: layout.done.h - 44,
            border: `1px dashed ${DONE_COLOR}30`, borderRadius: radii.sm,
            background: `${DONE_COLOR}06`, boxSizing: 'border-box',
          }}>
            <div style={{
              textAlign: 'center', marginTop: 5, padding: '0 6px',
              color: colors.textSubtle, fontSize: 10, fontWeight: fontWeights.semibold,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {memberById[col.owner]?.name || 'Off-roster'} · {col.count}
            </div>
          </div>
        ))}
        {doneCards.map((c) => {
          const pos = layout.positions[c.t.id];
          if (!pos) return null;
          const clickable = !isMirrorRow(c.t) && !!onTaskClick;
          const who = memberById[c.owner];
          return (
            <div
              key={c.t.id}
              className="pipe-card"
              style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h, zIndex: 2 }}
            >
              <div
                onClick={() => handleCardClick(c, who, c.groupKey)}
                title={`${c.t.title}${who ? ` — ${who.name}` : ''}`}
                style={{
                  width: '100%', height: '100%', boxSizing: 'border-box',
                  padding: `2px ${spacing.sm}px`,
                  borderRadius: radii.sm, cursor: clickable ? 'pointer' : 'default',
                  border: `1px solid ${DONE_COLOR}40`,
                  background: `linear-gradient(${DONE_COLOR}14, ${DONE_COLOR}08), ${colors.bgInput}`,
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1,
                  textAlign: 'center', opacity: 0.85,
                }}
              >
                <div style={{ color: colors.text, fontSize: fontSizes.xs, fontWeight: fontWeights.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.t.title}
                </div>
                {c.t.completed_at && (
                  <div style={{ color: colors.textDim, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fmtShort(c.t.completed_at)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
