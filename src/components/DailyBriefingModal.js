import React, { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '../supabaseClient';
import { tritonSupabase } from '../tritonClient';
import { useAuth } from '../contexts/AuthContext';
import { ptDayKey, ptRangeToUtc } from '../lib/ptDate';
import { modalOverlay, modal as modalShell } from '../lib/styleRecipes';
import backdropDismiss from '../lib/backdropDismiss';

// The sections themselves always stack, but Upcoming Day splits its two
// lists (tasks / itinerary) side by side once there's room for both to keep
// a readable measure. Below this the modal (90vw) is too narrow for that.
const WIDE_LAYOUT_QUERY = '(min-width: 900px)';

// The Triton brief lays its box-score cards out four across, which is far too
// tight at this modal's measure — abbreviations stack vertically and the
// linescores get clipped. The grid lives in the stored brief's inline styles,
// so rewrite it to two-up on the way in; that fixes briefs already written as
// well as new ones. Other grids in the brief (division standings, etc.) are
// left alone.
function twoUpBoxScores(html) {
  return html.replace(
    /grid-template-columns\s*:\s*repeat\(\s*4\s*,\s*1fr\s*\)/gi,
    'grid-template-columns:repeat(2,minmax(0,1fr))',
  );
}

function useWideLayout() {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(WIDE_LAYOUT_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(WIDE_LAYOUT_QUERY);
    const handler = (e) => setWide(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, []);
  return wide;
}

// Scrollable "Daily Briefing" modal auto-shown once each morning from the
// Dashboard. Two independently-optional blocks driven by
// profile.daily_briefing_prefs: Around Baseball (Triton brief) + Upcoming Day
// (today's tasks + calendar itinerary). Read-only; pure display.
export default function DailyBriefingModal({ onClose }) {
  const { profile } = useAuth();
  const wide = useWideLayout();
  const prefs = profile?.daily_briefing_prefs || {};
  const showBaseball = prefs.around_baseball !== false;
  const showUpcoming = prefs.upcoming_day !== false;

  const now = new Date();
  const todayKey = ptDayKey(now); // PT calendar day 'YYYY-MM-DD'
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const [brief, setBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(showBaseball);
  const [tasks, setTasks] = useState([]);
  const [itinerary, setItinerary] = useState([]);
  const [upcomingLoading, setUpcomingLoading] = useState(showUpcoming);

  // ── Around Baseball: latest Triton brief (prefer today, else most recent) ──
  const fetchBrief = useCallback(async () => {
    if (!showBaseball || !tritonSupabase) { setBriefLoading(false); return; }
    setBriefLoading(true);
    try {
      const { data, error } = await tritonSupabase
        .from('briefs')
        .select('*')
        .lte('date', todayKey)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setBrief(data || null);
    } catch (err) {
      console.error('Daily briefing: brief fetch failed:', err);
      setBrief(null);
    } finally {
      setBriefLoading(false);
    }
  }, [showBaseball, todayKey]);

  // ── Upcoming Day: today's tasks (personal + assigned, deduped) + itinerary ──
  const fetchUpcoming = useCallback(async () => {
    if (!showUpcoming || !profile?.id) { setUpcomingLoading(false); return; }
    setUpcomingLoading(true);
    const uid = profile.id;
    try {
      // Personal / sprint-board tasks owned by the user, due today. These rows
      // also carry the user's project/workflow work when it's routed to the
      // Sprint Board (task_id set), so this is the primary task source. Scoped
      // to exactly today — a morning briefing shouldn't dredge up the whole
      // overdue backlog (which can run into the hundreds).
      const { data: personal } = await supabase
        .from('personal_tasks')
        .select('id, content, due_date, status, task_id')
        .eq('created_by', uid)
        .neq('status', 'done')
        .eq('due_date', todayKey);

      // Directly-assigned workflow/project stage tasks (the non-sprint path).
      const { data: assigned } = await supabase
        .from('tasks')
        .select('id, title, due_date, status, link_url')
        .eq('assignee_id', uid)
        .in('status', ['pending', 'active', 'on_hold'])
        .not('due_date', 'is', null);

      // A task already surfaced as a Sprint Board card (personal_tasks.task_id)
      // must not be counted twice — drop it from the assigned list.
      const sprintCardTaskIds = new Set((personal || []).map((r) => r.task_id).filter(Boolean));

      const rows = [];
      for (const p of personal || []) {
        rows.push({ id: `pt-${p.id}`, label: p.content || 'Untitled task' });
      }
      for (const t of assigned || []) {
        if (sprintCardTaskIds.has(t.id)) continue;
        if (ptDayKey(t.due_date) !== todayKey) continue; // due today only
        rows.push({ id: `t-${t.id}`, label: t.title || 'Untitled task' });
      }
      setTasks(rows);

      // Today's calendar itinerary: events starting today (PT) that the user
      // created or is a guest on, time-ordered.
      const { startUtc, endUtc } = ptRangeToUtc(todayKey, todayKey);
      const { data: events } = await supabase
        .from('calendar_events')
        .select('id, title, start_date, end_date, all_day, created_by, guests')
        .gte('start_date', startUtc)
        .lt('start_date', endUtc)
        .or(`created_by.eq.${uid},guests.cs.{${uid}}`)
        .order('all_day', { ascending: false })
        .order('start_date', { ascending: true });
      setItinerary(events || []);
    } catch (err) {
      console.error('Daily briefing: upcoming fetch failed:', err);
    } finally {
      setUpcomingLoading(false);
    }
  }, [showUpcoming, profile?.id, todayKey]);

  useEffect(() => { fetchBrief(); }, [fetchBrief]);
  useEffect(() => { fetchUpcoming(); }, [fetchUpcoming]);

  function eventTime(ev) {
    if (ev.all_day) return 'All day';
    try {
      return new Date(ev.start_date).toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  // Layout: the sections always stack in one column and the body scrolls as a
  // whole — the day's tasks first, the brief underneath. (These used to sit
  // side by side on a wide viewport.) Upcoming Day still splits its own two
  // lists across the width when there's room, since it now always has the
  // full measure to work with.
  const upcomingSplit = wide && showUpcoming;
  const bodyStyle = { ...st.body, display: 'block', overflowY: 'auto' };
  const columnStyle = st.stackedSection;

  return (
    <div style={modalOverlay()} {...backdropDismiss(onClose)}>
      <div style={st.card}>
        {/* Header */}
        <div style={st.header}>
          <div style={{ minWidth: 0 }}>
            <div style={st.greeting}>{greeting}</div>
            <div style={st.date}>{dateLabel}</div>
          </div>
          <button onClick={onClose} style={st.closeBtn} aria-label="Close briefing">✕</button>
        </div>

        <div style={bodyStyle}>
          {/* ── Upcoming Day ── */}
          {showUpcoming && (
            <section style={columnStyle}>
              <div style={st.sectionTitle}>Upcoming Day</div>

              <div style={{ ...st.lists, gridTemplateColumns: upcomingSplit ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={st.subTitle}>Today's Tasks</div>
                  {upcomingLoading ? (
                    <div style={st.muted}>Loading tasks…</div>
                  ) : tasks.length === 0 ? (
                    <div style={st.emptyCard}>No tasks due today. You're clear.</div>
                  ) : (
                    <div style={st.list}>
                      {tasks.map((t) => (
                        <div key={t.id} style={st.taskRow}>
                          <span style={st.checkbox} />
                          <span style={st.taskLabel}>{t.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ minWidth: 0, marginTop: upcomingSplit ? 0 : '18px' }}>
                  <div style={st.subTitle}>Today's Itinerary</div>
                  {upcomingLoading ? (
                    <div style={st.muted}>Loading itinerary…</div>
                  ) : itinerary.length === 0 ? (
                    <div style={st.emptyCard}>Nothing on the calendar today.</div>
                  ) : (
                    <div style={st.list}>
                      {itinerary.map((ev) => (
                        <div key={ev.id} style={st.eventRow}>
                          <span style={st.eventTime}>{eventTime(ev)}</span>
                          <span style={st.eventTitle}>{ev.title || 'Untitled event'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Around Baseball ── */}
          {showBaseball && (
            <section style={{ ...columnStyle, ...(showUpcoming ? st.topRule : null) }}>
              {/* The brief now runs the full modal width, so cap the measure —
                  ~1050px of line length is unreadable. */}
              <div style={st.soloMeasure}>
                <div style={st.sectionTitle}>Around Baseball</div>
                {briefLoading ? (
                  <div style={st.muted}>Loading brief…</div>
                ) : brief ? (
                  <div style={st.briefCard}>
                    <h2 style={st.briefTitle}>{brief.title}</h2>
                    {brief.summary && <p style={st.briefSummary}>{brief.summary}</p>}
                    <div
                      style={st.briefContent}
                      dangerouslySetInnerHTML={{ __html: twoUpBoxScores(DOMPurify.sanitize(brief.content || '')) }}
                    />
                  </div>
                ) : (
                  <div style={st.emptyCard}>No brief available yet today.</div>
                )}
              </div>
            </section>
          )}

          {!showBaseball && !showUpcoming && (
            <div style={{ ...st.emptyCard, alignSelf: 'start' }}>
              No briefing sections are enabled. Turn some on in settings.
            </div>
          )}
        </div>

        <div style={st.footer}>
          <button onClick={onClose} style={st.doneBtn}>Done</button>
        </div>
      </div>
    </div>
  );
}

const st = {
  card: {
    ...modalShell({ width: 1120 }),
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '85vh',
    overflow: 'hidden',
    fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: '12px', padding: '24px 32px 18px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  greeting: { fontSize: '22px', fontWeight: 700, color: '#ffffff' },
  date: { fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: '3px' },
  closeBtn: {
    background: 'rgba(255,255,255,0.06)', border: 'none', color: 'rgba(255,255,255,0.6)',
    width: '30px', height: '30px', borderRadius: '8px', cursor: 'pointer',
    fontSize: '14px', flexShrink: 0,
  },
  // Sections stack in one column and the body scrolls as a whole.
  body: {
    padding: '22px 32px 14px', flex: 1, minHeight: 0,
  },
  stackedSection: { minWidth: 0, marginBottom: '24px' },
  // Separates the stacked sections; only drawn when one sits above.
  topRule: { borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '22px' },
  // A brief on its own would run to ~1050px of line length; cap the measure.
  soloMeasure: { maxWidth: '760px', margin: '0 auto' },
  lists: { display: 'grid', gap: '0 32px', alignItems: 'start' },
  sectionTitle: {
    fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#8b8ff0', marginBottom: '12px',
  },
  subTitle: {
    fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginBottom: '8px',
  },
  briefCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    overflow: 'hidden',
  },
  briefTitle: {
    fontSize: '18px', fontWeight: 700, color: '#ffffff',
    margin: 0, padding: '18px 20px 4px', lineHeight: 1.3,
  },
  briefSummary: {
    fontSize: '13px', color: 'rgba(255,255,255,0.5)',
    margin: 0, padding: '0 20px 16px', lineHeight: 1.6,
  },
  briefContent: {
    padding: '18px 20px', fontSize: '14px', lineHeight: 1.7,
    color: 'rgba(255,255,255,0.75)', borderTop: '1px solid rgba(255,255,255,0.06)',
    overflowWrap: 'anywhere',
  },
  list: { display: 'flex', flexDirection: 'column', gap: '2px' },
  taskRow: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  checkbox: {
    width: '15px', height: '15px', borderRadius: '4px', flexShrink: 0,
    border: '1.5px solid rgba(255,255,255,0.25)',
  },
  taskLabel: { fontSize: '13.5px', color: 'rgba(255,255,255,0.85)', flex: 1, minWidth: 0 },
  eventRow: {
    display: 'flex', alignItems: 'baseline', gap: '12px',
    padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  eventTime: {
    fontSize: '12px', fontWeight: 600, color: '#8b8ff0',
    width: '72px', flexShrink: 0,
  },
  eventTitle: { fontSize: '13.5px', color: 'rgba(255,255,255,0.85)', flex: 1, minWidth: 0 },
  muted: { fontSize: '13px', color: 'rgba(255,255,255,0.4)', padding: '4px 0' },
  emptyCard: {
    fontSize: '13px', color: 'rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px', padding: '14px 16px',
  },
  footer: {
    padding: '14px 32px', borderTop: '1px solid rgba(255,255,255,0.06)',
    display: 'flex', justifyContent: 'flex-end',
  },
  doneBtn: {
    padding: '8px 20px', border: 'none', borderRadius: '9px',
    background: '#6366f1', color: '#fff', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
