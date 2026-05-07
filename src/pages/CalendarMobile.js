import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import BottomSheet from '../components/mobile/BottomSheet';
import { mobileTokens } from '../utils/mobileTokens';

const EVENT_TYPE_COLORS = {
  deadline: '#ef4444', meeting: '#3b82f6', live_recording: '#22c55e',
  filming: '#f59e0b', video_post: '#a855f7', unavailable: '#6b7280', sponsor: '#10b981',
};
const EVENT_TYPE_LABELS = {
  deadline: 'Deadline', meeting: 'Meeting', live_recording: 'Live/Recording',
  filming: 'Filming', video_post: 'Video Post', unavailable: 'Unavailable', sponsor: 'Sponsor',
};

const WEEKDAYS_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const HORIZON_DAYS = 30;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d) {
  return startOfDay(d).toISOString().slice(0, 10);
}

function fmtDayHeader(d) {
  const today = startOfDay(new Date());
  const target = startOfDay(d);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return target.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function fmtTime(iso, allDay) {
  if (allDay) return 'All day';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function CalendarMobile() {
  const { profile } = useAuth(); // eslint-disable-line no-unused-vars
  const [view, setView] = useState('agenda'); // 'agenda' | 'month'
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [selectedDay, setSelectedDay] = useState(null); // for month view tap

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const start = startOfDay(new Date());
      start.setDate(start.getDate() - 7);
      const end = new Date(start);
      end.setDate(end.getDate() + HORIZON_DAYS + 30);
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*, creator:profiles!created_by(id, full_name)')
        .gte('end_date', start.toISOString())
        .lte('start_date', end.toISOString())
        .order('start_date', { ascending: true });
      if (error) throw error;
      setEvents(data || []);
    } catch (err) {
      console.error('Calendar fetch failed:', err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  return (
    <div style={styles.root}>
      <div style={styles.viewToggle}>
        <ToggleBtn label="Agenda" active={view === 'agenda'} onClick={() => setView('agenda')} />
        <ToggleBtn label="Month" active={view === 'month'} onClick={() => setView('month')} />
      </div>

      {loading ? (
        <p style={styles.empty}>Loading…</p>
      ) : view === 'agenda' ? (
        <AgendaView events={events} onSelect={setSelectedEvent} />
      ) : (
        <MonthView
          events={events}
          monthCursor={monthCursor}
          setMonthCursor={setMonthCursor}
          onSelectDay={setSelectedDay}
        />
      )}

      <BottomSheet
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent?.title || 'Event'}
      >
        {selectedEvent && <EventDetail event={selectedEvent} />}
      </BottomSheet>

      <BottomSheet
        open={!!selectedDay}
        onClose={() => setSelectedDay(null)}
        title={selectedDay ? fmtDayHeader(selectedDay) : ''}
        maxHeight="80vh"
      >
        {selectedDay && (
          <DayEvents
            events={eventsForDay(events, selectedDay)}
            onSelect={(ev) => { setSelectedDay(null); setTimeout(() => setSelectedEvent(ev), 220); }}
          />
        )}
      </BottomSheet>
    </div>
  );
}

function ToggleBtn({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: mobileTokens.tap,
        border: 'none',
        background: active ? 'rgba(99,102,241,0.16)' : 'transparent',
        color: active ? '#a5b4fc' : 'rgba(255,255,255,0.6)',
        fontSize: mobileTokens.font.md,
        fontWeight: active ? 600 : 500,
        borderRadius: mobileTokens.radius.md,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

function AgendaView({ events, onSelect }) {
  const sections = useMemo(() => buildAgenda(events), [events]);
  if (sections.length === 0) {
    return <p style={styles.empty}>Nothing scheduled in the next {HORIZON_DAYS} days.</p>;
  }
  return (
    <div style={styles.agenda}>
      {sections.map((section) => (
        <section key={section.key} style={styles.daySection}>
          <h3 style={styles.dayHeader}>{section.label}</h3>
          <div style={styles.eventList}>
            {section.events.map((ev) => (
              <button key={ev.__instanceId || ev.id} onClick={() => onSelect(ev)} style={{ ...styles.eventRow, borderLeft: `3px solid ${EVENT_TYPE_COLORS[ev.event_type] || '#6366f1'}` }}>
                <div style={styles.eventTime}>{fmtTime(ev.__instanceStart || ev.start_date, ev.all_day)}</div>
                <div style={styles.eventBody}>
                  <div style={styles.eventTitle}>{ev.title || 'Untitled'}</div>
                  <div style={styles.eventMeta}>{EVENT_TYPE_LABELS[ev.event_type] || 'Event'}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function buildAgenda(events) {
  const today = startOfDay(new Date());
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);

  const buckets = new Map();
  for (const ev of events) {
    if (!ev.start_date) continue;
    const start = new Date(ev.start_date);
    const evDay = startOfDay(start);
    if (evDay < today) continue;
    if (evDay > horizon) continue;
    const key = dayKey(evDay);
    if (!buckets.has(key)) buckets.set(key, { date: evDay, events: [] });
    buckets.get(key).events.push(ev);
  }
  const sortedKeys = [...buckets.keys()].sort();
  return sortedKeys.map((key) => {
    const bucket = buckets.get(key);
    bucket.events.sort((a, b) => {
      if (a.all_day && !b.all_day) return -1;
      if (!a.all_day && b.all_day) return 1;
      return new Date(a.start_date) - new Date(b.start_date);
    });
    return { key, label: fmtDayHeader(bucket.date), events: bucket.events };
  });
}

function eventsForDay(events, day) {
  const target = startOfDay(day);
  const next = new Date(target);
  next.setDate(next.getDate() + 1);
  return events.filter((ev) => {
    const start = ev.start_date && new Date(ev.start_date);
    if (!start) return false;
    return start >= target && start < next;
  }).sort((a, b) => {
    if (a.all_day && !b.all_day) return -1;
    if (!a.all_day && b.all_day) return 1;
    return new Date(a.start_date) - new Date(b.start_date);
  });
}

function MonthView({ events, monthCursor, setMonthCursor, onSelectDay }) {
  const cells = useMemo(() => buildMonthCells(monthCursor, events), [monthCursor, events]);
  const monthLabel = monthCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  function shift(delta) {
    const d = new Date(monthCursor);
    d.setMonth(d.getMonth() + delta);
    setMonthCursor(d);
  }

  return (
    <div style={styles.month}>
      <div style={styles.monthNav}>
        <button onClick={() => shift(-1)} style={styles.monthNavBtn} aria-label="Previous month">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span style={styles.monthLabel}>{monthLabel}</span>
        <button onClick={() => shift(1)} style={styles.monthNavBtn} aria-label="Next month">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div style={styles.weekdayRow}>
        {WEEKDAYS_SHORT.map((d, i) => <span key={i} style={styles.weekdayCell}>{d}</span>)}
      </div>
      <div style={styles.grid}>
        {cells.map((cell, i) => {
          const inMonth = cell.date.getMonth() === monthCursor.getMonth();
          const isToday = dayKey(cell.date) === dayKey(new Date());
          return (
            <button
              key={i}
              onClick={() => onSelectDay(cell.date)}
              style={{
                ...styles.dayCell,
                opacity: inMonth ? 1 : 0.35,
                background: isToday ? 'rgba(99,102,241,0.16)' : 'transparent',
                color: isToday ? '#a5b4fc' : '#e2e8f0',
                fontWeight: isToday ? 700 : 500,
              }}
            >
              <span>{cell.date.getDate()}</span>
              {cell.count > 0 && (
                <span style={{
                  ...styles.dayDot,
                  background: cell.count > 0 ? '#6366f1' : 'transparent',
                }}>{cell.count > 1 ? cell.count : ''}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildMonthCells(cursor, events) {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startWeekday = firstOfMonth.getDay(); // 0 Sun
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - startWeekday);

  const counts = new Map();
  for (const ev of events) {
    if (!ev.start_date) continue;
    const k = dayKey(new Date(ev.start_date));
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    cells.push({ date: d, count: counts.get(dayKey(d)) || 0 });
  }
  return cells;
}

function DayEvents({ events, onSelect }) {
  if (events.length === 0) return <p style={styles.empty}>No events this day.</p>;
  return (
    <div style={styles.eventList}>
      {events.map((ev) => (
        <button key={ev.id} onClick={() => onSelect(ev)} style={{ ...styles.eventRow, borderLeft: `3px solid ${EVENT_TYPE_COLORS[ev.event_type] || '#6366f1'}` }}>
          <div style={styles.eventTime}>{fmtTime(ev.start_date, ev.all_day)}</div>
          <div style={styles.eventBody}>
            <div style={styles.eventTitle}>{ev.title || 'Untitled'}</div>
            <div style={styles.eventMeta}>{EVENT_TYPE_LABELS[ev.event_type] || 'Event'}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function EventDetail({ event }) {
  const accent = EVENT_TYPE_COLORS[event.event_type] || '#6366f1';
  const start = event.start_date && new Date(event.start_date);
  const end = event.end_date && new Date(event.end_date);
  return (
    <div style={detailStyles.root}>
      <div style={{ ...detailStyles.typePill, background: `${accent}20`, color: accent, borderColor: `${accent}50` }}>
        {EVENT_TYPE_LABELS[event.event_type] || 'Event'}
      </div>
      <h3 style={detailStyles.title}>{event.title || 'Untitled'}</h3>
      <DetailRow label="When" value={
        event.all_day
          ? `${start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} (all day)`
          : `${start.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${end ? ` – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}`
      } />
      {event.location && <DetailRow label="Location" value={event.location} />}
      {event.description && <DetailRow label="Notes" value={event.description} />}
      {event.creator?.full_name && <DetailRow label="Created by" value={event.creator.full_name} />}
      <p style={detailStyles.note}>To edit this event, open Mayday Studio on desktop.</p>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={detailStyles.row}>
      <div style={detailStyles.label}>{label}</div>
      <div style={detailStyles.value}>{value}</div>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100%',
    background: '#0f0f1a',
  },
  viewToggle: {
    display: 'flex',
    gap: mobileTokens.space.xs,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.md}px ${mobileTokens.space.sm}px`,
  },
  agenda: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.lg,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
  },
  daySection: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  dayHeader: {
    margin: 0,
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  eventList: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  eventRow: {
    display: 'flex',
    gap: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    border: 'none',
    width: '100%',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    minHeight: mobileTokens.tap,
    alignItems: 'flex-start',
  },
  eventTime: {
    minWidth: 76,
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: 600,
  },
  eventBody: { flex: 1, minWidth: 0 },
  eventTitle: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    lineHeight: 1.3,
    wordBreak: 'break-word',
  },
  eventMeta: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginTop: 2,
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xxl,
    margin: 0,
  },
  month: {
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.md}px ${mobileTokens.space.xxxl}px`,
  },
  monthNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${mobileTokens.space.sm}px 0`,
  },
  monthNavBtn: {
    width: mobileTokens.tap,
    height: mobileTokens.tap,
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  },
  monthLabel: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.2px',
  },
  weekdayRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
    paddingBottom: mobileTokens.space.sm,
  },
  weekdayCell: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
  },
  dayCell: {
    aspectRatio: '1 / 1',
    minHeight: 40,
    border: 'none',
    borderRadius: mobileTokens.radius.sm,
    fontSize: mobileTokens.font.md,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    color: '#e2e8f0',
  },
  dayDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    fontSize: 9,
    color: '#fff',
    minWidth: 6,
    minHeight: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
};

const detailStyles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.md,
  },
  typePill: {
    alignSelf: 'flex-start',
    padding: `4px 10px`,
    borderRadius: mobileTokens.radius.pill,
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    border: '1px solid',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  title: {
    margin: 0,
    fontSize: mobileTokens.font.xl,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.3px',
    lineHeight: 1.2,
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: `${mobileTokens.space.sm}px 0`,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  label: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
  },
  value: {
    fontSize: mobileTokens.font.md,
    color: '#e2e8f0',
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  note: {
    margin: `${mobileTokens.space.sm}px 0 0`,
    padding: mobileTokens.space.md,
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.6)',
    fontSize: mobileTokens.font.sm,
    textAlign: 'center',
  },
};
