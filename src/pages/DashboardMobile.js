import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import SprintBoardMobile from '../components/SprintBoardMobile';
import MyTasks from './MyTasks';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';

const EVENT_TYPE_COLORS = {
  deadline: '#ef4444', meeting: '#3b82f6', live_recording: '#22c55e',
  filming: '#f59e0b', video_post: '#a855f7', unavailable: '#6b7280', sponsor: '#10b981',
};
const EVENT_TYPE_LABELS = {
  deadline: 'Deadline', meeting: 'Meeting', live_recording: 'Live',
  filming: 'Filming', video_post: 'Video Post', unavailable: 'Out', sponsor: 'Sponsor',
};

const CHECKIN_OPTIONS = [
  { rating: 1, label: 'Red', color: '#ef4444' },
  { rating: 2, label: 'Orange', color: '#f97316' },
  { rating: 3, label: 'Yellow', color: '#eab308' },
  { rating: 4, label: 'Light Green', color: '#84cc16' },
  { rating: 5, label: 'Green', color: '#22c55e' },
];

function todayDateString() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function greet() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const TABS = [
  { key: 'tasks', label: 'Sprint' },
  { key: 'mytasks', label: 'My Tasks' },
  { key: 'todo', label: 'To-do' },
  { key: 'today', label: 'Today' },
  { key: 'checkin', label: 'Check-in' },
];

export default function DashboardMobile({ onNavigate }) {
  const { profile, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('tasks');

  return (
    <div style={styles.root}>
      <header style={styles.greeting}>
        <div style={styles.avatar}>{profile?.full_name?.charAt(0)?.toUpperCase() || '?'}</div>
        <div>
          <div style={styles.greetSmall}>{greet()},</div>
          <div style={styles.greetName}>{profile?.full_name?.split(' ')[0] || 'there'}</div>
        </div>
      </header>

      <div style={styles.tabBar} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              ...styles.tabBtn,
              background: activeTab === t.key ? 'rgba(99,102,241,0.16)' : 'transparent',
              color: activeTab === t.key ? '#a5b4fc' : 'rgba(255,255,255,0.6)',
              fontWeight: activeTab === t.key ? 600 : 500,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'tasks' && <SprintBoardMobile profile={profile} />}
      {activeTab === 'mytasks' && <MyTasks onNavigate={onNavigate} embedded />}
      {activeTab === 'todo' && <TodoTab profile={profile} />}
      {activeTab === 'today' && <TodayTab profile={profile} isAdmin={isAdmin} onNavigate={onNavigate} />}
      {activeTab === 'checkin' && <CheckinTab profile={profile} />}
    </div>
  );
}

// ─── Today tab ──────────────────────────────────────────────────────────────
function TodayTab({ profile, isAdmin, onNavigate }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const todayStr = todayDateString();

  const fetchEvents = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      if (isAdmin) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const res = await fetch(
            `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-calendar-fetch`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
                apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({ date: todayStr }),
            },
          );
          const result = await res.json();
          setEvents(result.events || []);
        } else { setEvents([]); }
      } else {
        const dayStart = new Date(todayStr + 'T00:00:00').toISOString();
        const dayEnd = new Date(todayStr + 'T23:59:59').toISOString();
        const { data } = await supabase
          .from('calendar_events')
          .select('*, creator:profiles!created_by(id, full_name)')
          .lte('start_date', dayEnd)
          .gte('end_date', dayStart)
          .order('all_day', { ascending: false })
          .order('start_date', { ascending: true });
        setEvents(data || []);
      }
    } catch (err) {
      console.error('Today events fetch failed:', err);
      setEvents([]);
    } finally { setLoading(false); }
  }, [profile?.id, todayStr, isAdmin]);

  useEffect(() => { if (profile?.id) fetchEvents(); }, [profile?.id, fetchEvents]);

  if (loading) return <p style={styles.empty}>Loading…</p>;
  if (events.length === 0) {
    return (
      <div style={styles.emptyCard}>
        <p style={styles.emptyTitle}>Nothing scheduled today</p>
        <p style={styles.emptyHint}>Open your calendar to see what's coming up.</p>
        <button onClick={() => onNavigate && onNavigate('calendar')} style={styles.primaryBtn}>Open calendar</button>
      </div>
    );
  }
  return (
    <div style={styles.eventList}>
      {events.map((ev) => <EventRow key={ev.id} event={ev} />)}
    </div>
  );
}

function EventRow({ event }) {
  const accent = EVENT_TYPE_COLORS[event.event_type] || '#6366f1';
  const label = EVENT_TYPE_LABELS[event.event_type] || 'Event';
  const time = formatEventTime(event);
  return (
    <div style={{ ...styles.eventRow, borderLeft: `3px solid ${accent}` }}>
      <div style={styles.eventTime}>{time}</div>
      <div style={styles.eventBody}>
        <div style={styles.eventTitle}>{event.title || event.summary || 'Untitled'}</div>
        <div style={styles.eventType}>{label}</div>
      </div>
    </div>
  );
}

function formatEventTime(event) {
  if (event.all_day) return 'All day';
  const start = event.start_date || event.start?.dateTime;
  if (!start) return '';
  const d = new Date(start);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─── To-do tab ──────────────────────────────────────────────────────────────
function TodoTab({ profile }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');

  const fetchItems = useCallback(async () => {
    if (!profile?.id) return;
    try {
      // Mirror desktop: drop previously-checked items on visit
      await supabase.from('dashboard_todos').delete().eq('user_id', profile.id).eq('checked', true);
      const { data } = await supabase
        .from('dashboard_todos')
        .select('*')
        .eq('user_id', profile.id)
        .order('position', { ascending: true });
      setItems(data || []);
    } catch (err) {
      console.error('Todo fetch failed:', err);
    } finally { setLoading(false); }
  }, [profile?.id]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  async function addItem(e) {
    e.preventDefault();
    if (!text.trim() || !profile?.id) return;
    const content = text.trim();
    setText('');
    const nextPos = items.length > 0 ? Math.max(...items.map((i) => i.position || 0)) + 1 : 1;
    const optimistic = { id: `tmp-${Date.now()}`, user_id: profile.id, text: content, checked: false, position: nextPos };
    setItems((prev) => [...prev, optimistic]);
    try {
      const { data, error } = await supabase
        .from('dashboard_todos')
        .insert({ user_id: profile.id, text: content, checked: false, position: nextPos })
        .select()
        .single();
      if (error) throw error;
      setItems((prev) => prev.map((i) => (i.id === optimistic.id ? data : i)));
    } catch (err) {
      console.error('Add todo failed:', err);
      setItems((prev) => prev.filter((i) => i.id !== optimistic.id));
      setText(content);
    }
  }

  async function toggleChecked(item) {
    const next = !item.checked;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: next } : i)));
    try {
      const { error } = await supabase.from('dashboard_todos').update({ checked: next }).eq('id', item.id);
      if (error) throw error;
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !next } : i)));
    }
  }

  async function removeItem(item) {
    const prev = items;
    setItems((p) => p.filter((i) => i.id !== item.id));
    try {
      const { error } = await supabase.from('dashboard_todos').delete().eq('id', item.id);
      if (error) throw error;
    } catch (err) {
      setItems(prev);
    }
  }

  async function commitEdit(item) {
    const trimmed = editingText.trim();
    if (!trimmed || trimmed === item.text) {
      setEditingId(null);
      setEditingText('');
      return;
    }
    setItems((p) => p.map((i) => (i.id === item.id ? { ...i, text: trimmed } : i)));
    setEditingId(null);
    setEditingText('');
    try {
      const { error } = await supabase.from('dashboard_todos').update({ text: trimmed }).eq('id', item.id);
      if (error) throw error;
    } catch (err) {
      console.error('Edit todo failed:', err);
    }
  }

  if (loading) return <p style={styles.empty}>Loading…</p>;

  return (
    <div style={styles.todoRoot}>
      <ul style={styles.todoList}>
        {items.length === 0 && (
          <li style={styles.todoEmpty}>Nothing on your dashboard list. Add a quick reminder below.</li>
        )}
        {items.map((item) => (
          <li key={item.id} style={styles.todoRow}>
            <button
              type="button"
              onClick={() => toggleChecked(item)}
              style={{ ...styles.checkbox, ...(item.checked ? styles.checkboxDone : {}) }}
              aria-label={item.checked ? 'Uncheck' : 'Check'}
            >
              {item.checked && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M3 7l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            {editingId === item.id ? (
              <input
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={() => commitEdit(item)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(item); if (e.key === 'Escape') { setEditingId(null); setEditingText(''); } }}
                autoFocus
                style={styles.todoEditInput}
              />
            ) : (
              <button
                type="button"
                onClick={() => { setEditingId(item.id); setEditingText(item.text); }}
                style={{
                  ...styles.todoText,
                  textDecoration: item.checked ? 'line-through' : 'none',
                  color: item.checked ? 'rgba(255,255,255,0.4)' : '#e2e8f0',
                }}
              >
                {item.text}
              </button>
            )}
            <button
              type="button"
              onClick={() => removeItem(item)}
              style={styles.todoRemoveBtn}
              aria-label="Remove"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={addItem} style={{ ...styles.todoAddBar, paddingBottom: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeBottom})` }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Quick reminder…"
          style={styles.todoAddInput}
        />
        <button
          type="submit"
          disabled={!text.trim()}
          style={{ ...styles.todoAddBtn, opacity: text.trim() ? 1 : 0.4 }}
          aria-label="Add reminder"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}

// ─── Check-in tab ──────────────────────────────────────────────────────────
function CheckinTab({ profile }) {
  const [history, setHistory] = useState([]);
  const [todayCheckin, setTodayCheckin] = useState(null);
  const [rating, setRating] = useState(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('week'); // 'week' | 'month'
  const todayStr = todayDateString();

  const fetchCheckins = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const startStr = start.toISOString().split('T')[0];
      const { data } = await supabase
        .from('daily_checkins')
        .select('*')
        .eq('user_id', profile.id)
        .gte('date', startStr)
        .order('date', { ascending: false });
      const all = data || [];
      const today = all.find((r) => r.date === todayStr) || null;
      setTodayCheckin(today);
      if (today) {
        setRating(today.rating);
        setNote(today.note || '');
      } else {
        setRating(null);
        setNote('');
      }
      setHistory(all);
    } catch (err) {
      console.error('Checkin fetch failed:', err);
    } finally { setLoading(false); }
  }, [profile?.id, todayStr]);

  useEffect(() => { fetchCheckins(); }, [fetchCheckins]);

  async function save() {
    if (!rating || !profile?.id || saving) return;
    setSaving(true);
    try {
      if (todayCheckin) {
        const { data, error } = await supabase
          .from('daily_checkins')
          .update({ rating, note: note || null })
          .eq('id', todayCheckin.id)
          .select()
          .single();
        if (error) throw error;
        setTodayCheckin(data);
        setHistory((prev) => prev.map((r) => (r.id === data.id ? data : r)));
      } else {
        const { data, error } = await supabase
          .from('daily_checkins')
          .insert({ user_id: profile.id, date: todayStr, rating, note: note || null })
          .select()
          .single();
        if (error) throw error;
        setTodayCheckin(data);
        setHistory((prev) => [data, ...prev]);
      }
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally { setSaving(false); }
  }

  if (loading) return <p style={styles.empty}>Loading…</p>;

  // Build the heatmap rows
  const days = view === 'week' ? 7 : 30;
  const grid = buildCheckinGrid(history, days);

  return (
    <div style={styles.checkinRoot}>
      <div style={styles.checkinHeader}>
        <span style={styles.checkinHeaderLabel}>How's today going?</span>
        {todayCheckin && <span style={styles.checkinSavedTag}>Saved</span>}
      </div>

      <div style={styles.ratingRow}>
        {CHECKIN_OPTIONS.map((opt) => {
          const active = rating === opt.rating;
          return (
            <button
              key={opt.rating}
              onClick={() => setRating(opt.rating)}
              style={{
                ...styles.ratingDot,
                background: active ? opt.color : `${opt.color}33`,
                borderColor: active ? opt.color : 'rgba(255,255,255,0.08)',
                transform: active ? 'scale(1.05)' : 'scale(1)',
              }}
              aria-label={`Rate ${opt.label}`}
            >
              <span style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#fff',
                opacity: active ? 1 : 0.45,
              }}>
                {opt.rating}
              </span>
            </button>
          );
        })}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Optional note about today…"
        style={styles.noteInput}
      />

      <button
        onClick={save}
        disabled={!rating || saving}
        style={{ ...styles.saveCheckinBtn, opacity: !rating || saving ? 0.5 : 1 }}
      >
        {saving ? 'Saving…' : todayCheckin ? 'Update check-in' : 'Save check-in'}
      </button>

      <div style={styles.heatmapHeader}>
        <span style={styles.heatmapLabel}>Recent</span>
        <div style={styles.viewToggle}>
          <ViewBtn active={view === 'week'} onClick={() => setView('week')}>7 days</ViewBtn>
          <ViewBtn active={view === 'month'} onClick={() => setView('month')}>30 days</ViewBtn>
        </div>
      </div>

      <div style={styles.heatmap}>
        {grid.map((cell) => (
          <div
            key={cell.date}
            title={`${cell.date}${cell.rating ? ` · ${CHECKIN_OPTIONS.find((o) => o.rating === cell.rating)?.label}` : ' · no entry'}`}
            style={{
              ...styles.heatmapCell,
              background: cell.rating
                ? CHECKIN_OPTIONS.find((o) => o.rating === cell.rating)?.color
                : 'rgba(255,255,255,0.05)',
            }}
          />
        ))}
      </div>

      {/* Average rating */}
      {(() => {
        const validRatings = grid.filter(c => c.rating !== null).map(c => c.rating);
        if (validRatings.length === 0) {
          return (
            <div style={styles.avgRow}>
              <span style={{ fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.35)' }}>
                No check-ins yet
              </span>
            </div>
          );
        }
        const avg = (validRatings.reduce((a, b) => a + b, 0) / validRatings.length).toFixed(1);
        const avgColor = CHECKIN_OPTIONS[Math.round(avg) - 1]?.color || '#6366f1';
        return (
          <div style={styles.avgRow}>
            <span style={{ ...styles.avgDot, background: avgColor }} />
            <span style={{ fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
              Avg {avg}
            </span>
            <span style={{ fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.35)', marginLeft: 4 }}>
              ({validRatings.length} {validRatings.length === 1 ? 'day' : 'days'})
            </span>
          </div>
        );
      })()}
    </div>
  );
}

function ViewBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...mobileTapButton,
        minHeight: 32,
        padding: '0 10px',
        background: active ? 'rgba(99,102,241,0.16)' : 'transparent',
        color: active ? '#a5b4fc' : 'rgba(255,255,255,0.6)',
        borderRadius: mobileTokens.radius.sm,
        fontSize: mobileTokens.font.xs,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

function buildCheckinGrid(history, days) {
  const byDate = {};
  history.forEach((r) => { byDate[r.date] = r; });
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ date: key, rating: byDate[key]?.rating || null });
  }
  return out;
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100%',
    background: '#0f0f1a',
    color: '#e2e8f0',
  },
  greeting: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.md,
    padding: `${mobileTokens.space.lg}px ${mobileTokens.space.lg}px ${mobileTokens.space.md}px`,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: mobileTokens.radius.md,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    flexShrink: 0,
  },
  greetSmall: { fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.5)' },
  greetName: {
    fontSize: mobileTokens.font.xl,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.3px',
    lineHeight: 1.1,
  },
  tabBar: {
    display: 'flex',
    gap: mobileTokens.space.xs,
    padding: `0 ${mobileTokens.space.md}px ${mobileTokens.space.sm}px`,
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
  },
  tabBtn: {
    flex: '0 0 auto',
    minHeight: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    background: 'transparent',
    fontSize: mobileTokens.font.md,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  empty: {
    padding: mobileTokens.space.xxl,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    margin: 0,
  },
  emptyCard: {
    margin: mobileTokens.space.lg,
    padding: mobileTokens.space.xl,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.lg,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 600,
    color: '#fff',
    margin: 0,
  },
  emptyHint: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.5)',
    margin: `${mobileTokens.space.sm}px 0 ${mobileTokens.space.lg}px`,
  },
  primaryBtn: {
    minHeight: mobileTokens.tap,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.lg}px`,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  eventList: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
    padding: mobileTokens.space.lg,
  },
  eventRow: {
    display: 'flex',
    gap: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    minHeight: mobileTokens.tap,
  },
  eventTime: {
    minWidth: 76,
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.65)',
    fontWeight: 600,
  },
  eventBody: {
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#e2e8f0',
    lineHeight: 1.3,
    wordBreak: 'break-word',
  },
  eventType: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginTop: 2,
  },

  // To-do tab
  todoRoot: { display: 'flex', flexDirection: 'column', minHeight: '100%' },
  todoList: {
    listStyle: 'none', margin: 0, padding: `${mobileTokens.space.md}px ${mobileTokens.space.md}px ${mobileTokens.space.xxxl}px`,
    flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  todoEmpty: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: mobileTokens.font.md,
    textAlign: 'center',
    padding: mobileTokens.space.xxl,
  },
  todoRow: {
    display: 'flex', alignItems: 'center', gap: mobileTokens.space.md,
    padding: mobileTokens.space.md, background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md, minHeight: mobileTokens.tap,
  },
  checkbox: {
    minWidth: 24, width: 24, height: 24, borderRadius: 6,
    border: '1.5px solid rgba(255,255,255,0.3)', background: 'transparent',
    color: 'transparent', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0,
    WebkitTapHighlightColor: 'transparent',
  },
  checkboxDone: { background: '#22c55e', borderColor: '#22c55e', color: '#fff' },
  todoText: {
    flex: 1, fontSize: mobileTokens.font.md, color: '#e2e8f0', lineHeight: 1.4,
    background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit',
    cursor: 'pointer', textAlign: 'left', wordBreak: 'break-word',
  },
  todoEditInput: {
    flex: 1, height: 36, padding: `0 ${mobileTokens.space.sm}px`,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,102,241,0.4)',
    borderRadius: mobileTokens.radius.sm, color: '#fff', fontSize: mobileTokens.font.md,
    outline: 'none', fontFamily: 'inherit',
  },
  todoRemoveBtn: {
    width: 32, height: 32, border: 'none', background: 'transparent',
    color: 'rgba(255,255,255,0.4)', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    fontFamily: 'inherit',
  },
  todoAddBar: {
    position: 'sticky', bottom: 0, display: 'flex', gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.md}px`,
    background: 'rgba(15,15,30,0.96)', backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)', borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  todoAddInput: {
    flex: 1, height: mobileTokens.tap, padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md, color: '#fff', fontSize: mobileTokens.font.base,
    outline: 'none', fontFamily: 'inherit',
  },
  todoAddBtn: {
    minWidth: mobileTokens.tap, height: mobileTokens.tap, border: 'none',
    borderRadius: mobileTokens.radius.md, background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
  },

  // Check-in tab
  checkinRoot: {
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
    display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md,
  },
  checkinHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  checkinHeaderLabel: {
    fontSize: mobileTokens.font.lg, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px',
  },
  checkinSavedTag: {
    fontSize: mobileTokens.font.xs, color: '#86efac', fontWeight: 600,
    padding: '2px 8px', background: 'rgba(34,197,94,0.12)', borderRadius: mobileTokens.radius.pill,
  },
  ratingRow: {
    display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: mobileTokens.space.sm,
  },
  ratingDot: {
    aspectRatio: '1 / 1', minHeight: 56, border: '1.5px solid',
    borderRadius: '50%', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', transition: 'transform 0.15s, background 0.15s',
    fontFamily: 'inherit',
  },
  noteInput: {
    padding: mobileTokens.space.md, background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: mobileTokens.radius.md,
    color: '#fff', fontSize: mobileTokens.font.base, outline: 'none',
    fontFamily: 'inherit', resize: 'vertical', minHeight: 80, lineHeight: 1.45,
  },
  saveCheckinBtn: {
    minHeight: mobileTokens.tap + 4, padding: mobileTokens.space.md,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none',
    borderRadius: mobileTokens.radius.md, color: '#fff',
    fontSize: mobileTokens.font.md, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  heatmapHeader: {
    marginTop: mobileTokens.space.md, display: 'flex',
    justifyContent: 'space-between', alignItems: 'center',
  },
  heatmapLabel: {
    fontSize: mobileTokens.font.sm, fontWeight: 700,
    color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  viewToggle: { display: 'flex', gap: 2, background: 'rgba(255,255,255,0.04)', padding: 2, borderRadius: mobileTokens.radius.sm },
  heatmap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
  },
  heatmapCell: {
    aspectRatio: '1 / 1',
    borderRadius: 4,
  },
  avgRow: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    marginTop: mobileTokens.space.sm,
  },
  avgDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
};
