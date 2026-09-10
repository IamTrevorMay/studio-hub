// Pipeline — a read-only production graph over the Kanban's own data.
//
// This view creates and mutates nothing about project state; the board stays
// the system of record. Everything here is derived on each load:
//
//   chains   projects.status + stage_config  → which stages exist, where we are
//   nodes    tasks (related_entity_type='project', step_key=stage)
//              → assignee, due date, done/not
//   lanes    projects.target_post_type       → which output a project feeds
//
// Goal hoppers are deliberately NOT here yet. The destination field and the
// lane grouping it drives are in place, so routing data accumulates now and
// hoppers can drop onto the bottom of this canvas later without re-modelling
// anything above them.
//
// Colour budget: state only. Nothing static is coloured — not the project
// titles, not the stage names, not the lane headers — so a green or red node
// is the only thing on screen competing for attention.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import useVisibilityRefresh from '../../hooks/useVisibilityRefresh';
import { CANONICAL_STAGES, labelFor, typeLabel } from '../../lib/kanbanStages';
import { POST_TYPE_OPTIONS, POST_TYPE_MAP } from '../../lib/postTypes';
import { ptDayKey } from '../../lib/ptDate';
import { colors, spacing, radii, fontSizes, fontWeights, transitions } from '../../lib/styleTokens';
import './pipeline.css';

// ── Geometry ──────────────────────────────────────────────────
const NODE_W      = 152;
const NODE_H      = 62;
const V_GAP       = 96;   // node top → next node top
const TOP_PAD     = 96;   // canvas top → first node (room for lane + chain headers)
const BOTTOM_PAD  = 48;
const NODE_GAP_X  = 28;   // lateral separation between sibling chains
const LANE_GAP    = 56;   // separation between lanes
const LANE_MIN_W  = 200;
const ZOOM_MIN    = 0.2;
const ZOOM_MAX    = 2.5;

// Queue is an intake column, not production work. Including it would start
// every chain with an identical node carrying no information.
const CHAIN_STAGES = CANONICAL_STAGES.filter(s => s !== 'queue');

// Statuses that mean "not currently moving through production".
const OFF_CANVAS_STATUS = new Set(['queue', 'backlog', 'publish']);

const STATE_TONE = {
  done:    colors.success,
  active:  colors.warning,
  blocked: colors.blocked,
  locked:  colors.locked,
};

const UNROUTED = '__unrouted';

// ── Derivation helpers ────────────────────────────────────────

// Relative countdown against the PT day, so "1d left" doesn't flip early for
// someone in a later timezone.
function countdown(dateStr) {
  if (!dateStr) return null;
  const todayKey = ptDayKey(new Date());
  const dueKey = String(dateStr).slice(0, 10);
  const days = Math.round(
    (Date.parse(`${dueKey}T12:00:00Z`) - Date.parse(`${todayKey}T12:00:00Z`)) / 86400000,
  );
  if (days === 0) return { text: 'due today', overdue: false, days };
  if (days > 0)   return { text: `${days}d left`, overdue: false, days };
  return { text: `${Math.abs(days)}d overdue`, overdue: true, days };
}

// One project → its ordered chain of nodes.
//
// State rules:
//   done    the stage's task is complete, or the project has moved past it
//   blocked not done, at or before the current stage, and either overdue or
//           the project is explicitly on hold
//   active  not done, not blocked, and the current stage
//   locked  everything downstream — at least one upstream dependency unmet
//
// `blocked` is deliberately capped at the current stage. A future stage with
// a stale due date is still just locked; nobody can act on it yet, so calling
// it blocked would raise an alarm that has no owner.
function buildChain(project, taskMap) {
  const skip = project.stage_config || {};
  const stages = CHAIN_STAGES.filter(s => !skip[s]?.skip);
  const curIdx = stages.indexOf(project.status);

  return stages.map((stage, i) => {
    const task = taskMap?.[stage] || null;
    const complete = task?.status === 'complete';
    const past = curIdx >= 0 && i < curIdx;
    const done = complete || past;
    const cd = countdown(task?.due_date);

    const inReach = curIdx < 0 ? false : i <= curIdx;
    const blocked = !done && inReach && Boolean(cd?.overdue || project.on_hold);
    const active = !done && !blocked && i === curIdx;

    return {
      stage,
      label: labelFor(project.type, stage),
      state: done ? 'done' : blocked ? 'blocked' : active ? 'active' : 'locked',
      assigneeId: task?.assignee_id || null,
      countdown: cd,
      holdReason: project.on_hold ? project.hold_reason : null,
    };
  });
}

// Scale-and-centre the whole graph inside the viewport.
//
// Both axes get centred. The old version hardcoded y:12, which pinned the
// graph near the top while centring it horizontally — so "Fit" produced a
// lopsided result with all the slack below the last row of nodes.
//
// FIT_PAD keeps the nodes off the glass, and off the legend / zoom controls
// floating in the top corners. Scale is capped at 1: "fit" means make it all
// visible, not magnify a two-chain pipeline until it's cartoonish.
const FIT_PAD = 32;

function fitView(el, layout) {
  const vw = el.clientWidth;
  const vh = el.clientHeight;
  const k = Math.min(
    1,
    Math.max(ZOOM_MIN, Math.min(
      (vw - FIT_PAD * 2) / layout.width,
      (vh - FIT_PAD * 2) / layout.height,
    )),
  );
  return {
    k,
    x: (vw - layout.width * k) / 2,
    y: Math.max(FIT_PAD, (vh - layout.height * k) / 2),
  };
}

export default function Pipeline({ onOpenProject }) {
  const [projects, setProjects] = useState([]);
  const [tasksByProject, setTasksByProject] = useState({});
  const [people, setPeople] = useState({});
  const [loading, setLoading] = useState(true);

  // ── Viewport (pan / zoom) ──
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef(null);
  const panRef = useRef(null);

  // ── Fetch ──
  const fetchAll = useCallback(async () => {
    try {
      const [{ data: projRows }, { data: profileRows }] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, type, status, stage_config, target_post_type, on_hold, hold_reason, deadline, archived_at')
          // `archived_at` is the archive signal, NOT the `is_archived` boolean.
          // The two have drifted — 28 rows carry an archived_at with the flag
          // still false — and UnifiedBoard filters on archived_at, so matching
          // it is what keeps the two views showing the same set of projects.
          .is('archived_at', null),
        supabase
          .from('profiles')
          .select('id, full_name')
          .is('deactivated_at', null),
      ]);

      // In-flight only: queue/backlog haven't started, publish is finished.
      // Untyped projects are excluded to match the board, which routes them to
      // a separate "needs a type" tray rather than the stage columns — without
      // a type there are no stage labels to draw.
      const inFlight = (projRows || []).filter(p => p.type && !OFF_CANVAS_STATUS.has(p.status));
      setProjects(inFlight);

      const peopleMap = {};
      for (const p of (profileRows || [])) peopleMap[p.id] = p.full_name;
      setPeople(peopleMap);

      // Nodes read from tasks — the only place per-stage assignee and due date
      // actually live. (projects.stage_timelines exists but is unused.)
      if (inFlight.length) {
        const { data: taskRows, error: taskErr } = await supabase
          .from('tasks')
          .select('id, step_key, assignee_id, due_date, status, related_entity_id')
          .eq('related_entity_type', 'project')
          .in('related_entity_id', inFlight.map(p => p.id));
        if (taskErr) console.error('[Pipeline] tasks fetch:', taskErr);

        const byProject = {};
        for (const t of (taskRows || [])) {
          if (!t.step_key) continue;
          const bucket = (byProject[t.related_entity_id] ||= {});
          // A stage carries more than one task over its life — real projects
          // here have up to 6 tasks across 3 stages. Prefer the one still
          // open; among equals, the one with a due date.
          const held = bucket[t.step_key];
          const better = !held
            || (held.status === 'complete' && t.status !== 'complete')
            || (held.status === t.status && !held.due_date && t.due_date);
          if (better) bucket[t.step_key] = t;
        }
        setTasksByProject(byProject);
      } else {
        setTasksByProject({});
      }
    } catch (err) {
      console.error('[Pipeline] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useVisibilityRefresh(fetchAll);

  // A card moving on the board should move here too, without a reload.
  useEffect(() => {
    const channel = supabase
      .channel('pipeline-projects')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);

  // ── Layout ──
  //
  // Lanes group chains by destination, in the canonical POST_TYPE_OPTIONS
  // order so columns don't reshuffle as projects get routed. Unrouted work
  // gets its own lane on the right rather than being guessed into one — a
  // wrong lane would read as intent.
  const layout = useMemo(() => {
    const byDest = new Map();
    for (const p of projects) {
      const key = p.target_post_type && POST_TYPE_MAP[p.target_post_type] ? p.target_post_type : UNROUTED;
      if (!byDest.has(key)) byDest.set(key, []);
      byDest.get(key).push(p);
    }

    const order = [...POST_TYPE_OPTIONS.map(o => o.key), UNROUTED];
    const lanes = order
      .filter(k => byDest.has(k))
      .map(k => ({
        key: k,
        title: k === UNROUTED ? 'Unrouted' : POST_TYPE_MAP[k].label,
        projects: byDest.get(k),
      }));

    // Lane headers only earn their space once there's something to compare.
    const showLaneHeaders = lanes.length > 1;

    const chains = [];
    let maxNodes = 0;
    let cursorX = 0;

    for (const lane of lanes) {
      const laneW = Math.max(LANE_MIN_W, lane.projects.length * (NODE_W + NODE_GAP_X) - NODE_GAP_X);
      lane.x = cursorX;
      lane.width = laneW;

      lane.projects.forEach((project, j) => {
        const nodes = buildChain(project, tasksByProject[project.id]);
        if (!nodes.length) return;
        maxNodes = Math.max(maxNodes, nodes.length);

        // Straight vertical columns. Chains used to drift toward their goal
        // hopper; with no hoppers to aim at, a diagonal would be decoration.
        const x = cursorX + NODE_W / 2 + j * (NODE_W + NODE_GAP_X);

        chains.push({
          project,
          laneKey: lane.key,
          nodes: nodes.map((node, i) => ({ ...node, x, y: TOP_PAD + i * V_GAP })),
          live: nodes.some(n => n.state === 'active' || n.state === 'blocked'),
        });
      });

      cursorX += laneW + LANE_GAP;
    }

    return {
      lanes,
      showLaneHeaders,
      chains,
      width: Math.max(1, cursorX - LANE_GAP),
      height: TOP_PAD + maxNodes * V_GAP + BOTTOM_PAD,
    };
  }, [projects, tasksByProject]);

  // Fit the canvas on first load so you never open onto an empty viewport.
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || loading || !layout.chains.length) return;
    const el = viewportRef.current;
    if (!el) return;
    if (!el.clientWidth || !el.clientHeight) return;
    setView(fitView(el, layout));
    didFit.current = true;
  }, [loading, layout]);

  // ── Pan / zoom ──
  //
  // Live-canvas model: the wheel zooms at the cursor, and dragging pans.
  // Scroll does NOT pan — that's the deliberate difference from a document.
  //
  // Wheel is a native listener rather than React's onWheel: React registers
  // wheel passively at the root, so preventDefault() there is ignored and the
  // gesture zooms the whole browser page instead of the canvas.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;

    const onWheel = (e) => {
      e.preventDefault();

      // Normalise deltaMode so a mouse reporting lines or pages doesn't jump
      // by orders of magnitude next to one reporting pixels.
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;                  // lines
      else if (e.deltaMode === 2) dy *= el.clientHeight; // pages

      // A trackpad pinch arrives as ctrl+wheel with far smaller deltas than a
      // mouse notch, so it needs a stronger factor to feel proportional.
      const factor = e.ctrlKey ? 0.01 : 0.0022;

      // Exponential, not linear. A linear (1 - dy * k) factor goes NEGATIVE on
      // a fast scroll — dy of 800 would flip the scale and snap to the floor.
      // exp() is also scale-invariant, so one notch feels the same at any zoom.
      const scale = Math.exp(-dy * factor);

      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      setView(v => {
        const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * scale));
        const ratio = k / v.k;
        return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    setPanning(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    const p = panRef.current;
    if (!p) return;
    setView(v => ({ ...v, x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) }));
  }
  function onPointerUp(e) {
    panRef.current = null;
    setPanning(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // Zoom about a fixed point in viewport space, keeping whatever is under that
  // point stationary. The canvas uses transformOrigin '0 0', so changing scale
  // without compensating x/y shoves the content toward the top-left corner —
  // which is what the -/+ buttons used to do.
  function zoomAbout(nextK, cx, cy) {
    setView(v => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextK));
      const ratio = k / v.k;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }

  // Buttons zoom about the middle of the viewport — the part you're looking at.
  function zoomByButton(delta) {
    const el = viewportRef.current;
    if (!el) return;
    zoomAbout(view.k + delta, el.clientWidth / 2, el.clientHeight / 2);
  }

  function fitToScreen() {
    const el = viewportRef.current;
    if (!el || !layout.width || !layout.height) return;
    setView(fitView(el, layout));
  }

  if (loading) return <p style={styles.empty}>Loading pipeline…</p>;

  if (!layout.chains.length) {
    return (
      <div style={styles.empty}>
        <p style={{ margin: 0, color: colors.text }}>Nothing in flight.</p>
        <p style={{ margin: `${spacing.sm}px 0 0`, fontSize: fontSizes.sm }}>
          Projects appear here once they leave Queue and Backlog, and drop off again when
          they publish.
        </p>
      </div>
    );
  }

  const liveCount = layout.chains.filter(c => c.live).length;

  return (
    <div style={styles.wrap}>
      <div
        ref={viewportRef}
        style={{ ...styles.viewport, cursor: panning ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          style={{
            ...styles.canvas,
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          }}
        >
          {/* Connectors sit under the nodes so a node's fill always wins. */}
          <svg width={layout.width} height={layout.height} style={styles.svg}>
            {layout.chains.map(chain => (
              <ChainConnectors key={chain.project.id} chain={chain} />
            ))}
          </svg>

          {layout.showLaneHeaders && layout.lanes.map(lane => (
            <div key={lane.key} style={{ ...styles.laneHeader, left: lane.x, width: lane.width }}>
              <span style={styles.laneTitle}>{lane.title}</span>
              <span style={styles.laneCount}>{lane.projects.length}</span>
            </div>
          ))}

          {layout.chains.map(chain => (
            <div key={chain.project.id}>
              <div
                style={{
                  ...styles.chainTitle,
                  left: chain.nodes[0].x - NODE_W / 2,
                  top: chain.nodes[0].y - 40,
                  width: NODE_W,
                }}
              >
                <div style={styles.chainName} title={chain.project.name}>{chain.project.name}</div>
                <div style={styles.chainMeta}>{typeLabel(chain.project.type)}</div>
              </div>

              {chain.nodes.map(node => (
                <Node
                  key={`${chain.project.id}-${node.stage}`}
                  node={node}
                  person={node.assigneeId ? people[node.assigneeId] : null}
                  onClick={() => onOpenProject?.(chain.project)}
                />
              ))}
            </div>
          ))}
        </div>

        {/* ── Chrome ── */}
        <div style={styles.legend}>
          {['done', 'active', 'blocked', 'locked'].map(s => (
            <span key={s} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: STATE_TONE[s].fg }} />
              {s}
            </span>
          ))}
          <span style={styles.legendCount}>
            {layout.chains.length} in flight · {liveCount} moving
          </span>
        </div>
        <div style={styles.controls} onPointerDown={(e) => e.stopPropagation()}>
          <button style={styles.ctrlBtn} onClick={() => zoomByButton(-0.15)} title="Zoom out">−</button>
          <button style={styles.ctrlBtn} onClick={fitToScreen} title="Fit the whole pipeline in view">Fit</button>
          <button style={styles.ctrlBtn} onClick={() => zoomByButton(0.15)} title="Zoom in">+</button>
          <span style={styles.zoomLabel}>{Math.round(view.k * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Connectors ────────────────────────────────────────────────

function ChainConnectors({ chain }) {
  const segs = [];
  for (let i = 0; i < chain.nodes.length - 1; i++) {
    const a = chain.nodes[i];
    const b = chain.nodes[i + 1];
    const d = `M ${a.x} ${a.y + NODE_H / 2} L ${b.x} ${b.y - NODE_H / 2}`;
    // Flow runs on the segment feeding the live node — that's where work is.
    const flowing = b.state === 'active' || b.state === 'blocked';
    segs.push({ d, flowing, key: `${chain.project.id}-${i}`, tone: b.state });
  }

  return (
    <g>
      {segs.map(s => (
        <g key={s.key}>
          <path d={s.d} fill="none" stroke={colors.border} strokeWidth={1.5} />
          {s.flowing && (
            <>
              <path
                className="pipe-flow"
                d={s.d}
                fill="none"
                stroke={STATE_TONE[s.tone].fg}
                strokeWidth={1.75}
                opacity={0.85}
              />
              <circle className="pipe-token" r={3} fill={STATE_TONE[s.tone].fg}>
                <animateMotion dur="2.6s" repeatCount="indefinite" path={s.d} />
              </circle>
            </>
          )}
        </g>
      ))}
      {/* Arrowheads into each node keep the direction unambiguous when zoomed out. */}
      {chain.nodes.slice(1).map((n, i) => (
        <path
          key={`${chain.project.id}-arrow-${i}`}
          d={`M ${n.x - 4} ${n.y - NODE_H / 2 - 6} L ${n.x} ${n.y - NODE_H / 2 - 1} L ${n.x + 4} ${n.y - NODE_H / 2 - 6}`}
          fill="none"
          stroke={colors.borderStrong}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

// ── Node ──────────────────────────────────────────────────────

function Node({ node, person, onClick }) {
  const tone = STATE_TONE[node.state];
  const cls = node.state === 'active' ? 'pipe-active' : node.state === 'blocked' ? 'pipe-blocked' : '';
  const dim = node.state === 'locked';

  return (
    <div
      className={cls}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      title={node.holdReason ? `On hold: ${node.holdReason}` : undefined}
      style={{
        ...styles.node,
        left: node.x - NODE_W / 2,
        top: node.y - NODE_H / 2,
        background: tone.bg,
        borderColor: tone.border,
        opacity: dim ? 0.75 : 1,
      }}
    >
      <div style={{ ...styles.nodeStage, color: dim ? tone.fg : colors.text }}>{node.label}</div>
      <div style={{ ...styles.nodeState, color: tone.fg }}>{node.state}</div>
      {(person || node.countdown) && (
        <div style={styles.nodeFoot}>
          {person && <span style={styles.nodePerson}>{firstName(person)}</span>}
          {person && node.countdown && <span style={styles.nodeDot}>·</span>}
          {node.countdown && (
            <span style={{ color: node.countdown.overdue ? colors.blocked.fg : colors.textSubtle }}>
              {node.countdown.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────

function firstName(full) {
  return String(full || '').split(' ')[0];
}

// ── Styles ────────────────────────────────────────────────────

const styles = {
  wrap: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  viewport: {
    position: 'relative',
    flex: 1,
    overflow: 'hidden',
    background: colors.bg,
    cursor: 'grab',
    touchAction: 'none',
  },
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    transformOrigin: '0 0',
    willChange: 'transform',
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
    pointerEvents: 'none',
    overflow: 'visible',
  },

  laneHeader: {
    position: 'absolute',
    top: spacing.md,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottom: `1px solid ${colors.border}`,
    boxSizing: 'border-box',
  },
  laneTitle: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
  },
  laneCount: {
    fontSize: fontSizes.xxs,
    color: colors.textDim,
  },

  chainTitle: { position: 'absolute', textAlign: 'center' },
  chainName: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  chainMeta: {
    fontSize: fontSizes.xxs,
    color: colors.textDim,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },

  node: {
    position: 'absolute',
    width: NODE_W,
    height: NODE_H,
    boxSizing: 'border-box',
    border: '1px solid',
    borderRadius: radii.md,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 1,
    cursor: 'pointer',
    transition: transitions.fast,
  },
  nodeStage: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  nodeState: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  nodeFoot: {
    fontSize: fontSizes.xxs,
    color: colors.textSubtle,
    display: 'flex',
    gap: spacing.xs,
    alignItems: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  nodePerson: { color: colors.textMuted },
  nodeDot: { color: colors.textDim },

  legend: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    display: 'flex',
    gap: spacing.md,
    alignItems: 'center',
    fontSize: fontSizes.xxs,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    pointerEvents: 'none',
  },
  legendItem: { display: 'flex', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: radii.circle, display: 'inline-block' },
  legendCount: { textTransform: 'none', letterSpacing: 0, color: colors.textDim },

  controls: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.lg,
    display: 'flex',
    gap: spacing.xs,
  },
  zoomLabel: {
    alignSelf: 'center',
    minWidth: 34,
    textAlign: 'right',
    fontSize: fontSizes.xxs,
    color: colors.textDim,
    fontVariantNumeric: 'tabular-nums',
  },
  ctrlBtn: {
    minWidth: 28,
    height: 26,
    padding: `0 ${spacing.sm}px`,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    color: colors.textMuted,
    cursor: 'pointer',
    fontSize: fontSizes.sm,
  },

  empty: {
    padding: `${spacing.huge}px ${spacing.xl}px`,
    textAlign: 'center',
    color: colors.textSubtle,
    fontSize: fontSizes.md,
  },
};
