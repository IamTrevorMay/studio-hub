// Pipeline — a read-only "studio floor" mirror of the Kanban's own data.
//
// This view creates and mutates nothing about project state; the board stays
// the system of record. Three zones, top to bottom, on a pannable/zoomable
// canvas (scroll to zoom toward the cursor, drag anywhere to pan):
//
//   cloud    in-flight projects whose CURRENT stage has no assignee float
//            in a loose cluster at the top
//   desks    one shaded container per active member, arranged as a loose
//            "magnetic cloud" ellipse around a center (Obsidian-graph style)
//            rather than a grid. Contractors mix in with everyone else and
//            carry a small "C" badge under their desk
//   buckets  five output goals (YT Long, YT Short, Instagram, TikTok,
//            Facebook). A published project's card leaves the floor and
//            lights an indicator in each bucket it feeds, counted inside a
//            global weekly/monthly PT window
//
// Cards move only because the underlying data moved (card-move via the board,
// clip creation, assignment edits) — the page polls and the CSS transition
// makes the card glide to its new home. Long-form cards render larger than
// short-form ones. Each card shows a faint pulsing arrow, colored by project
// type, toward where it goes next: the next stage's assignee desk, the cloud
// if that stage is unowned, or its bucket when the next stop is Published.
//
// Goals: right-click a bucket to set its goal count and the global window
// (weekly/monthly — shared by all buckets). Stored in pipeline_goals /
// pipeline_settings (admin-only RLS; this whole view is admin-only).

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import useVisibilityRefresh from '../../hooks/useVisibilityRefresh';
import { CANONICAL_STAGES, STAGE_COLORS, SHORT_FORM_PLATFORMS, labelFor, typeLabel, typeColors } from '../../lib/kanbanStages';
import { ptDayKey, ptWeekStartKey } from '../../lib/ptDate';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../lib/styleTokens';
import backdropDismiss from '../../lib/backdropDismiss';
import './pipeline.css';

// ── Constants ─────────────────────────────────────────────────

// Emily Jude — excluded from the desk band by request (2026-09-10).
const EXCLUDED_DESK_IDS = new Set(['712f6910-7262-4551-8cb4-9dc609ef91fb']);

// Statuses that put a card on the floor. Backlog is parked and publish lives
// in the buckets; Queue rides along — its cards are (almost always) unowned,
// so they float in the cloud.
const FLOOR_STAGES = new Set(CANONICAL_STAGES.filter((s) => s !== 'publish'));

const LONG_FORM_TYPES = ['mayday_video', 'tm_baseball_video', 'podcast'];

const BUCKETS = [
  { key: 'yt_long',   label: 'YouTube Long',  color: '#f87171' },
  { key: 'yt_short',  label: 'YouTube Short', color: '#fb923c' },
  { key: 'instagram', label: 'Instagram',     color: '#E4405F' },
  { key: 'tiktok',    label: 'TikTok',        color: '#00F2EA' },
  { key: 'facebook',  label: 'Facebook',      color: '#1877F2' },
];
const BUCKET_INDEX = Object.fromEntries(BUCKETS.map((b, i) => [b.key, i]));

// Which bucket(s) a project feeds when it publishes. Long-form types are one
// YouTube long-form video; short_form routes by its platform list. Twitter
// stays pickable on shorts but has no bucket, so it simply lights nothing.
const PLATFORM_BUCKET = { youtube: 'yt_short', instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook' };
function bucketsForProject(p) {
  if (LONG_FORM_TYPES.includes(p.type)) return ['yt_long'];
  if (p.type === 'short_form') {
    return (p.short_form_platforms || []).map((pl) => PLATFORM_BUCKET[pl]).filter(Boolean);
  }
  return [];
}

// ── Geometry ──────────────────────────────────────────────────
const CANVAS_W   = 1480;
const PAD        = 32;
const CARD_GAP   = 16;
const DESK_W     = 240;
const DESK_HEAD  = 46;   // room under the avatar pin before cards start
const DESK_MIN_H = 164;
const BUCKET_H   = 158;
const ZONE_GAP   = 90;
const ZOOM_MIN   = 0.3;
const ZOOM_MAX   = 2.5;

// Long-form cards are deliberately bigger than short-form ones.
function cardSize(p) {
  return LONG_FORM_TYPES.includes(p.type)
    ? { w: 196, h: 96 }
    : { w: 150, h: 74 };
}

// ── PT window helpers ─────────────────────────────────────────

// Midnight PT for a YYYY-MM-DD key, DST-proof: try both offsets and keep the
// one where the instant is the first millisecond of that PT day.
function ptMidnight(dayKey) {
  for (const off of ['-07:00', '-08:00']) {
    const d = new Date(`${dayKey}T00:00:00${off}`);
    if (ptDayKey(d) === dayKey && ptDayKey(new Date(d.getTime() - 1)) !== dayKey) return d;
  }
  return new Date(`${dayKey}T00:00:00-08:00`);
}

function windowStart(period) {
  const now = new Date();
  if (period === 'monthly') return ptMidnight(`${ptDayKey(now).slice(0, 8)}01`);
  // Monday-start PT week — same boundary as sprints.
  return ptMidnight(ptWeekStartKey(now));
}

function fmtShort(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Stable 0..1 hash — float phases, desk jitter.
function hash01(id, salt = '') {
  const s = id + salt;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h / 9973;
}

// ── Component ─────────────────────────────────────────────────

export default function Pipeline({ onOpenProject }) {
  const [roster, setRoster] = useState([]);
  const [projects, setProjects] = useState([]);
  const [published, setPublished] = useState([]);
  const [goals, setGoals] = useState({});
  const [period, setPeriod] = useState('weekly');
  const [loading, setLoading] = useState(true);
  const [bucketMenu, setBucketMenu] = useState(null); // { bucket, x, y }
  const [detail, setDetail] = useState(null);         // a placedCards entry
  const [typeFilter, setTypeFilter] = useState('all'); // all | long | short

  // Camera: translate + scale, like the Whiteboard.
  const [view, setView] = useState({ x: 0, y: 0, k: 0.9 });
  const viewportRef = useRef(null);
  const dragRef = useRef(null);       // { sx, sy, ox, oy }
  const movedRef = useRef(false);     // suppress card click after a pan
  const fittedRef = useRef(false);

  const fetchAll = useCallback(async () => {
    const monthAgo = new Date(Date.now() - 32 * 86400000).toISOString();
    const [rosterQ, floorQ, pubQ, goalsQ, settingsQ] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, nickname, avatar_url, role')
        .is('deactivated_at', null)
        .in('role', ['admin', 'director', 'member', 'contractor']),
      supabase.from('projects')
        .select('id, name, type, status, deadline, film_date, edit_deadline, on_hold, stage_config, short_form_platforms, parent_project_id, project_stage_assignments(stage, user_id)')
        .is('archived_at', null)
        .in('status', [...FLOOR_STAGES]),
      // Window filtering happens client-side so flipping weekly/monthly
      // recounts instantly; 32 days covers the longest monthly window.
      supabase.from('projects')
        .select('id, type, short_form_platforms, published_at')
        .gte('published_at', monthAgo),
      supabase.from('pipeline_goals').select('bucket, goal'),
      supabase.from('pipeline_settings').select('period').eq('id', 1).maybeSingle(),
    ]);
    if (!rosterQ.error) setRoster(rosterQ.data || []);
    if (!floorQ.error) setProjects(floorQ.data || []);
    if (!pubQ.error) setPublished(pubQ.data || []);
    if (!goalsQ.error) setGoals(Object.fromEntries((goalsQ.data || []).map((g) => [g.bucket, g.goal])));
    if (!settingsQ.error && settingsQ.data) setPeriod(settingsQ.data.period);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const t = setInterval(fetchAll, 25000);
    return () => clearInterval(t);
  }, [fetchAll]);
  useVisibilityRefresh(fetchAll);

  // ── Derivations ─────────────────────────────────────────────

  const rosterById = useMemo(() => Object.fromEntries(roster.map((m) => [m.id, m])), [roster]);
  const staff = useMemo(
    () => roster
      .filter((m) => m.role !== 'contractor' && !EXCLUDED_DESK_IDS.has(m.id))
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')),
    [roster],
  );
  const contractors = useMemo(
    () => roster
      .filter((m) => m.role === 'contractor' && !EXCLUDED_DESK_IDS.has(m.id))
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')),
    [roster],
  );
  const nameById = useMemo(() => {
    const map = {};
    for (const p of projects) map[p.id] = p.name;
    return map;
  }, [projects]);

  const deskable = useMemo(
    () => new Set([...staff, ...contractors].map((m) => m.id)),
    [staff, contractors],
  );

  const placedCards = useMemo(() => projects.map((p) => {
    const current = (p.project_stage_assignments || []).filter((a) => a.stage === p.status);
    const owner = current.find((a) => deskable.has(a.user_id))?.user_id || null;
    const extras = current.filter((a) => a.user_id !== owner).map((a) => rosterById[a.user_id]).filter(Boolean);

    // Next stop: next non-skipped stage → its first desk-able assignee, the
    // cloud if unowned, or a bucket when the next stop is Published.
    const skip = p.stage_config || {};
    const order = CANONICAL_STAGES;
    let idx = order.indexOf(p.status) + 1;
    while (idx < order.length && skip[order[idx]]?.skip) idx += 1;
    const nextStage = idx < order.length ? order[idx] : 'publish';
    let target;
    if (nextStage === 'publish') {
      const b = bucketsForProject(p)[0];
      target = b ? { kind: 'bucket', bucket: b } : null;
    } else {
      const nextOwner = (p.project_stage_assignments || [])
        .filter((a) => a.stage === nextStage)
        .find((a) => deskable.has(a.user_id))?.user_id || null;
      target = nextOwner ? { kind: 'desk', member: nextOwner } : { kind: 'cloud' };
    }
    return { p, owner, extras, nextStage, target, size: cardSize(p) };
  }), [projects, deskable, rosterById]);

  // Long / Short / All filter. Filtered-out cards stay mounted at their last
  // known position and shrink away (`pipe-gone`), so flipping the toggle back
  // glides them home with the same magnetic transition as any data move.
  const visibleCards = useMemo(() => placedCards.filter((c) => {
    if (typeFilter === 'all') return true;
    return LONG_FORM_TYPES.includes(c.p.type) === (typeFilter === 'long');
  }), [placedCards, typeFilter]);

  // ── Layout ──────────────────────────────────────────────────

  const layout = useMemo(() => {
    const cloudCards = visibleCards.filter((c) => !c.owner);
    const byDesk = {};
    for (const c of visibleCards) {
      if (c.owner) (byDesk[c.owner] = byDesk[c.owner] || []).push(c);
    }

    // Ring size first — the canvas must be wide enough to hold the desk
    // ellipse, so W derives from the roster, not the other way around.
    // Contractors mix in alphabetically with everyone else; their desks are
    // marked with a small "C" badge instead of a grouped zone.
    const members = [...staff, ...contractors]
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    // Requested seating tweak (2026-09-10): Trevor and Ethan Jones trade ring
    // slots.
    const SWAP = ['c3290048-436b-46c6-b3f0-fdf7923d0c3b', '219a0098-6530-49a2-98d0-edb59b8ed39a'];
    const si = members.findIndex((m) => m.id === SWAP[0]);
    const sj = members.findIndex((m) => m.id === SWAP[1]);
    if (si >= 0 && sj >= 0) [members[si], members[sj]] = [members[sj], members[si]];
    const n = Math.max(members.length, 1);
    const rx = Math.max(500, (n * (DESK_W + 44)) / (2 * Math.PI) * 1.8);
    const ry = 230;
    const W = Math.max(CANVAS_W, Math.ceil(2 * rx + DESK_W + 2 * PAD + 200));

    const positions = {};   // project id → { x, y, w, h, zone }
    const desks = [];       // { member, x, y, w, h, contractor }

    // Cloud — centered rows of mixed-size cards, slight jitter for an
    // organic drift rather than a grid.
    const cloudTop = 48;
    const maxRowW = W - 2 * PAD - 120;
    let rows = [[]];
    let rowW = 0;
    for (const c of cloudCards) {
      if (rowW + c.size.w + CARD_GAP > maxRowW && rows[rows.length - 1].length > 0) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push(c);
      rowW += c.size.w + CARD_GAP;
    }
    let cloudY = cloudTop;
    for (const row of rows) {
      if (row.length === 0) continue;
      const total = row.reduce((sum, c) => sum + c.size.w, 0) + (row.length - 1) * CARD_GAP;
      let x = (W - total) / 2;
      const rowH = Math.max(...row.map((c) => c.size.h));
      for (const c of row) {
        const jy = (hash01(c.p.id, 'cy') - 0.5) * 18;
        positions[c.p.id] = { x, y: cloudY + (rowH - c.size.h) / 2 + jy, w: c.size.w, h: c.size.h, zone: 'cloud' };
        x += c.size.w + CARD_GAP;
      }
      cloudY += rowH + CARD_GAP + 6;
    }
    const cloudBottom = Math.max(cloudY, cloudTop + 90);

    // Desk band — everyone (staff + contractors) on ONE ellipse around a
    // center, magnetic-cloud style. Contractors take consecutive arc slots so
    // they cluster together on the band's right side.
    const deskHeight = (memberId) => {
      const cards = byDesk[memberId] || [];
      const stack = cards.reduce((sum, c) => sum + c.size.h + 10, 0);
      return Math.max(DESK_MIN_H, DESK_HEAD + Math.max(stack, 84) + 16);
    };
    const maxDeskH = Math.max(...members.map((m) => deskHeight(m.id)), DESK_MIN_H);
    const cx = W / 2;
    const cy = cloudBottom + ZONE_GAP + ry + maxDeskH / 2;

    members.forEach((m, i) => {
      // Start at the top of the ellipse and walk clockwise. Neighbors near
      // the top/bottom arcs compress horizontally, so alternate desks step
      // in/out radially; the relaxation pass below settles any remaining
      // contact.
      const t = -Math.PI / 2 + ((i + 0.5) / n) * 2 * Math.PI;
      const stagger = 1 + (i % 2 === 0 ? 0.12 : -0.12);
      const jx = (hash01(m.id, 'dx') - 0.5) * 20;
      const jy = (hash01(m.id, 'dy') - 0.5) * 28;
      const h = deskHeight(m.id);
      desks.push({
        member: m,
        x: cx + rx * stagger * Math.cos(t) - DESK_W / 2 + jx,
        y: cy + ry * stagger * Math.sin(t) - h / 2 + jy,
        w: DESK_W, h,
        contractor: m.role === 'contractor',
      });
    });

    // Overlap relaxation — push any colliding desk pair apart along the line
    // between their centers until every pair clears a margin. Deterministic
    // (fixed iteration order, no randomness), so positions stay stable.
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
          // Separate along the axis needing the least travel.
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

    // Cards stack inside their desk only after positions have settled.
    for (const d of desks) {
      (byDesk[d.member.id] || []).reduce((stackY, c) => {
        positions[c.p.id] = {
          x: d.x + (d.w - c.size.w) / 2,
          y: stackY,
          w: c.size.w, h: c.size.h, zone: 'desk',
        };
        return stackY + c.size.h + 10;
      }, d.y + DESK_HEAD);
    }

    const bandBottom = Math.max(...desks.map((d) => d.y + d.h), cloudBottom + 200);

    // Buckets — one centered row of five.
    const bucketsTop = bandBottom + ZONE_GAP;
    const bw = Math.min(220, (W - 2 * PAD - (BUCKETS.length - 1) * 22) / BUCKETS.length);
    const bRowW = BUCKETS.length * bw + (BUCKETS.length - 1) * 22;
    const buckets = BUCKETS.map((b, i) => ({
      ...b, x: (W - bRowW) / 2 + i * (bw + 22), y: bucketsTop, w: bw, h: BUCKET_H,
    }));

    return {
      W,
      H: bucketsTop + BUCKET_H + PAD,
      positions,
      desks,
      buckets,
      cloud: { cx: W / 2, bottom: cloudBottom },
    };
  }, [visibleCards, staff, contractors]);

  // Filtered-out cards hold their last laid-out spot while hidden.
  const lastPosRef = useRef({});
  useEffect(() => { Object.assign(lastPosRef.current, layout.positions); }, [layout]);

  // Arrow endpoints once positions are known.
  const arrows = useMemo(() => {
    const deskById = Object.fromEntries(layout.desks.map((d) => [d.member.id, d]));
    const bucketByKey = Object.fromEntries(layout.buckets.map((b) => [b.key, b]));
    const out = [];
    for (const c of visibleCards) {
      const pos = layout.positions[c.p.id];
      if (!pos || !c.target) continue;
      const from = { x: pos.x + pos.w / 2, y: pos.y + pos.h };
      let to = null;
      if (c.target.kind === 'desk') {
        const d = deskById[c.target.member];
        if (d) to = { x: d.x + d.w / 2, y: d.y - 6 };
      } else if (c.target.kind === 'bucket') {
        const b = bucketByKey[c.target.bucket];
        if (b) to = { x: b.x + b.w / 2, y: b.y - 6 };
      } else {
        to = { x: layout.cloud.cx, y: layout.cloud.bottom };
        if (pos.zone === 'cloud') to = null; // already home
      }
      if (!to) continue;
      out.push({ id: c.p.id, from, to, color: typeColors(c.p.type).fg });
    }
    return out;
  }, [visibleCards, layout]);

  // Published counts inside the current window.
  const counts = useMemo(() => {
    const start = windowStart(period).getTime();
    const tally = Object.fromEntries(BUCKETS.map((b) => [b.key, 0]));
    for (const p of published) {
      if (!p.published_at || new Date(p.published_at).getTime() < start) continue;
      for (const b of bucketsForProject(p)) tally[b] += 1;
    }
    return tally;
  }, [published, period]);

  // ── Camera ──────────────────────────────────────────────────

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

  // Fit once, when the first real layout is ready — never on polls, so the
  // camera stays where the user put it.
  useEffect(() => {
    if (loading || fittedRef.current) return;
    fittedRef.current = true;
    fitView();
  }, [loading, fitView]);

  // Scroll = zoom toward the cursor. Manual listener because it must be
  // non-passive to preventDefault the page scroll.
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
  }, [loading]);

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

  // ── Goal editing ────────────────────────────────────────────

  async function saveBucketMenu(goal, newPeriod) {
    const bucket = bucketMenu.bucket;
    setBucketMenu(null);
    setGoals((g) => ({ ...g, [bucket]: goal }));
    const { error } = await supabase.from('pipeline_goals').upsert({ bucket, goal, updated_at: new Date().toISOString() });
    if (error) console.error('Goal save failed:', error);
    if (newPeriod !== period) {
      setPeriod(newPeriod);
      const { error: pErr } = await supabase.from('pipeline_settings')
        .update({ period: newPeriod, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (pErr) console.error('Period save failed:', pErr);
    }
  }

  // ── Render ──────────────────────────────────────────────────

  if (loading) {
    return <div style={{ color: colors.textDim, padding: spacing.xl, textAlign: 'center' }}>Loading funnel…</div>;
  }

  const cloudCount = visibleCards.filter((c) => !c.owner).length;

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
      {/* Long / Short / All content-type filter — sits just left of the zoom
          controls and borrows their button chrome. */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ position: 'absolute', top: 12, right: 120, zIndex: 10, display: 'flex', gap: 6 }}
      >
        {[['all', 'All'], ['long', 'Long'], ['short', 'Short']].map(([key, label]) => (
          <button
            key={key} type="button" onClick={() => setTypeFilter(key)}
            style={{
              height: 30, padding: '0 12px', borderRadius: radii.sm,
              border: `1px solid ${typeFilter === key ? colors.accentBorder : colors.border}`,
              background: typeFilter === key ? colors.accentSoft : colors.bgRaised,
              color: typeFilter === key ? colors.accentFg : colors.textSubtle,
              fontSize: fontSizes.sm, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {label}
          </button>
        ))}
      </div>

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
            // The curve always arrives vertically (both control points sit at
            // midY over to.x), so the head just flips with approach direction.
            const dir = a.to.y >= a.from.y ? 1 : -1;
            return (
              <g key={a.id}>
                <path d={path} fill="none" stroke={a.color} strokeWidth="1.6" className="pipe-arrow" />
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
          ☁ Unassigned{cloudCount ? ` · ${cloudCount}` : ''}
        </div>
        {cloudCount === 0 && (
          <div style={{ position: 'absolute', top: 64, left: 0, right: 0, textAlign: 'center', color: colors.textDim, fontSize: fontSizes.sm, opacity: 0.6 }}>
            Every in-flight stage has an owner.
          </div>
        )}

        {/* Desks */}
        {layout.desks.map((d) => (
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
              {d.member.avatar_url
                ? <img src={d.member.avatar_url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (d.member.full_name || '?').charAt(0)}
            </div>
            <div style={{ textAlign: 'center', marginTop: 20, color: colors.textSubtle, fontSize: fontSizes.xs, fontWeight: fontWeights.medium }}>
              {d.member.nickname || d.member.full_name}
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
        ))}

        {/* Cards */}
        {placedCards.map((c) => {
          const pos = layout.positions[c.p.id] || lastPosRef.current[c.p.id];
          if (!pos) return null;
          const hidden = !layout.positions[c.p.id];
          const stageColor = STAGE_COLORS[c.p.status] || colors.textSubtle;
          const tc = typeColors(c.p.type);
          const isClip = !!c.p.parent_project_id;
          const isLong = LONG_FORM_TYPES.includes(c.p.type);
          const dateVal = isLong ? (c.p.edit_deadline || c.p.deadline) : (c.p.deadline || c.p.edit_deadline);
          const dateName = isLong
            ? (c.p.edit_deadline ? 'Edit' : 'Post')
            : (c.p.deadline ? 'Post' : 'Edit');
          const phase = hash01(c.p.id);
          return (
            <div
              key={c.p.id}
              className={hidden ? 'pipe-card pipe-gone' : 'pipe-card'}
              style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h, zIndex: 2 }}
            >
              <div
                className={pos.zone === 'cloud' ? 'pipe-float' : undefined}
                onClick={() => { if (!movedRef.current) setDetail(c); }}
                style={{
                  position: 'relative',
                  width: '100%', height: '100%', boxSizing: 'border-box',
                  padding: `${spacing.xs}px ${spacing.sm}px`,
                  borderRadius: radii.md, cursor: 'pointer',
                  border: `1px solid ${stageColor}55`,
                  background: `linear-gradient(${stageColor}1f, ${stageColor}10), ${colors.bgInput}`,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                  textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
                  animationDelay: `${-phase * 5.2}s`, animationDuration: `${4.6 + phase * 1.6}s`,
                }}
              >
                <div style={{ color: colors.text, fontSize: isLong ? fontSizes.md : fontSizes.sm, fontWeight: fontWeights.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.p.name}
                </div>
                <div style={{ color: tc.fg, fontSize: fontSizes.xs, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {isClip ? `Clip${nameById[c.p.parent_project_id] ? ` · ${nameById[c.p.parent_project_id]}` : ''}` : typeLabel(c.p.type)}
                </div>
                {dateVal && (
                  <div style={{ color: colors.textSubtle, fontSize: fontSizes.xs }}>
                    {dateName} {fmtShort(dateVal)}
                  </div>
                )}
                <div className="pipe-blink" style={{ color: stageColor, fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, letterSpacing: 1, textTransform: 'uppercase' }}>
                  {labelFor(c.p.type, c.p.status)}
                </div>
                {c.extras.length > 0 && (
                  <div style={{ position: 'absolute', bottom: -8, right: 6, display: 'flex', gap: 2 }}>
                    {c.extras.slice(0, 3).map((m) => (
                      <span key={m.id} title={m.full_name} style={{
                        width: 16, height: 16, borderRadius: '50%', background: colors.bgHover,
                        border: `1px solid ${colors.border}`, color: colors.textSubtle,
                        fontSize: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {(m.full_name || '?').charAt(0)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Buckets */}
        {layout.buckets.map((b) => {
          const goal = goals[b.key] || 0;
          const lit = counts[b.key] || 0;
          const dots = Math.max(goal, lit);
          return (
            <div
              key={b.key}
              onContextMenu={(e) => { e.preventDefault(); setBucketMenu({ bucket: b.key, x: e.clientX, y: e.clientY }); }}
              style={{
                position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h,
                border: `1.5px solid ${b.color}44`, borderRadius: radii.md,
                background: `linear-gradient(${b.color}12, transparent), rgba(255,255,255,0.02)`,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: spacing.sm, boxSizing: 'border-box',
              }}
            >
              <div style={{ color: b.color, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, marginTop: 2 }}>
                {b.label}
              </div>
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'center', alignContent: 'center', maxWidth: '100%' }}>
                {dots === 0 ? (
                  <span style={{ color: colors.textDim, fontSize: fontSizes.xs }}>No goal set</span>
                ) : Array.from({ length: dots }, (_, i) => (
                  <span
                    key={i}
                    className={i < lit ? 'pipe-light' : undefined}
                    style={{
                      width: 11, height: 11, borderRadius: '50%',
                      background: i < lit ? b.color : 'transparent',
                      border: `1.5px solid ${i < lit ? b.color : colors.border}`,
                      boxShadow: i < lit ? `0 0 8px ${b.color}88` : 'none',
                      // A publish past the goal still lights, ringed to show overflow.
                      outline: i >= goal ? `1px dashed ${b.color}88` : 'none', outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
              <div style={{ color: colors.textSubtle, fontSize: fontSizes.xs }}>
                {lit} / {goal} {period === 'weekly' ? 'this week' : 'this month'}
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <CardDetails
          card={detail}
          roster={roster}
          rosterById={rosterById}
          parentName={nameById[detail.p.parent_project_id]}
          onAssignmentsChange={(projectId, rows) => {
            // Mirror the DB write into local state so the floor (owners,
            // arrows, desk stacks) re-derives without waiting for a poll.
            setProjects((prev) => prev.map((pr) => (pr.id === projectId
              ? { ...pr, project_stage_assignments: rows.map((r) => ({ stage: r.stage, user_id: r.user_id })) }
              : pr)));
          }}
          onClose={() => setDetail(null)}
        />
      )}
      {bucketMenu && (
        <BucketMenu
          bucket={BUCKETS[BUCKET_INDEX[bucketMenu.bucket]]}
          x={bucketMenu.x}
          y={bucketMenu.y}
          goal={goals[bucketMenu.bucket] || 0}
          period={period}
          onSave={saveBucketMenu}
          onClose={() => setBucketMenu(null)}
        />
      )}
    </div>
  );
}

// Details popup for a clicked card. Read-only except the remaining-stage
// assignee editor, which writes straight to project_stage_assignments — the
// same rows the Projects board reads, so edits show up there too.
function CardDetails({ card, roster, rosterById, parentName, onAssignmentsChange, onClose }) {
  const { p, nextStage, target } = card;
  const stageColor = STAGE_COLORS[p.status] || colors.textSubtle;
  const tc = typeColors(p.type);
  const isClip = !!p.parent_project_id;

  // Local mirror of the project's stage assignments, edited optimistically.
  const [assigns, setAssigns] = useState(
    (p.project_stage_assignments || []).map((a) => ({ stage: a.stage, user_id: a.user_id })),
  );

  // Current stage onward, minus skipped stages and Published.
  const skipCfg = p.stage_config || {};
  const startIdx = Math.max(CANONICAL_STAGES.indexOf(p.status), 0);
  const editableStages = CANONICAL_STAGES
    .slice(startIdx)
    .filter((st) => st !== 'publish' && !skipCfg[st]?.skip);

  const rosterSorted = [...roster]
    .sort((a, b) => (a.nickname || a.full_name || '').localeCompare(b.nickname || b.full_name || ''));

  function pushChange(next) {
    setAssigns(next);
    onAssignmentsChange(p.id, next);
  }

  async function addAssignee(stage, userId) {
    if (!userId || assigns.some((a) => a.stage === stage && a.user_id === userId)) return;
    pushChange([...assigns, { stage, user_id: userId }]);
    const { error } = await supabase.from('project_stage_assignments')
      .insert({ project_id: p.id, stage, user_id: userId });
    if (error && error.code !== '23505') console.error('Assignee add failed:', error);
  }

  async function removeAssignee(stage, userId) {
    pushChange(assigns.filter((a) => !(a.stage === stage && a.user_id === userId)));
    const { error } = await supabase.from('project_stage_assignments')
      .delete()
      .match({ project_id: p.id, stage, user_id: userId });
    if (error) console.error('Assignee remove failed:', error);
  }

  let nextText;
  if (target?.kind === 'bucket') {
    nextText = `Published → ${BUCKETS[BUCKET_INDEX[target.bucket]].label}`;
  } else if (nextStage === 'publish') {
    nextText = 'Published (no bucket — no platform routed)';
  } else {
    const who = target?.kind === 'desk'
      ? (rosterById[target.member]?.nickname || rosterById[target.member]?.full_name)
      : 'Unassigned cloud';
    nextText = `${labelFor(p.type, nextStage)} → ${who}`;
  }

  const platforms = (p.short_form_platforms || [])
    .map((v) => SHORT_FORM_PLATFORMS.find((o) => o.value === v)?.label || v);

  const rows = [
    ['Type', isClip ? `Clip${parentName ? ` of ${parentName}` : ''}` : typeLabel(p.type)],
    platforms.length > 0 && ['Platforms', platforms.join(', ')],
    p.deadline && ['Post Date', fmtShort(p.deadline)],
    p.film_date && ['Film Date', fmtShort(p.film_date)],
    p.edit_deadline && ['Edit Deadline', fmtShort(p.edit_deadline)],
    ['Current owner', (() => {
      const names = assigns.filter((a) => a.stage === p.status)
        .map((a) => rosterById[a.user_id]).filter(Boolean)
        .map((m) => m.nickname || m.full_name);
      return names.length ? names.join(', ') : 'Unassigned';
    })()],
    ['Next stop', nextText],
  ].filter(Boolean);

  const bd = backdropDismiss(onClose);
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => { e.stopPropagation(); bd.onMouseDown(e); }}
      onClick={bd.onClick}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420, maxWidth: '90vw', maxHeight: '84vh', overflowY: 'auto', background: colors.bgRaised,
          border: `1px solid ${colors.border}`, borderRadius: radii.md,
          padding: spacing.lg, boxShadow: '0 14px 40px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
          <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: tc.fg }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: colors.text, fontSize: fontSizes.lg, fontWeight: fontWeights.semibold }}>
              {p.name}
            </div>
            <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginTop: 2 }}>
              <span style={{
                color: stageColor, background: `${stageColor}1f`, border: `1px solid ${stageColor}55`,
                borderRadius: radii.pill, padding: `1px ${spacing.sm}px`,
                fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, letterSpacing: 1, textTransform: 'uppercase',
              }}>
                {labelFor(p.type, p.status)}
              </span>
              {p.on_hold && (
                <span style={{ color: colors.warning?.fg || '#f59e0b', fontSize: fontSizes.xs, fontWeight: fontWeights.semibold }}>
                  ⏸ On hold
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: colors.textSubtle, fontSize: fontSizes.md, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'flex', gap: spacing.md, fontSize: fontSizes.sm }}>
              <span style={{ color: colors.textDim, width: 100, flexShrink: 0 }}>{label}</span>
              <span style={{ color: colors.text }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Remaining stages + editable assignees */}
        <div style={{ marginTop: spacing.md, borderTop: `1px solid ${colors.border}`, paddingTop: spacing.sm }}>
          <div style={{ color: colors.textDim, fontSize: fontSizes.xs, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm }}>
            Remaining stages
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            {editableStages.map((st) => {
              const stColor = STAGE_COLORS[st] || colors.textSubtle;
              const stageAssigns = assigns.filter((a) => a.stage === st);
              const available = rosterSorted.filter((m) => !stageAssigns.some((a) => a.user_id === m.id));
              return (
                <div key={st} style={{ display: 'flex', gap: spacing.sm, alignItems: 'flex-start' }}>
                  <span style={{
                    color: stColor, width: 100, flexShrink: 0, fontSize: fontSizes.xs,
                    fontWeight: fontWeights.semibold, letterSpacing: 0.5, textTransform: 'uppercase',
                    marginTop: 3, opacity: st === p.status ? 1 : 0.75,
                  }}>
                    {labelFor(p.type, st)}
                  </span>
                  <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    {stageAssigns.map((a) => {
                      const m = rosterById[a.user_id];
                      return (
                        <span key={a.user_id} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          border: `1px solid ${colors.border}`, borderRadius: radii.pill,
                          background: colors.bgInput, color: colors.text,
                          fontSize: fontSizes.xs, padding: `2px 4px 2px ${spacing.sm}px`,
                        }}>
                          {m ? (m.nickname || m.full_name) : 'Unknown'}
                          <button
                            type="button"
                            title="Remove"
                            onClick={() => removeAssignee(st, a.user_id)}
                            style={{
                              background: 'transparent', border: 'none', color: colors.textDim,
                              cursor: 'pointer', fontSize: fontSizes.xs, padding: '0 3px', fontFamily: 'inherit',
                            }}
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                    <select
                      value=""
                      onChange={(e) => addAssignee(st, e.target.value)}
                      title="Add assignee"
                      style={{
                        background: 'transparent', border: `1px dashed ${colors.border}`,
                        borderRadius: radii.pill, color: colors.textDim,
                        fontSize: fontSizes.xs, padding: '2px 4px', fontFamily: 'inherit', cursor: 'pointer',
                        maxWidth: 90,
                      }}
                    >
                      <option value="">+ Add</option>
                      {available.map((m) => (
                        <option key={m.id} value={m.id}>{m.nickname || m.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Right-click popover: this bucket's goal + the global window.
function BucketMenu({ bucket, x, y, goal, period, onSave, onClose }) {
  const [g, setG] = useState(goal);
  const [p, setP] = useState(period);
  const left = Math.min(x, (window.innerWidth || 1200) - 240);
  const top = Math.min(y, (window.innerHeight || 800) - 220);
  // Stop mousedown from starting a canvas pan underneath, but still run
  // backdropDismiss's own arming handler.
  const bd = backdropDismiss(onClose);
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 300 }}
      onMouseDown={(e) => { e.stopPropagation(); bd.onMouseDown(e); }}
      onClick={bd.onClick}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'fixed', left, top, width: 220,
          background: colors.bgRaised || '#1a1a2e', border: `1px solid ${colors.border}`,
          borderRadius: radii.md, padding: spacing.md, boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ color: bucket.color, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, marginBottom: spacing.sm }}>
          {bucket.label}
        </div>
        <label style={{ display: 'block', color: colors.textDim, fontSize: fontSizes.xs, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          Goal per window
        </label>
        <input
          type="number" min="0" max="99" value={g}
          onChange={(e) => setG(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
          style={{
            width: '100%', boxSizing: 'border-box', background: colors.bgInput,
            border: `1px solid ${colors.border}`, borderRadius: radii.sm,
            color: colors.text, padding: '6px 8px', fontSize: fontSizes.md, fontFamily: 'inherit',
            marginBottom: spacing.sm,
          }}
        />
        <label style={{ display: 'block', color: colors.textDim, fontSize: fontSizes.xs, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          Window (all buckets)
        </label>
        <div style={{ display: 'flex', gap: 6, marginBottom: spacing.md }}>
          {['weekly', 'monthly'].map((opt) => (
            <button
              key={opt} type="button" onClick={() => setP(opt)}
              style={{
                flex: 1, padding: '5px 0', borderRadius: radii.pill,
                border: `1px solid ${p === opt ? colors.accentBorder : colors.border}`,
                background: p === opt ? colors.accentSoft : 'transparent',
                color: p === opt ? colors.accentFg : colors.textSubtle,
                fontSize: fontSizes.xs, fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              {opt === 'weekly' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: colors.textSubtle, fontSize: fontSizes.sm, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button type="button" onClick={() => onSave(g, p)} style={{ background: colors.accent, border: 'none', color: '#fff', fontSize: fontSizes.sm, cursor: 'pointer', fontFamily: 'inherit', borderRadius: radii.sm, padding: '5px 14px' }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
