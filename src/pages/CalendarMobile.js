import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import usePersistedTab from '../hooks/usePersistedTab';
import BottomSheet from '../components/mobile/BottomSheet';
import { mobileTokens } from '../utils/mobileTokens';
import { expandRecurringEvents } from '../lib/recurrence';
import { colors } from '../lib/styleTokens';

const EVENT_TYPE_COLORS = {
  deadline: '#ef4444', meeting: '#3b82f6', live_recording: '#22c55e',
  filming: '#f59e0b', video_post: '#a855f7', tmbb_video: '#06b6d4',
  unavailable: '#6b7280',
};
const EVENT_TYPE_LABELS = {
  deadline: 'Deadline', meeting: 'Meeting', live_recording: 'Live/Recording',
  filming: 'Filming/Recording', video_post: 'Mayday Video', tmbb_video: 'TMBB Video',
  unavailable: 'Unavailable',
};

const WEEKDAYS_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const HORIZON_DAYS = 30;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d) {
  // Build from LOCAL parts. toISOString() converts to UTC, so for UTC+ zones
  // local midnight maps to the previous UTC day → events bucket on the wrong day.
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
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
  const { profile } = useAuth();
  const [view, setView] = usePersistedTab('calendar-view-mobile', 'agenda', ['agenda', 'month']); // 'agenda' | 'month'
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [selectedDay, setSelectedDay] = useState(null); // for month view tap

  // Expand recurring events into concrete occurrences over a range covering both
  // the agenda horizon and the visible month grid. Without this, recurring events
  // only showed on their original start_date.
  const expandedEvents = useMemo(() => {
    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 7);
    rangeStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 7);
    const horizonEnd = new Date();
    horizonEnd.setDate(horizonEnd.getDate() + HORIZON_DAYS + 1);
    const rangeEnd = monthEnd > horizonEnd ? monthEnd : horizonEnd;
    return expandRecurringEvents(events, rangeStart, rangeEnd);
  }, [events, monthCursor]);

  // Event create (mobile-friendly subset of the desktop modal — title/
  // type/date/time/all-day/location). Recurrence + guests are desktop-
  // only for now; the row inserts via supabase directly to mirror
  // Calendar.js handleSaveEvent's payload shape.
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

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
        // Include recurring events regardless of range — their original dates may
        // predate the window but their occurrences fall inside it (expanded below).
        // `not.is.null` — `neq.null` compiles to `<> NULL` (never true) and drops recurring series.
        .or(`and(end_date.gte.${start.toISOString()},start_date.lte.${end.toISOString()}),recurrence_rule.not.is.null`)
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

  function openCreate(day) {
    const base = day || new Date();
    const next = new Date(base.getTime() + 60 * 60 * 1000);
    setCreateError(null);
    setCreateForm({
      title: '',
      event_type: 'meeting',
      start_date: ymd(base),
      start_time: hm(base),
      end_date: ymd(next),
      end_time: hm(next),
      all_day: false,
      location: '',
      description: '',
    });
    setShowCreate(true);
  }

  async function handleCreate() {
    if (!createForm) return;
    const f = createForm;
    if (!f.title.trim() || !f.start_date) { setCreateError('Title + start date required.'); return; }
    if (!profile?.id) { setCreateError('Not signed in.'); return; }
    setCreating(true); setCreateError(null);
    try {
      const startDate = f.all_day
        ? new Date(`${f.start_date}T00:00:00`)
        : new Date(`${f.start_date}T${f.start_time || '09:00'}:00`);
      const endDateStr = f.end_date || f.start_date;
      const endDate = f.all_day
        ? new Date(`${endDateStr}T23:59:59`)
        : new Date(`${endDateStr}T${f.end_time || '10:00'}:00`);
      const { error } = await supabase.from('calendar_events').insert({
        title: f.title.trim(),
        description: f.description.trim(),
        event_type: f.event_type,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        all_day: f.all_day,
        location: f.location.trim(),
        guests: [],
        recurrence_rule: null,
        created_by: profile.id,
      });
      if (error) throw error;
      setShowCreate(false);
      setCreateForm(null);
      fetchEvents();
    } catch (e) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={styles.root}>
      <div style={styles.viewToggle}>
        <ToggleBtn label="Agenda" active={view === 'agenda'} onClick={() => setView('agenda')} />
        <ToggleBtn label="Month" active={view === 'month'} onClick={() => setView('month')} />
      </div>

      {loading ? (
        <p style={styles.empty}>Loading…</p>
      ) : view === 'agenda' ? (
        <AgendaView events={expandedEvents} onSelect={setSelectedEvent} />
      ) : (
        <MonthView
          events={expandedEvents}
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
            events={eventsForDay(expandedEvents, selectedDay)}
            onSelect={(ev) => { setSelectedDay(null); setTimeout(() => setSelectedEvent(ev), 220); }}
            onAddForDay={() => {
              const day = selectedDay;
              setSelectedDay(null);
              setTimeout(() => openCreate(day), 220);
            }}
          />
        )}
      </BottomSheet>

      <BottomSheet
        open={showCreate}
        onClose={() => { setShowCreate(false); setCreateForm(null); }}
        title="New event"
        maxHeight="90vh"
      >
        {createForm && (
          <CreateEventForm
            form={createForm}
            onChange={(patch) => setCreateForm((f) => ({ ...f, ...patch }))}
            onSave={handleCreate}
            onCancel={() => { setShowCreate(false); setCreateForm(null); }}
            saving={creating}
            error={createError}
          />
        )}
      </BottomSheet>

      <button
        onClick={() => openCreate(view === 'month' ? monthCursor : null)}
        style={styles.fab}
        aria-label="New event"
      >
        +
      </button>
    </div>
  );
}

function ymd(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function hm(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CreateEventForm({ form, onChange, onSave, onCancel, saving, error }) {
  return (
    <div style={createStyles.root}>
      <Field label="Title">
        <input
          autoFocus
          value={form.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="What's happening?"
          style={createStyles.input}
        />
      </Field>

      <Field label="Type">
        <select
          value={form.event_type}
          onChange={(e) => onChange({ event_type: e.target.value })}
          style={createStyles.input}
        >
          {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </Field>

      <label style={createStyles.toggleRow}>
        <input
          type="checkbox"
          checked={form.all_day}
          onChange={(e) => onChange({ all_day: e.target.checked })}
        />
        <span>All day</span>
      </label>

      <div style={createStyles.row}>
        <Field label="Start date">
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => onChange({ start_date: e.target.value })}
            style={createStyles.input}
          />
        </Field>
        {!form.all_day && (
          <Field label="Start time">
            <input
              type="time"
              value={form.start_time}
              onChange={(e) => onChange({ start_time: e.target.value })}
              style={createStyles.input}
            />
          </Field>
        )}
      </div>

      <div style={createStyles.row}>
        <Field label="End date">
          <input
            type="date"
            value={form.end_date}
            onChange={(e) => onChange({ end_date: e.target.value })}
            style={createStyles.input}
          />
        </Field>
        {!form.all_day && (
          <Field label="End time">
            <input
              type="time"
              value={form.end_time}
              onChange={(e) => onChange({ end_time: e.target.value })}
              style={createStyles.input}
            />
          </Field>
        )}
      </div>

      <Field label="Location">
        <input
          value={form.location}
          onChange={(e) => onChange({ location: e.target.value })}
          placeholder="Optional"
          style={createStyles.input}
        />
      </Field>

      <Field label="Description">
        <textarea
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={3}
          style={{ ...createStyles.input, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>

      {error && <div style={createStyles.error}>{error}</div>}

      <div style={createStyles.actions}>
        <button onClick={onCancel} style={createStyles.cancelBtn}>Cancel</button>
        <button
          onClick={onSave}
          disabled={saving || !form.title.trim() || !form.start_date}
          style={{ ...createStyles.saveBtn, opacity: saving || !form.title.trim() || !form.start_date ? 0.5 : 1 }}
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={createStyles.field}>
      <span style={createStyles.fieldLabel}>{label}</span>
      {children}
    </label>
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
        background: active ? 'rgba(91, 143, 199,0.16)' : 'transparent',
        color: active ? '#8fb4d8' : 'rgba(255,255,255,0.6)',
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
              <button key={ev.__instanceId || ev.id} onClick={() => onSelect(ev)} style={{ ...styles.eventRow, borderLeft: `3px solid ${EVENT_TYPE_COLORS[ev.event_type] || '#5b8fc7'}` }}>
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
                background: isToday ? 'rgba(91, 143, 199,0.16)' : 'transparent',
                color: isToday ? '#8fb4d8' : '#e2e8f0',
                fontWeight: isToday ? 700 : 500,
              }}
            >
              <span>{cell.date.getDate()}</span>
              {cell.count > 0 && (
                <span style={{
                  ...styles.dayDot,
                  background: cell.count > 0 ? '#5b8fc7' : 'transparent',
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

function DayEvents({ events, onSelect, onAddForDay }) {
  return (
    <div style={styles.eventList}>
      {events.length === 0 ? (
        <p style={styles.empty}>No events this day.</p>
      ) : events.map((ev) => (
        <button key={ev.id} onClick={() => onSelect(ev)} style={{ ...styles.eventRow, borderLeft: `3px solid ${EVENT_TYPE_COLORS[ev.event_type] || '#5b8fc7'}` }}>
          <div style={styles.eventTime}>{fmtTime(ev.start_date, ev.all_day)}</div>
          <div style={styles.eventBody}>
            <div style={styles.eventTitle}>{ev.title || 'Untitled'}</div>
            <div style={styles.eventMeta}>{EVENT_TYPE_LABELS[ev.event_type] || 'Event'}</div>
          </div>
        </button>
      ))}
      {onAddForDay && (
        <button onClick={onAddForDay} style={styles.addForDayBtn}>+ Add event this day</button>
      )}
    </div>
  );
}

function EventDetail({ event }) {
  const accent = EVENT_TYPE_COLORS[event.event_type] || '#5b8fc7';
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
    background: colors.bg,
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
  fab: {
    position: 'fixed', right: 18, bottom: 86,
    width: 56, height: 56, borderRadius: '50%',
    background: colors.accent, color: colors.white, border: 'none',
    fontSize: 30, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 8px 22px rgba(91, 143, 199,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 50,
  },
  addForDayBtn: {
    marginTop: 6, padding: '10px 14px',
    background: colors.accentA12,
    border: '1px dashed rgba(91, 143, 199,0.35)',
    color: colors.accentFg,
    borderRadius: mobileTokens.radius.md,
    fontSize: mobileTokens.font.sm, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
};

const createStyles = {
  root: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md },
  field: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 },
  fieldLabel: {
    fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600,
  },
  input: {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.sm,
    padding: '10px 12px', color: '#fff', fontSize: mobileTokens.font.md,
    fontFamily: 'inherit', outline: 'none',
  },
  row: { display: 'flex', gap: mobileTokens.space.sm },
  toggleRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: mobileTokens.font.md, color: '#e2e8f0',
  },
  error: {
    padding: 10, background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)',
    color: '#f87171', borderRadius: mobileTokens.radius.sm,
    fontSize: mobileTokens.font.sm,
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  cancelBtn: {
    padding: '10px 16px', background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)',
    borderRadius: mobileTokens.radius.sm,
    fontSize: mobileTokens.font.md, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  saveBtn: {
    padding: '10px 18px', background: colors.accent,
    border: 'none', color: '#fff',
    borderRadius: mobileTokens.radius.sm,
    fontSize: mobileTokens.font.md, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
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
    background: colors.accentA08,
    border: '1px solid rgba(91, 143, 199,0.2)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.6)',
    fontSize: mobileTokens.font.sm,
    textAlign: 'center',
  },
};
