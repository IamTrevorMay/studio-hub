// Progress (formerly Funnel) — a read-only mirror of the two production
// systems, side by side on a pannable/zoomable canvas (scroll to zoom toward
// the cursor, drag anywhere to pan):
//
//   Projects     every in-flight project card (same floor set as the Kanban:
//                non-archived, unpublished), large cards colored by stage,
//                ordered by stage then deadline. Click opens the detail
//                popover with the remaining-stage assignee editor.
//   Film Queue   EVERYTHING sent to the queue, in four sub-sections:
//                In Review (drafting + ready for review), Up Next (approved,
//                unpacked, in line order), Filming (the next session's pack —
//                stamped rows when locked, derived pack otherwise), and
//                Editing (filmed, cut not delivered). Cards show the sheet
//                title, status, current task owner, and queue type.
//   Goals        the Tracking page's goals, relocated here (they left
//                Tracking entirely) as standalone cards in three zones:
//                Yearly across the top, Monthly under Projects, Weekly under
//                Film Queue (GoalsSection's bare mode, one mount per zone).
//                Wheel/drag are fenced inside the zones so forms stay usable.
//                No section containers anywhere — free-floating cards under
//                plain headings.
//
// The old studio floor (desk ellipse, unassigned cloud, routing arrows) and
// the publish buckets + pipeline_goals feature are gone. Cards keep the same
// color conventions and glide/blink animations (pipeline.css).

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import useVisibilityRefresh from '../../hooks/useVisibilityRefresh';
import { CANONICAL_STAGES, STAGE_COLORS, SHORT_FORM_PLATFORMS, labelFor, typeLabel, typeColors } from '../../lib/kanbanStages';
import {
  STATUS_BY_VALUE, queueTypeLabel, queueTypeColor,
  defaultMinutesFor, orderTheLine, packSession,
} from '../../lib/filmQueue';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../lib/styleTokens';
import backdropDismiss from '../../lib/backdropDismiss';
import GoalsSection from '../../components/GoalsSection';
import './pipeline.css';

// ── Constants ─────────────────────────────────────────────────

const FLOOR_STAGES = new Set(CANONICAL_STAGES.filter((s) => s !== 'publish'));
const LONG_FORM_TYPES = ['mayday_video', 'tm_baseball_video', 'podcast'];

// ── Geometry ──────────────────────────────────────────────────
const PAD        = 32;
const CARD_W     = 300;
const CARD_H     = 116;
const CARD_GAP   = 18;
const SEC_PAD    = 18;
const SEC_HEAD   = 34;   // sub-section label row inside a dashed box
const COL_GAP    = 64;   // gap between the two system columns
const ZONE_GAP   = 90;
const ZOOM_MIN   = 0.3;
const ZOOM_MAX   = 2.5;

const COL_W = 2 * CARD_W + CARD_GAP + 2 * SEC_PAD;
const CANVAS_W = 2 * COL_W + COL_GAP + 2 * PAD;

// Film Queue sub-sections, top to bottom. Filming/Editing borrow the Kanban
// stage hues so the color language matches the Projects column.
const FQ_SECTIONS = [
  { key: 'review',  label: 'In Review' },
  { key: 'up_next', label: 'Up Next' },
  { key: 'filming', label: 'Filming' },
  { key: 'editing', label: 'Editing' },
];

function fmtShort(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Stable 0..1 hash — blink phases.
function hash01(id, salt = '') {
  const s = String(id) + salt;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h / 9973;
}

// Lay a list of cards into a 2-wide grid inside a section box.
// Returns { positions: [{x,y}], height } relative to the box's content top.
function gridLayout(count) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: SEC_PAD + (i % 2) * (CARD_W + CARD_GAP),
      y: Math.floor(i / 2) * (CARD_H + CARD_GAP),
    });
  }
  const rows = Math.ceil(count / 2);
  const height = rows > 0 ? rows * (CARD_H + CARD_GAP) - CARD_GAP : 0;
  return { positions, height };
}

// ── Component ─────────────────────────────────────────────────

export default function Pipeline({ onOpenProject }) {
  const [roster, setRoster] = useState([]);
  const [projects, setProjects] = useState([]);
  const [fqItems, setFqItems] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [fqTasks, setFqTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  // Camera: translate + scale.
  const [view, setView] = useState({ x: 0, y: 0, k: 0.9 });
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const fittedRef = useRef(false);

  // The Yearly Goals band's height is DOM-flow (goal cards wrap), so it's
  // measured and fed into the layout, pushing the two systems down.
  const [yearlyH, setYearlyH] = useState(170);
  const yearlyRef = useRef(null);
  useEffect(() => {
    const el = yearlyRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setYearlyH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  const fetchAll = useCallback(async () => {
    const [rosterQ, floorQ, fqQ, sessQ, taskQ] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, nickname, avatar_url, role')
        .is('deactivated_at', null)
        .in('role', ['admin', 'director', 'member', 'contractor']),
      supabase.from('projects')
        .select('id, name, type, status, deadline, film_date, edit_deadline, on_hold, stage_config, short_form_platforms, parent_project_id, project_stage_assignments(stage, user_id)')
        .is('archived_at', null)
        .in('status', [...FLOOR_STAGES]),
      supabase.from('film_queue_items')
        .select('*, sheet:beat_sheets(id, title, status, estimated_minutes, approved_at, film_date)')
        .in('state', ['queued', 'filmed'])
        .order('created_at', { ascending: true }),
      supabase.from('film_sessions')
        .select('*')
        .or(`locked_at.is.null,session_date.gte.${todayIso()}`)
        .order('session_date', { ascending: true }),
      // Open fq_* tasks — the card's "assignee" is whoever holds the open task.
      supabase.from('tasks')
        .select('related_entity_id, assignee_id, step_key, created_at')
        .eq('related_entity_type', 'film_queue_item')
        .in('status', ['pending', 'active', 'on_hold']),
    ]);
    if (!rosterQ.error) setRoster(rosterQ.data || []);
    if (!floorQ.error) setProjects(floorQ.data || []);
    if (!fqQ.error) setFqItems(fqQ.data || []);
    if (!sessQ.error) setSessions(sessQ.data || []);
    if (!taskQ.error) setFqTasks(taskQ.data || []);
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
  const nameOf = useCallback((id) => {
    const m = rosterById[id];
    return m ? (m.nickname || m.full_name) : null;
  }, [rosterById]);
  const parentNameById = useMemo(() => {
    const map = {};
    for (const p of projects) map[p.id] = p.name;
    return map;
  }, [projects]);

  // Projects — soonest due first (post date, else edit deadline, else film
  // date); undated cards sink to the bottom.
  const projectCards = useMemo(() => {
    const dueOf = (p) => p.deadline || p.edit_deadline || p.film_date || '9999-12-31';
    return [...projects].sort((a, b) => {
      const da = dueOf(a), db = dueOf(b);
      if (da !== db) return da < db ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [projects]);

  // Film Queue — current open task owner per item (newest open task wins).
  const fqOwnerByItem = useMemo(() => {
    const map = {};
    const sorted = [...fqTasks].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    for (const t of sorted) if (t.related_entity_id) map[t.related_entity_id] = t.assignee_id;
    return map;
  }, [fqTasks]);

  const fqBySection = useMemo(() => {
    const queueItems = fqItems
      .filter((i) => i.state === 'queued' && i.sheet)
      .map((i) => ({
        ...i,
        estimated_minutes: i.sheet.estimated_minutes ?? defaultMinutesFor(i.queue_type),
        approved_at: i.sheet.approved_at,
      }));
    const review = queueItems.filter((i) => i.sheet.status !== 'approved');
    const approvedUnpacked = queueItems.filter((i) => i.sheet.status === 'approved' && !i.session_id);

    // Same next-session resolution as the Film Queue tab: today's locked
    // session wins, else the next unlocked one; derived pack pre-lock.
    const lockedToday = sessions.find((s) => s.locked_at && s.session_date === todayIso());
    const upcomingUnlocked = sessions.find((s) => !s.locked_at);
    const displaySession = lockedToday || upcomingUnlocked || null;
    let filming = [];
    let upNext = [];
    if (displaySession?.locked_at) {
      filming = queueItems
        .filter((i) => i.session_id === displaySession.id)
        .sort((a, b) => (a.slate_order || 0) - (b.slate_order || 0));
      upNext = orderTheLine(approvedUnpacked);
    } else if (displaySession) {
      const { packed, remaining } = packSession(approvedUnpacked);
      filming = packed;
      upNext = remaining;
    } else {
      upNext = orderTheLine(approvedUnpacked);
    }
    const editing = fqItems.filter((i) => i.state === 'filmed' && i.sheet);
    return { review, up_next: upNext, filming, editing, session: displaySession };
  }, [fqItems, sessions]);

  // Per-section status meta for FQ cards.
  const fqStatusFor = useCallback((sectionKey, item) => {
    if (sectionKey === 'review') {
      const st = STATUS_BY_VALUE[item.sheet?.status] || STATUS_BY_VALUE.drafting;
      return { label: st.label, color: st.color };
    }
    if (sectionKey === 'up_next') return { label: 'Up Next', color: '#22c55e' };
    if (sectionKey === 'filming') {
      return { label: 'Filming', color: STAGE_COLORS.film || '#fb923c' };
    }
    return { label: 'Editing', color: STAGE_COLORS.edit || '#a78bfa' };
  }, []);

  // ── Layout ──────────────────────────────────────────────────

  const layout = useMemo(() => {
    const W = CANVAS_W;
    const leftX = PAD;
    const rightX = PAD + COL_W + COL_GAP;
    const positions = {}; // card key → { x, y }

    // Yearly Goals band spans the full width at the top; its height is
    // measured from the DOM (goal cards flow) and fed back in via yearlyH.
    const yearlyTop = 24;
    const colTitleY = yearlyTop + yearlyH + 40;
    const topY = colTitleY + 52;

    // Projects — one dashed container, 2-wide grid.
    const pGrid = gridLayout(projectCards.length);
    projectCards.forEach((p, i) => {
      positions[`p:${p.id}`] = {
        x: leftX + pGrid.positions[i].x,
        y: topY + SEC_PAD + pGrid.positions[i].y,
      };
    });
    const projectsBox = {
      x: leftX, y: topY, w: COL_W,
      h: Math.max(2 * SEC_PAD + pGrid.height, 120),
    };

    // Film Queue — four stacked dashed containers.
    const fqBoxes = [];
    let fy = topY;
    for (const sec of FQ_SECTIONS) {
      const items = fqBySection[sec.key] || [];
      const grid = gridLayout(items.length);
      items.forEach((it, i) => {
        positions[`f:${it.id}`] = {
          x: rightX + grid.positions[i].x,
          y: fy + SEC_HEAD + grid.positions[i].y,
        };
      });
      const h = Math.max(SEC_HEAD + grid.height + SEC_PAD, 96);
      fqBoxes.push({ ...sec, x: rightX, y: fy, w: COL_W, h, count: items.length });
      fy += h + 22;
    }
    const fqBottom = fy - 22;

    // Monthly (under Projects) and Weekly (under Film Queue) goal zones
    // share one row below whichever column runs longer.
    const goalsRowTop = Math.max(projectsBox.y + projectsBox.h, fqBottom) + ZONE_GAP;

    return {
      W,
      // Bottom goal zones flow to dynamic heights; generous estimate for fit.
      H: goalsRowTop + 950,
      positions,
      yearlyTop,
      colTitleY,
      projectsBox,
      fqBoxes,
      goalsRowTop,
      leftX,
      rightX,
    };
  }, [projectCards, fqBySection, yearlyH]);

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

  // Fit once, when the first real layout is ready — never on polls. The full
  // fit is very zoomed-out because of the Goals block, so the initial camera
  // fits the two systems' width instead.
  useEffect(() => {
    if (loading || fittedRef.current) return;
    fittedRef.current = true;
    const el = viewportRef.current;
    if (!el) return;
    const k = Math.min((el.clientWidth - 32) / layout.W, 1);
    setView({ k, x: (el.clientWidth - layout.W * k) / 2, y: 16 });
  }, [loading, layout.W]);

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

  // ── Render ──────────────────────────────────────────────────

  if (loading) {
    return <div style={{ color: colors.textDim, padding: spacing.xl, textAlign: 'center' }}>Loading progress…</div>;
  }

  // Goal zones fence the canvas's pan (mousedown) and zoom (wheel) so their
  // forms and buttons stay usable.
  const goalZoneFence = {
    onMouseDown: (e) => e.stopPropagation(),
    onWheel: (e) => e.stopPropagation(),
  };
  const sectionBoxStyle = (box) => ({
    position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
    border: `1.5px dashed ${colors.border}`, borderRadius: radii.md,
    background: 'rgba(255,255,255,0.02)', boxSizing: 'border-box',
  });

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

        {/* Yearly Goals band — spans both columns, no heading */}
        <div
          {...goalZoneFence}
          ref={yearlyRef}
          style={{
            position: 'absolute', left: layout.leftX, top: layout.yearlyTop,
            width: 2 * COL_W + COL_GAP,
            cursor: 'default', userSelect: 'text',
          }}
        >
          <GoalsSection bare period="yearly" />
        </div>

        {/* Column titles */}
        <div style={{ position: 'absolute', top: layout.colTitleY, left: layout.leftX, width: COL_W, textAlign: 'center', color: colors.text, fontSize: 26, fontWeight: fontWeights.bold, letterSpacing: 0.5 }}>
          Projects
        </div>
        <div style={{ position: 'absolute', top: layout.colTitleY, left: layout.rightX, width: COL_W, textAlign: 'center', color: colors.text, fontSize: 26, fontWeight: fontWeights.bold, letterSpacing: 0.5 }}>
          Film Queue
        </div>
        {/* Projects container */}
        <div style={sectionBoxStyle(layout.projectsBox)}>
          {projectCards.length === 0 && (
            <div style={{ textAlign: 'center', marginTop: 44, color: colors.textDim, fontSize: fontSizes.sm, opacity: 0.6 }}>
              No projects in flight.
            </div>
          )}
        </div>

        {/* Film Queue sub-section containers */}
        {layout.fqBoxes.map((box) => (
          <div key={box.key} style={sectionBoxStyle(box)}>
            <div style={{
              textAlign: 'center', marginTop: 9,
              color: colors.textDim, fontSize: fontSizes.xs,
              letterSpacing: 2, textTransform: 'uppercase',
            }}>
              {box.label}
              {box.key === 'filming' && fqBySection.session ? ` · ${fmtShort(fqBySection.session.session_date + 'T00:00:00')}${fqBySection.session.locked_at ? ' · locked' : ''}` : ''}
              {box.count ? ` · ${box.count}` : ''}
            </div>
            {box.count === 0 && (
              <div style={{ textAlign: 'center', marginTop: 14, color: colors.textDim, fontSize: fontSizes.xs, opacity: 0.55 }}>
                Nothing here.
              </div>
            )}
          </div>
        ))}

        {/* Project cards */}
        {projectCards.map((p) => {
          const pos = layout.positions[`p:${p.id}`];
          if (!pos) return null;
          const stageColor = STAGE_COLORS[p.status] || colors.textSubtle;
          const tc = typeColors(p.type);
          const isClip = !!p.parent_project_id;
          const isLong = LONG_FORM_TYPES.includes(p.type);
          const dateVal = isLong ? (p.edit_deadline || p.deadline) : (p.deadline || p.edit_deadline);
          const dateName = isLong
            ? (p.edit_deadline ? 'Edit' : 'Post')
            : (p.deadline ? 'Post' : 'Edit');
          const assignees = (p.project_stage_assignments || [])
            .filter((a) => a.stage === p.status)
            .map((a) => nameOf(a.user_id))
            .filter(Boolean);
          const phase = hash01(p.id);
          return (
            <div key={p.id} className="pipe-card" style={{ left: pos.x, top: pos.y, width: CARD_W, height: CARD_H, zIndex: 2 }}>
              <div
                onClick={() => { if (!movedRef.current) setDetail(p); }}
                style={{
                  width: '100%', height: '100%', boxSizing: 'border-box',
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  borderRadius: radii.md, cursor: 'pointer',
                  border: `1px solid ${stageColor}55`,
                  background: `linear-gradient(${stageColor}1f, ${stageColor}10), ${colors.bgInput}`,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                  textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
                  animationDelay: `${-phase * 5.2}s`,
                }}
              >
                <div style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: fontWeights.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <div className="pipe-blink" style={{ color: stageColor, fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, letterSpacing: 1, textTransform: 'uppercase' }}>
                  {labelFor(p.type, p.status)}{p.on_hold ? ' · ⏸' : ''}
                </div>
                <div style={{ color: colors.textSubtle, fontSize: fontSizes.xs, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {assignees.length ? assignees.join(', ') : 'Unassigned'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10, fontSize: fontSizes.xs }}>
                  <span style={{ color: tc.fg }}>
                    {isClip ? `Clip${parentNameById[p.parent_project_id] ? ` · ${parentNameById[p.parent_project_id]}` : ''}` : typeLabel(p.type)}
                  </span>
                  {dateVal && <span style={{ color: colors.textSubtle }}>{dateName} {fmtShort(dateVal)}</span>}
                </div>
              </div>
            </div>
          );
        })}

        {/* Film Queue cards */}
        {FQ_SECTIONS.map((sec) => (fqBySection[sec.key] || []).map((it) => {
          const pos = layout.positions[`f:${it.id}`];
          if (!pos) return null;
          const st = fqStatusFor(sec.key, it);
          const qColor = queueTypeColor(it.queue_type);
          const owner = nameOf(fqOwnerByItem[it.id]);
          return (
            <div key={it.id} className="pipe-card" style={{ left: pos.x, top: pos.y, width: CARD_W, height: CARD_H, zIndex: 2 }}>
              <div
                style={{
                  width: '100%', height: '100%', boxSizing: 'border-box',
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  borderRadius: radii.md,
                  border: `1px solid ${st.color}55`,
                  background: `linear-gradient(${st.color}1f, ${st.color}10), ${colors.bgInput}`,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                  textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
                }}
              >
                <div style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: fontWeights.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.sheet?.title || 'Untitled'}
                </div>
                <div className="pipe-blink" style={{ color: st.color, fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, letterSpacing: 1, textTransform: 'uppercase' }}>
                  {st.label}
                </div>
                <div style={{ color: colors.textSubtle, fontSize: fontSizes.xs, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {owner || '—'}
                </div>
                <div style={{ color: qColor, fontSize: fontSizes.xs, fontWeight: fontWeights.medium }}>
                  {queueTypeLabel(it.queue_type)}
                </div>
              </div>
            </div>
          );
        }))}

        {/* Monthly Goals — under the Projects column, aligned with Weekly */}
        <div
          {...goalZoneFence}
          style={{ position: 'absolute', left: layout.leftX, top: layout.goalsRowTop, width: COL_W, cursor: 'default', userSelect: 'text' }}
        >
          <GoalsSection bare period="monthly" />
        </div>

        {/* Weekly Goals — under the Film Queue column, same row */}
        <div
          {...goalZoneFence}
          style={{ position: 'absolute', left: layout.rightX, top: layout.goalsRowTop, width: COL_W, cursor: 'default', userSelect: 'text' }}
        >
          <GoalsSection bare period="weekly" />
        </div>
      </div>

      {detail && (
        <CardDetails
          card={detail}
          roster={roster}
          rosterById={rosterById}
          parentName={parentNameById[detail.parent_project_id]}
          onAssignmentsChange={(projectId, rows) => {
            setProjects((prev) => prev.map((pr) => (pr.id === projectId
              ? { ...pr, project_stage_assignments: rows.map((r) => ({ stage: r.stage, user_id: r.user_id })) }
              : pr)));
          }}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

// Details popup for a clicked project card. Read-only except the
// remaining-stage assignee editor, which writes straight to
// project_stage_assignments — the same rows the Projects board reads.
function CardDetails({ card: p, roster, rosterById, parentName, onAssignmentsChange, onClose }) {
  const stageColor = STAGE_COLORS[p.status] || colors.textSubtle;
  const tc = typeColors(p.type);
  const isClip = !!p.parent_project_id;

  const [assigns, setAssigns] = useState(
    (p.project_stage_assignments || []).map((a) => ({ stage: a.stage, user_id: a.user_id })),
  );

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

  // Next stop: next non-skipped stage → its assignee(s), or Published.
  let nextText;
  {
    const order = CANONICAL_STAGES;
    let idx = order.indexOf(p.status) + 1;
    while (idx < order.length && skipCfg[order[idx]]?.skip) idx += 1;
    const nextStage = idx < order.length ? order[idx] : 'publish';
    if (nextStage === 'publish') {
      nextText = 'Published';
    } else {
      const names = (p.project_stage_assignments || [])
        .filter((a) => a.stage === nextStage)
        .map((a) => rosterById[a.user_id])
        .filter(Boolean)
        .map((m) => m.nickname || m.full_name);
      nextText = `${labelFor(p.type, nextStage)} → ${names.length ? names.join(', ') : 'Unassigned'}`;
    }
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
