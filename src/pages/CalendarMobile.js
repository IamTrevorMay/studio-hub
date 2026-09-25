import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import usePersistedTab from '../hooks/usePersistedTab';
import BottomSheet from '../components/mobile/BottomSheet';
import { mobileTokens } from '../utils/mobileTokens';
import { expandRecurringEvents } from '../lib/recurrence';
import { colors } from '../lib/styleTokens';
import {
  PT_TZ, toPTDateKey, formatPTTime, toPTTimeString, ptToDate,
  ptDayAnchor, ptToday, anchorKey, addDays, addMonths, daysBetween, formatAnchor,
} from '../lib/ptTime';

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

// Every date below is a PT day anchor (see lib/ptTime). The calendar is a
// shared studio artifact, so a viewer's device timezone must not move an event
// to a different day or shift which day reads as "today".

function fmtDayHeader(anchor) {
  const diff = daysBetween(ptToday(), anchor);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatAnchor(anchor, { weekday: 'long', month: 'short', day: 'numeric' });
}

function fmtTime(iso, allDay) {
  if (allDay) return 'All day';
  return formatPTTime(new Date(iso));
}

const VIDEO_EVENT_TYPES = ['video_post', 'tmbb_video'];

export default function CalendarMobile() {
  const { profile, isAdmin } = useAuth();
  const confirm = useConfirm();
  const [view, setView] = usePersistedTab('calendar-view-mobile', 'agenda', ['agenda', 'month']); // 'agenda' | 'month'
  const [events, setEvents] = useState([]);
  const [hubUsers, setHubUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const [monthCursor, setMonthCursor] = useState(() => ptDayAnchor(`${toPTDateKey(new Date()).slice(0, 7)}-01`));
  const [selectedDay, setSelectedDay] = useState(null); // for month view tap

  // Expand recurring events into concrete occurrences over a range covering both
  // the agenda horizon and the visible month grid. Without this, recurring events
  // only showed on their original start_date.
  const expandedEvents = useMemo(() => {
    const rangeStart = addDays(ptToday(), -7);
    const monthEnd = addDays(addMonths(monthCursor, 1), 6);
    const horizonEnd = addDays(ptToday(), HORIZON_DAYS + 1);
    const rangeEnd = monthEnd > horizonEnd ? monthEnd : horizonEnd;
    return expandRecurringEvents(events, rangeStart, rangeEnd);
  }, [events, monthCursor]);

  // Event create / edit (mobile-friendly subset of the desktop modal — title/
  // type/date/time/all-day/location/notes/team members). Recurrence rules and
  // the video-meeting toggle are desktop-only: an edit here preserves whatever
  // the row already has for those. Writes mirror Calendar.js handleSaveEvent.
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(null);
  // null = creating; otherwise { id } for a series/plain edit, or
  // { id: null, detachFrom: { parentId, dateKey } } for "this event only".
  const [editTarget, setEditTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  // Recurring events ask "this one or the whole series?" before edit/delete.
  const [recurrencePrompt, setRecurrencePrompt] = useState(null); // { action: 'edit'|'delete', event }

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const start = addDays(ptToday(), -7);
      const end = addDays(start, HORIZON_DAYS + 30);
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

  // Team-member picker options + name lookup for guest ids. Dual-use (picker +
  // historical attribution), so deactivated rows are kept and filtered at render.
  const fetchHubUsers = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, title, deactivated_at')
      .order('full_name', { ascending: true });
    if (error) console.error('Calendar users fetch failed:', error);
    else setHubUsers(data || []);
  }, []);

  useEffect(() => { fetchEvents(); fetchHubUsers(); }, [fetchEvents, fetchHubUsers]);

  function getUserName(userId) {
    const u = hubUsers.find((x) => x.id === userId);
    return u?.full_name || 'Unknown';
  }

  async function syncToGoogleCalendar(action, eventId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-calendar-sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action, event_id: eventId }),
      });
    } catch (err) {
      console.error('Google Calendar sync error:', err);
    }
  }

  // Reverse sync (mirrors desktop): a video event linked to a project writes
  // its new Post Date back onto that project.
  async function syncVideoEventToProject(eventId, eventType, newStart) {
    if (!VIDEO_EVENT_TYPES.includes(eventType)) return;
    const { data: proj } = await supabase
      .from('projects')
      .select('id, deadline, post_time')
      .eq('calendar_event_id', eventId)
      .maybeSingle();
    if (!proj) return;
    const deadline = toPTDateKey(newStart);
    const postTime = toPTTimeString(newStart);
    if (proj.deadline === deadline && proj.post_time === postTime) return;
    await supabase.from('projects').update({ deadline, post_time: postTime }).eq('id', proj.id);
  }

  function closeForm() {
    setShowForm(false);
    setForm(null);
    setEditTarget(null);
    setFormError(null);
  }

  function openCreate(day) {
    // `day` is a PT day anchor from the month grid — it carries no meaningful
    // clock time, so those default to 9–10am PT. The + button passes nothing
    // and starts from the current PT time instead.
    const isAnchor = !!day;
    const base = day || new Date();
    const next = new Date(base.getTime() + 60 * 60 * 1000);
    const startTime = isAnchor ? '09:00' : hm(base);
    const endTime = isAnchor ? '10:00' : hm(next);
    setFormError(null);
    setEditTarget(null);
    setForm({
      title: '',
      event_type: 'meeting',
      start_date: ymd(base),
      start_time: startTime,
      end_date: isAnchor ? ymd(base) : ymd(next),
      end_time: endTime,
      all_day: false,
      location: '',
      description: '',
      guests: [],
    });
    setShowForm(true);
  }

  function formFromEvent(ev) {
    const startD = new Date(ev.start_date);
    const endD = new Date(ev.end_date || ev.start_date);
    return {
      title: ev.title || '',
      event_type: ev.event_type || 'meeting',
      start_date: toPTDateKey(startD),
      start_time: toPTTimeString(startD),
      end_date: toPTDateKey(endD),
      end_time: toPTTimeString(endD),
      all_day: ev.all_day || false,
      location: ev.location || '',
      description: ev.description || '',
      guests: Array.isArray(ev.guests) ? ev.guests : [],
    };
  }

  function isRecurring(ev) {
    return !!(ev?.recurrence_rule && ev.recurrence_rule.type !== 'none');
  }

  function parentOf(ev) {
    const parentId = ev._parentId || ev.id;
    return events.find((e) => e.id === parentId) || ev;
  }

  // Edit the whole series (or a plain, non-recurring event).
  function openEditSeries(ev) {
    const parent = parentOf(ev);
    setFormError(null);
    setEditTarget({ id: parent.id });
    setForm(formFromEvent(parent));
    setSelectedEvent(null);
    setRecurrencePrompt(null);
    setShowForm(true);
  }

  // Edit one occurrence: it becomes a standalone event on save, and that date
  // is excluded from the parent series (same shape as desktop, but the
  // exclusion is written on save rather than on open, so Cancel is a no-op).
  function openEditOccurrence(ev) {
    const parent = parentOf(ev);
    setFormError(null);
    setEditTarget({ id: null, detachFrom: { parentId: parent.id, dateKey: toPTDateKey(new Date(ev.start_date)) } });
    setForm(formFromEvent({ ...parent, start_date: ev.start_date, end_date: ev.end_date }));
    setSelectedEvent(null);
    setRecurrencePrompt(null);
    setShowForm(true);
  }

  function requestEdit(ev) {
    if (isRecurring(ev)) { setSelectedEvent(null); setTimeout(() => setRecurrencePrompt({ action: 'edit', event: ev }), 220); return; }
    openEditSeries(ev);
  }

  function requestDelete(ev) {
    if (isRecurring(ev)) { setSelectedEvent(null); setTimeout(() => setRecurrencePrompt({ action: 'delete', event: ev }), 220); return; }
    deleteEvent(ev._parentId || ev.id);
  }

  async function excludeOccurrence(parentId, dateKey) {
    const parent = events.find((e) => e.id === parentId);
    const rule = { ...(parent?.recurrence_rule || {}) };
    rule.excludedDates = [...new Set([...(rule.excludedDates || []), dateKey])];
    const { error } = await supabase.from('calendar_events').update({ recurrence_rule: rule }).eq('id', parentId);
    if (error) throw error;
    // The exclusion goes to Google as an EXDATE on the series.
    syncToGoogleCalendar('update', parentId);
  }

  async function deleteOccurrence(ev) {
    setRecurrencePrompt(null);
    if (!(await confirm('Remove this occurrence from the series?'))) return;
    try {
      await excludeOccurrence(ev._parentId || ev.id, toPTDateKey(new Date(ev.start_date)));
      setSelectedEvent(null);
      fetchEvents();
    } catch (err) {
      console.error('Error excluding occurrence:', err);
      alert(`Could not remove occurrence: ${err.message}`);
    }
  }

  async function deleteEvent(eventId) {
    setRecurrencePrompt(null);
    if (!(await confirm('Delete this event?'))) return;
    try {
      // A video event linked to a project clears that project's Post Date too
      // (fully two-way, mirrors desktop). Capture the link before the row goes.
      const delEvent = events.find((e) => e.id === eventId);
      let linkedProjectId = null;
      if (delEvent && VIDEO_EVENT_TYPES.includes(delEvent.event_type)) {
        const { data: proj } = await supabase.from('projects').select('id').eq('calendar_event_id', eventId).maybeSingle();
        linkedProjectId = proj?.id || null;
      }
      await syncToGoogleCalendar('delete', eventId);
      const { error } = await supabase.from('calendar_events').delete().eq('id', eventId);
      if (error) throw error;
      if (linkedProjectId) {
        await supabase.from('projects').update({ deadline: null, post_time: null, calendar_event_id: null }).eq('id', linkedProjectId);
      }
      setSelectedEvent(null);
      fetchEvents();
    } catch (err) {
      console.error('Error deleting event:', err);
      alert(`Could not delete event: ${err.message}`);
    }
  }

  async function handleSave() {
    if (!form) return;
    const f = form;
    if (!f.title.trim() || !f.start_date) { setFormError('Title + start date required.'); return; }
    if (!profile?.id) { setFormError('Not signed in.'); return; }
    setSaving(true); setFormError(null);
    try {
      // Wall-clock in the form is Pacific, matching desktop's handleSaveEvent.
      const startDate = f.all_day
        ? ptToDate(f.start_date, '00:00')
        : ptToDate(f.start_date, f.start_time || '09:00');
      const endDateStr = f.end_date || f.start_date;
      const endDate = f.all_day
        ? ptToDate(endDateStr, '23:59')
        : ptToDate(endDateStr, f.end_time || '10:00');
      const payload = {
        title: f.title.trim(),
        description: f.description.trim(),
        event_type: f.event_type,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        all_day: f.all_day,
        location: f.location.trim(),
        guests: f.guests || [],
      };

      if (editTarget?.id) {
        // recurrence_rule and is_meeting are deliberately not in the payload:
        // the mobile form doesn't expose them, so the row keeps what it has.
        const { error } = await supabase.from('calendar_events').update(payload).eq('id', editTarget.id);
        if (error) throw error;
        await syncVideoEventToProject(editTarget.id, payload.event_type, startDate);
        syncToGoogleCalendar('update', editTarget.id);
      } else {
        // A detached one-off doesn't inherit meeting-ness — the series keeps
        // its room; a new event never has one from mobile.
        const { data: inserted, error } = await supabase
          .from('calendar_events')
          .insert({ ...payload, is_meeting: false, recurrence_rule: null, created_by: profile.id })
          .select('id')
          .single();
        if (error) throw error;
        if (editTarget?.detachFrom) {
          await excludeOccurrence(editTarget.detachFrom.parentId, editTarget.detachFrom.dateKey);
        }
        syncToGoogleCalendar('create', inserted.id);
      }
      closeForm();
      fetchEvents();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const canDelete = (ev) => !!ev && (ev.created_by === profile?.id || isAdmin);
  const isEditing = !!editTarget;

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
        {selectedEvent && (
          <EventDetail
            event={selectedEvent}
            getUserName={getUserName}
            onEdit={() => requestEdit(selectedEvent)}
            onDelete={canDelete(selectedEvent) ? () => requestDelete(selectedEvent) : null}
          />
        )}
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
        open={showForm}
        onClose={closeForm}
        title={isEditing ? 'Edit event' : 'New event'}
        maxHeight="90vh"
      >
        {form && (
          <EventForm
            form={form}
            mode={isEditing ? 'edit' : 'create'}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            onSave={handleSave}
            onCancel={closeForm}
            saving={saving}
            error={formError}
            members={hubUsers.filter((u) => u.id !== profile?.id && !u.deactivated_at)}
            getUserName={getUserName}
          />
        )}
      </BottomSheet>

      <BottomSheet
        open={!!recurrencePrompt}
        onClose={() => setRecurrencePrompt(null)}
        title={recurrencePrompt?.action === 'delete' ? 'Delete recurring event' : 'Edit recurring event'}
      >
        {recurrencePrompt && (
          <div style={createStyles.root}>
            <p style={createStyles.promptText}>
              This is a repeating event. What would you like to {recurrencePrompt.action}?
            </p>
            <button
              style={createStyles.promptBtn}
              onClick={() => {
                const ev = recurrencePrompt.event;
                if (recurrencePrompt.action === 'delete') deleteOccurrence(ev);
                else openEditOccurrence(ev);
              }}
            >
              This event only
            </button>
            <button
              style={createStyles.promptBtn}
              onClick={() => {
                const ev = recurrencePrompt.event;
                if (recurrencePrompt.action === 'delete') deleteEvent(ev._parentId || ev.id);
                else openEditSeries(ev);
              }}
            >
              All events in this series
            </button>
            <button style={createStyles.cancelBtn} onClick={() => setRecurrencePrompt(null)}>Cancel</button>
          </div>
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
  return toPTDateKey(d);
}
function hm(d) {
  return toPTTimeString(d);
}

function EventForm({ form, mode, onChange, onSave, onCancel, saving, error, members, getUserName }) {
  const [showPicker, setShowPicker] = useState(false);
  const guests = form.guests || [];
  const disabled = saving || !form.title.trim() || !form.start_date;

  function toggleGuest(id) {
    onChange({ guests: guests.includes(id) ? guests.filter((g) => g !== id) : [...guests, id] });
  }

  return (
    <div style={createStyles.root}>
      <Field label="Title">
        <input
          autoFocus={mode === 'create'}
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

      {/* Team members — same `guests` id array desktop writes. */}
      <div style={createStyles.field}>
        <span style={createStyles.fieldLabel}>Team members</span>
        <div style={createStyles.guestBox} onClick={() => setShowPicker((v) => !v)} role="button">
          {guests.length === 0 ? (
            <span style={createStyles.guestPlaceholder}>Invite team members…</span>
          ) : (
            <div style={createStyles.guestChips}>
              {guests.map((gId) => (
                <span key={gId} style={createStyles.guestChip}>
                  {getUserName(gId)}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleGuest(gId); }}
                    style={createStyles.guestChipRemove}
                    aria-label={`Remove ${getUserName(gId)}`}
                  >{'✕'}</button>
                </span>
              ))}
            </div>
          )}
          <span style={createStyles.guestCaret}>{showPicker ? '▴' : '▾'}</span>
        </div>
        {showPicker && (
          <div style={createStyles.guestList}>
            {members.length === 0 ? (
              <div style={createStyles.guestEmpty}>No one to invite.</div>
            ) : members.map((u) => {
              const on = guests.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleGuest(u.id)}
                  style={{ ...createStyles.guestRow, background: on ? colors.accentA12 : 'transparent' }}
                >
                  <span style={createStyles.guestAvatar}>{u.full_name?.charAt(0)?.toUpperCase() || '?'}</span>
                  <span style={createStyles.guestRowBody}>
                    <span style={createStyles.guestRowName}>{u.full_name}</span>
                    {u.title && <span style={createStyles.guestRowTitle}>{u.title}</span>}
                  </span>
                  {on && <span style={{ color: colors.accentFg, fontSize: 14 }}>{'✓'}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && <div style={createStyles.error}>{error}</div>}

      <div style={createStyles.actions}>
        <button onClick={onCancel} style={createStyles.cancelBtn}>Cancel</button>
        <button
          onClick={onSave}
          disabled={disabled}
          style={{ ...createStyles.saveBtn, opacity: disabled ? 0.5 : 1 }}
        >
          {saving ? 'Saving…' : mode === 'edit' ? 'Save' : 'Create'}
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
  const todayKey = anchorKey(ptToday());
  const horizonKey = anchorKey(addDays(ptToday(), HORIZON_DAYS));

  const buckets = new Map();
  for (const ev of events) {
    if (!ev.start_date) continue;
    // Bucket by the event's PT day, not the device's.
    const key = toPTDateKey(new Date(ev.start_date));
    if (key < todayKey) continue;
    if (key > horizonKey) continue;
    if (!buckets.has(key)) buckets.set(key, { date: ptDayAnchor(key), events: [] });
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
  const key = anchorKey(day);
  return events.filter((ev) => (
    ev.start_date && toPTDateKey(new Date(ev.start_date)) === key
  )).sort((a, b) => {
    if (a.all_day && !b.all_day) return -1;
    if (!a.all_day && b.all_day) return 1;
    return new Date(a.start_date) - new Date(b.start_date);
  });
}

function MonthView({ events, monthCursor, setMonthCursor, onSelectDay }) {
  const cells = useMemo(() => buildMonthCells(monthCursor, events), [monthCursor, events]);
  const monthLabel = formatAnchor(monthCursor, { month: 'long', year: 'numeric' });

  function shift(delta) {
    setMonthCursor(addMonths(monthCursor, delta));
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
          const inMonth = cell.date.getUTCMonth() === monthCursor.getUTCMonth();
          const isToday = anchorKey(cell.date) === anchorKey(ptToday());
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
              <span>{cell.date.getUTCDate()}</span>
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
  // cursor is the anchor for the 1st of the month; anchors carry UTC parts.
  const firstOfMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1, 12));
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getUTCDay());

  const counts = new Map();
  for (const ev of events) {
    if (!ev.start_date) continue;
    const k = toPTDateKey(new Date(ev.start_date));
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    cells.push({ date: d, count: counts.get(anchorKey(d)) || 0 });
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

function EventDetail({ event, getUserName, onEdit, onDelete }) {
  const accent = EVENT_TYPE_COLORS[event.event_type] || '#5b8fc7';
  const start = event.start_date && new Date(event.start_date);
  const end = event.end_date && new Date(event.end_date);
  const guests = Array.isArray(event.guests) ? event.guests : [];
  const repeating = event.recurrence_rule && event.recurrence_rule.type !== 'none';
  return (
    <div style={detailStyles.root}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ ...detailStyles.typePill, background: `${accent}20`, color: accent, borderColor: `${accent}50` }}>
          {EVENT_TYPE_LABELS[event.event_type] || 'Event'}
        </div>
        {repeating && (
          <div style={{ ...detailStyles.typePill, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', borderColor: 'rgba(255,255,255,0.12)' }}>
            Repeats
          </div>
        )}
      </div>
      <h3 style={detailStyles.title}>{event.title || 'Untitled'}</h3>
      <DetailRow label="When" value={
        event.all_day
          ? `${start.toLocaleDateString('en-US', { timeZone: PT_TZ, weekday: 'long', month: 'short', day: 'numeric' })} (all day)`
          : `${start.toLocaleString('en-US', { timeZone: PT_TZ, weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${end ? ` – ${formatPTTime(end)}` : ''} PT`
      } />
      {event.location && <DetailRow label="Location" value={event.location} />}
      {event.description && <DetailRow label="Notes" value={event.description} />}
      {guests.length > 0 && (
        <div style={detailStyles.row}>
          <div style={detailStyles.label}>Team members</div>
          <div style={detailStyles.guestChips}>
            {guests.map((gId) => <span key={gId} style={detailStyles.guestChip}>{getUserName(gId)}</span>)}
          </div>
        </div>
      )}
      {event.creator?.full_name && <DetailRow label="Created by" value={event.creator.full_name} />}
      <div style={detailStyles.actions}>
        <button onClick={onEdit} style={detailStyles.editBtn}>Edit</button>
        {onDelete && <button onClick={onDelete} style={detailStyles.deleteBtn}>Delete</button>}
      </div>
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
  guestBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    minHeight: mobileTokens.tap,
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.sm,
    padding: '8px 12px', cursor: 'pointer',
  },
  guestPlaceholder: { flex: 1, color: 'rgba(255,255,255,0.3)', fontSize: mobileTokens.font.md },
  guestCaret: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  guestChips: { flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6 },
  guestChip: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 8px 4px 10px',
    background: colors.accentA12,
    border: `1px solid ${colors.accentBorder}`,
    borderRadius: mobileTokens.radius.pill,
    color: colors.accentFg, fontSize: mobileTokens.font.sm, fontWeight: 600,
  },
  guestChipRemove: {
    background: 'transparent', border: 'none', color: 'inherit',
    fontSize: 11, cursor: 'pointer', padding: '2px 4px', fontFamily: 'inherit', lineHeight: 1,
  },
  guestList: {
    marginTop: 6,
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.sm,
    maxHeight: 220, overflowY: 'auto',
    display: 'flex', flexDirection: 'column',
  },
  guestEmpty: { padding: 12, color: 'rgba(255,255,255,0.4)', fontSize: mobileTokens.font.sm },
  guestRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', minHeight: mobileTokens.tap,
    padding: '8px 12px', border: 'none', textAlign: 'left',
    color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  guestAvatar: {
    width: 28, height: 28, borderRadius: '50%',
    background: colors.accentSoft, color: colors.accentFg,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, flexShrink: 0,
  },
  guestRowBody: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  guestRowName: { fontSize: mobileTokens.font.md, fontWeight: 500 },
  guestRowTitle: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.4)' },
  promptText: { margin: 0, fontSize: mobileTokens.font.md, color: 'rgba(255,255,255,0.6)', lineHeight: 1.45 },
  promptBtn: {
    minHeight: mobileTokens.tap, padding: '10px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)', color: '#fff',
    borderRadius: mobileTokens.radius.sm,
    fontSize: mobileTokens.font.md, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
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
  guestChips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  guestChip: {
    padding: '4px 10px',
    background: colors.accentA12,
    border: `1px solid ${colors.accentBorder}`,
    borderRadius: mobileTokens.radius.pill,
    color: colors.accentFg, fontSize: mobileTokens.font.sm, fontWeight: 600,
  },
  actions: { display: 'flex', gap: 8, marginTop: mobileTokens.space.sm },
  editBtn: {
    flex: 1, minHeight: mobileTokens.tap,
    background: colors.accent, border: 'none', color: '#fff',
    borderRadius: mobileTokens.radius.sm,
    fontSize: mobileTokens.font.md, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  deleteBtn: {
    minHeight: mobileTokens.tap, padding: '0 16px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)', color: '#f87171',
    borderRadius: mobileTokens.radius.sm,
    fontSize: mobileTokens.font.md, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
