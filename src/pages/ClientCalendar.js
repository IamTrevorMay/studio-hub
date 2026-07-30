import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { colors, spacing, radii, fontSizes, fontWeights, transitions } from '../lib/styleTokens';

// Client portal calendar — a self-contained month view over the
// `client_calendar_events()` RPC. Clients are RLS-fenced off the staff
// `calendar_events` table entirely, so this page never queries it: the RPC is
// the single data source and returns two row kinds:
//   'own'  — the client's contracted assignments (title, dates, status)
//   'busy' — anonymized blocks for their editors' other active assignments
//            (dates + editor name only; no titles by design)
// Clicking one of your own assignment pills deep-links into the dashboard via
// onNavigate('cl_dashboard', assignment_id).

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Local YYYY-MM-DD key. The RPC returns plain date strings ('2026-07-30'), so
// keying by string (never `new Date('YYYY-MM-DD')`, which parses as UTC)
// sidesteps the PT-vs-UTC off-by-one class entirely.
function dayKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// 'HH:MM[:SS]' → 'h:MM AM/PM'
function formatDueTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${pad2(m)} ${suffix}`;
}

const MAX_PILLS_PER_CELL = 3;
const PILL_ORDER = { due: 0, assigned: 1, busy: 2 };

export default function ClientCalendar({ onNavigate }) {
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [expandedDays, setExpandedDays] = useState(() => new Set()); // dayKeys showing all pills

  // Fetch once per mount — the RPC returns every row for this client (volumes
  // are tiny), and we filter to the visible month client-side.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('client_calendar_events');
      if (cancelled) return;
      if (error) {
        console.error('Error fetching client calendar events:', error);
        setLoadError(error.message);
      } else {
        setEvents(data || []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // dayKey → sorted pill list. Own rows produce a solid pill on their due date
  // and an outlined "assigned" pill on their assigned date; busy rows produce
  // one gray pill per editor per day (deduped) on their due date only.
  const pillsByDay = useMemo(() => {
    const map = new Map();
    const add = (key, pill) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(pill);
    };
    const busySeen = new Set(); // `${editor_id}|${date}` dedup
    for (const ev of events) {
      if (ev.kind === 'own') {
        if (ev.due_date) {
          add(ev.due_date, {
            type: 'due',
            title: ev.title || 'Untitled',
            dueTime: ev.due_time,
            completed: ev.status === 'completed',
            assignmentId: ev.assignment_id,
          });
        }
        if (ev.assigned_date) {
          add(ev.assigned_date, {
            type: 'assigned',
            title: ev.title || 'Untitled',
            assignmentId: ev.assignment_id,
          });
        }
      } else if (ev.kind === 'busy' && ev.due_date) {
        const dedupKey = `${ev.editor_id}|${ev.due_date}`;
        if (busySeen.has(dedupKey)) continue;
        busySeen.add(dedupKey);
        add(ev.due_date, { type: 'busy', editorName: ev.editor_name || 'Editor' });
      }
    }
    for (const pills of map.values()) {
      pills.sort((a, b) => PILL_ORDER[a.type] - PILL_ORDER[b.type]);
    }
    return map;
  }, [events]);

  // 42 cells (6 rows × 7), starting the Sunday on/before the 1st.
  const cells = useMemo(() => {
    const first = startOfMonth(monthCursor);
    const gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - first.getDay());
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      out.push(d);
    }
    return out;
  }, [monthCursor]);

  const monthLabel = monthCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayKey = dayKey(new Date());
  const monthIsEmpty = !loading && !cells.some(d =>
    d.getMonth() === monthCursor.getMonth() && (pillsByDay.get(dayKey(d)) || []).length > 0
  );

  function shiftMonth(delta) {
    setMonthCursor(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
    setExpandedDays(new Set());
  }

  function goToToday() {
    setMonthCursor(startOfMonth(new Date()));
    setExpandedDays(new Set());
  }

  function toggleDayExpanded(key) {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handlePillClick(pill) {
    if (pill.assignmentId && onNavigate) onNavigate('cl_dashboard', pill.assignmentId);
  }

  function renderPill(pill, idx) {
    if (pill.type === 'busy') {
      return (
        <div key={idx} style={styles.pillBusy} title={`${pill.editorName} is booked on another project`}>
          {pill.editorName} — busy
        </div>
      );
    }
    if (pill.type === 'assigned') {
      return (
        <button
          key={idx}
          type="button"
          onClick={() => handlePillClick(pill)}
          style={styles.pillAssigned}
          title={`${pill.title} — assigned`}
        >
          {pill.title} · assigned
        </button>
      );
    }
    // 'due'
    const label = pill.dueTime ? `⏰ ${pill.title}` : pill.title;
    const title = pill.completed
      ? `${pill.title} — completed`
      : `${pill.title} — due${pill.dueTime ? ` at ${formatDueTime(pill.dueTime)}` : ''}`;
    return (
      <button
        key={idx}
        type="button"
        onClick={() => handlePillClick(pill)}
        style={pill.completed ? styles.pillDone : styles.pillDue}
        title={title}
      >
        {label}
      </button>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Calendar</h1>
        <div style={styles.nav}>
          <button type="button" onClick={() => shiftMonth(-1)} style={styles.navBtn} aria-label="Previous month">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span style={styles.monthLabel}>{monthLabel}</span>
          <button type="button" onClick={() => shiftMonth(1)} style={styles.navBtn} aria-label="Next month">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" onClick={goToToday} style={styles.todayBtn}>Today</button>
        </div>
      </div>

      {loadError && (
        <div style={styles.errorBanner}>Could not load your calendar: {loadError}</div>
      )}

      <div style={styles.weekdayRow}>
        {WEEKDAYS.map(d => <span key={d} style={styles.weekdayCell}>{d}</span>)}
      </div>

      <div style={styles.grid}>
        {cells.map(date => {
          const key = dayKey(date);
          const inMonth = date.getMonth() === monthCursor.getMonth();
          const isToday = key === todayKey;
          const pills = pillsByDay.get(key) || [];
          const expanded = expandedDays.has(key);
          const visible = expanded ? pills : pills.slice(0, MAX_PILLS_PER_CELL);
          const hiddenCount = pills.length - visible.length;
          return (
            <div
              key={key}
              style={{
                ...styles.dayCell,
                ...(inMonth ? {} : styles.dayCellOutside),
                ...(isToday ? styles.dayCellToday : {}),
              }}
            >
              <div style={{ ...styles.dayNumber, ...(isToday ? styles.dayNumberToday : {}) }}>
                {date.getDate()}
              </div>
              <div style={styles.pillStack}>
                {visible.map((pill, i) => renderPill(pill, i))}
                {hiddenCount > 0 && (
                  <button type="button" onClick={() => toggleDayExpanded(key)} style={styles.moreBtn}>
                    +{hiddenCount} more
                  </button>
                )}
                {expanded && pills.length > MAX_PILLS_PER_CELL && (
                  <button type="button" onClick={() => toggleDayExpanded(key)} style={styles.moreBtn}>
                    Show less
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={styles.legend}>
        <span style={styles.legendItem}>
          <span style={{ ...styles.legendSwatch, background: colors.accent }} />
          Your due dates
        </span>
        <span style={styles.legendItem}>
          <span style={{ ...styles.legendSwatch, background: 'transparent', border: `1px solid ${colors.accentBorder}` }} />
          Assigned
        </span>
        <span style={styles.legendItem}>
          <span style={{ ...styles.legendSwatch, background: colors.whiteA06 }} />
          Editor busy (other projects)
        </span>
      </div>

      {loading && <p style={styles.emptyNote}>Loading…</p>}
      {monthIsEmpty && !loadError && (
        <p style={styles.emptyNote}>Nothing scheduled this month.</p>
      )}
    </div>
  );
}

const styles = {
  page: {
    padding: spacing.xxl,
    maxWidth: 1100,
    margin: '0 auto',
    color: colors.text,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSizes.display,
    fontWeight: fontWeights.bold,
    margin: 0,
    color: colors.text,
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  },
  navBtn: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    background: colors.whiteA03,
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: transitions.fast,
  },
  monthLabel: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    color: colors.text,
    minWidth: 160,
    textAlign: 'center',
  },
  todayBtn: {
    padding: `${spacing.xs + 2}px ${spacing.md}px`,
    border: `1px solid ${colors.accentBorder}`,
    borderRadius: radii.md,
    background: colors.accentSoft,
    color: colors.accentFg,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginLeft: spacing.xs,
  },
  errorBanner: {
    padding: `${spacing.sm}px ${spacing.md}px`,
    marginBottom: spacing.md,
    background: colors.danger.bg,
    border: `1px solid ${colors.danger.border}`,
    borderRadius: radii.md,
    color: colors.danger.fgSoft,
    fontSize: fontSizes.md,
  },
  weekdayRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  weekdayCell: {
    fontSize: fontSizes.xs,
    color: colors.textDim,
    textAlign: 'center',
    fontWeight: fontWeights.semibold,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: spacing.xs,
  },
  dayCell: {
    minHeight: 96,
    background: colors.whiteA02,
    border: `1px solid ${colors.whiteA06}`,
    borderRadius: radii.md,
    padding: spacing.xs + 2,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
    minWidth: 0,
  },
  dayCellOutside: {
    opacity: 0.35,
  },
  dayCellToday: {
    boxShadow: `inset 0 0 0 1.5px ${colors.accent}`,
    background: colors.accentA06,
  },
  dayNumber: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.textSubtle,
  },
  dayNumberToday: {
    color: colors.accentFg,
    fontWeight: fontWeights.bold,
  },
  pillStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
    minWidth: 0,
  },
  pillDue: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: '3px 6px',
    background: colors.accent,
    border: '1px solid transparent',
    borderRadius: radii.sm,
    color: colors.white,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  pillDone: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: '3px 6px',
    background: colors.success.bg,
    border: `1px solid ${colors.success.border}`,
    borderRadius: radii.sm,
    color: colors.success.fgSoft,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textDecoration: 'line-through',
    opacity: 0.8,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  pillAssigned: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: '3px 6px',
    background: colors.accentA08,
    border: `1px solid ${colors.accentBorder}`,
    borderRadius: radii.sm,
    color: colors.accentFg,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  pillBusy: {
    boxSizing: 'border-box',
    padding: '3px 6px',
    background: colors.whiteA05,
    border: `1px solid ${colors.whiteA06}`,
    borderRadius: radii.sm,
    color: colors.textSubtle,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  moreBtn: {
    alignSelf: 'flex-start',
    padding: '2px 6px',
    background: 'transparent',
    border: 'none',
    color: colors.textDim,
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  legend: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    fontSize: fontSizes.sm,
    color: colors.textMuted,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: radii.xs,
    boxSizing: 'border-box',
    flexShrink: 0,
  },
  emptyNote: {
    marginTop: spacing.lg,
    textAlign: 'center',
    color: colors.textDim,
    fontSize: fontSizes.md,
  },
};
