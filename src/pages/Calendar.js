import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

const STATUSES = ['concept', 'script', 'production', 'edit', 'review', 'published'];
const STATUS_COLORS = {
  concept: '#8b5cf6', script: '#3b82f6', production: '#f59e0b',
  edit: '#f97316', review: '#ec4899', published: '#22c55e',
};
const STATUS_LABELS = {
  concept: 'Concept', script: 'Script', production: 'Production',
  edit: 'Edit', review: 'Review', published: 'Published',
};
const NETWORK_COLORS = {
  youtube: '#FF0000', instagram: '#E1306C', tiktok: '#00F2EA',
  facebook: '#1877F2', twitter: '#1DA1F2', threads: '#999999',
};
const NETWORK_LABELS = {
  youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok',
  facebook: 'Facebook', twitter: 'X / Twitter', threads: 'Threads',
};
const NETWORK_ICONS = {
  youtube: '\u25B6', instagram: '\u25C9', tiktok: '\u266A',
  facebook: 'f', twitter: '\uD835\uDD4F', threads: '@',
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const EVENT_TYPES = ['deadline', 'meeting', 'live_recording', 'filming', 'unavailable'];
const EVENT_TYPE_COLORS = {
  deadline: '#ef4444',
  meeting: '#3b82f6',
  live_recording: '#22c55e',
  filming: '#f59e0b',
  unavailable: '#6b7280',
};
const EVENT_TYPE_LABELS = {
  deadline: 'Deadline',
  meeting: 'Meeting',
  live_recording: 'Live/Recording',
  filming: 'Filming',
  unavailable: 'Unavailable',
};
const EVENT_TYPE_ICONS = {
  deadline: '\u23F0',
  meeting: '\uD83D\uDC65',
  live_recording: '\uD83D\uDD34',
  filming: '\uD83C\uDFAC',
  unavailable: '\uD83D\uDEAB',
};

const EMPTY_EVENT_FORM = {
  title: '',
  description: '',
  event_type: 'meeting',
  start_date: '',
  start_time: '09:00',
  end_date: '',
  end_time: '10:00',
  all_day: false,
  location: '',
  guests: [],
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 60;

function formatHourLabel(h) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

export default function Calendar({ onNavigate }) {
  const { profile, isAdmin } = useAuth();
  const [projects, setProjects] = useState([]);
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [hubUsers, setHubUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('month');
  const [showMetricool, setShowMetricool] = useState(true);
  const [metricoolError, setMetricoolError] = useState(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [activeDropdown, setActiveDropdown] = useState(null);
  const [dropdownComments, setDropdownComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventForm, setEventForm] = useState(EMPTY_EVENT_FORM);
  const [savingEvent, setSavingEvent] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showGuestDropdown, setShowGuestDropdown] = useState(false);
  const [expandedSocialDays, setExpandedSocialDays] = useState({});
  const dropdownRef = useRef(null);
  const modalRef = useRef(null);
  const guestDropdownRef = useRef(null);
  const timeGridRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setActiveDropdown(null);
      }
      if (guestDropdownRef.current && !guestDropdownRef.current.contains(e.target)) {
        setShowGuestDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000);
    Promise.all([fetchProjects(), fetchCalendarEvents(), fetchHubUsers()])
      .finally(() => clearTimeout(timeout));
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    fetchCalendarEvents();
  }, [viewDate]);

  // Scroll time grid to 7 AM on mount / view change
  useEffect(() => {
    if ((viewMode === 'week' || viewMode === 'day') && timeGridRef.current) {
      setTimeout(() => {
        if (timeGridRef.current) timeGridRef.current.scrollTop = 7 * HOUR_HEIGHT;
      }, 50);
    }
  }, [viewMode]);

  const fetchMetricoolPosts = useCallback(async (start, end) => {
    setLoadingPosts(true);
    setMetricoolError(null);
    try {
      const startStr = start.toISOString().split('.')[0];
      const endStr = end.toISOString().split('.')[0];
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/metricool-posts?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}&timezone=America/Los_Angeles`,
        { headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setScheduledPosts(data.posts || []);
    } catch (err) {
      console.error('Metricool error:', err);
      setMetricoolError(err.message);
      setScheduledPosts([]);
    } finally {
      setLoadingPosts(false);
    }
  }, []);

  useEffect(() => {
    if (showMetricool) {
      const { start, end } = getVisibleRange();
      fetchMetricoolPosts(start, end);
    }
  }, [viewDate, viewMode, showMetricool, fetchMetricoolPosts]);

  async function fetchProjects() {
    try {
      const { data, error } = await supabase.from('projects').select('*').order('start_date', { ascending: true });
      if (error) throw error;
      setProjects(data || []);
    } catch (err) {
      console.error('Error:', err);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCalendarEvents() {
    try {
      const { start, end } = getVisibleRange();
      const bufferStart = new Date(start);
      bufferStart.setDate(bufferStart.getDate() - 7);
      const bufferEnd = new Date(end);
      bufferEnd.setDate(bufferEnd.getDate() + 7);
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*, creator:profiles!created_by(id, full_name)')
        .gte('end_date', bufferStart.toISOString())
        .lte('start_date', bufferEnd.toISOString())
        .order('start_date', { ascending: true });
      if (error) throw error;
      setCalendarEvents(data || []);
    } catch (err) {
      console.error('Error fetching events:', err);
      setCalendarEvents([]);
    }
  }

  async function fetchHubUsers() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url, title')
        .order('full_name', { ascending: true });
      if (error) throw error;
      setHubUsers(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  }

  async function handleStatusChange(projectId, newStatus) {
    setActiveDropdown(null);
    await supabase.from('projects').update({ status: newStatus }).eq('id', projectId);
    fetchProjects();
  }

  async function fetchComments(projectId) {
    try {
      const { data } = await supabase
        .from('project_comments')
        .select('*, profile:profiles(id, full_name)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      setDropdownComments(data || []);
    } catch (err) {
      console.error('Error fetching comments:', err);
    }
  }

  async function handleAddComment(projectId) {
    if (!commentText.trim() || !profile?.id) return;
    const { error } = await supabase.from('project_comments').insert({
      project_id: projectId, user_id: profile.id, content: commentText.trim(),
    });
    if (error) {
      console.error('Error adding comment:', error);
      return;
    }
    setCommentText('');
    fetchComments(projectId);
  }

  async function handleDeleteComment(commentId, projectId) {
    const { error } = await supabase.from('project_comments').delete().eq('id', commentId);
    if (error) console.error('Error deleting comment:', error);
    fetchComments(projectId);
  }

  async function handleDeleteProject(projectId) {
    if (!window.confirm('Delete this project and all its data?')) return;
    await supabase.from('projects').delete().eq('id', projectId);
    setActiveDropdown(null);
    fetchProjects();
  }

  async function handleSaveEvent() {
    if (!eventForm.title.trim() || !eventForm.start_date || !profile?.id) return;
    setSavingEvent(true);
    try {
      const startDate = eventForm.all_day
        ? new Date(`${eventForm.start_date}T00:00:00`)
        : new Date(`${eventForm.start_date}T${eventForm.start_time}:00`);
      const endDateStr = eventForm.end_date || eventForm.start_date;
      const endDate = eventForm.all_day
        ? new Date(`${endDateStr}T23:59:59`)
        : new Date(`${endDateStr}T${eventForm.end_time}:00`);

      const payload = {
        title: eventForm.title.trim(),
        description: eventForm.description.trim(),
        event_type: eventForm.event_type,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        all_day: eventForm.all_day,
        location: eventForm.location.trim(),
        guests: eventForm.guests,
      };

      if (editingEventId) {
        const { error } = await supabase.from('calendar_events').update(payload).eq('id', editingEventId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('calendar_events').insert({ ...payload, created_by: profile.id });
        if (error) throw error;
      }
      setShowEventModal(false);
      setEventForm(EMPTY_EVENT_FORM);
      setEditingEventId(null);
      fetchCalendarEvents();
    } catch (err) {
      console.error('Error saving event:', err);
      alert('Failed to save event: ' + err.message);
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleDeleteEvent(eventId) {
    if (!window.confirm('Delete this event?')) return;
    try {
      const { error } = await supabase.from('calendar_events').delete().eq('id', eventId);
      if (error) throw error;
      setSelectedEvent(null);
      fetchCalendarEvents();
    } catch (err) {
      console.error('Error deleting event:', err);
    }
  }

  function openNewEventModal(date) {
    const dateStr = dk(date);
    setEventForm({ ...EMPTY_EVENT_FORM, start_date: dateStr, end_date: dateStr });
    setEditingEventId(null);
    setShowEventModal(true);
    setSelectedEvent(null);
    setShowGuestDropdown(false);
  }

  function openNewEventModalAtTime(date, hour) {
    const dateStr = dk(date);
    const startTime = `${String(hour).padStart(2, '0')}:00`;
    const endTime = `${String(Math.min(hour + 1, 23)).padStart(2, '0')}:00`;
    setEventForm({ ...EMPTY_EVENT_FORM, start_date: dateStr, end_date: dateStr, start_time: startTime, end_time: endTime });
    setEditingEventId(null);
    setShowEventModal(true);
    setSelectedEvent(null);
    setShowGuestDropdown(false);
  }

  function openEditEventModal(ev) {
    const startD = new Date(ev.start_date);
    const endD = new Date(ev.end_date);
    setEventForm({
      title: ev.title || '',
      description: ev.description || '',
      event_type: ev.event_type || 'meeting',
      start_date: dk(startD),
      start_time: `${String(startD.getHours()).padStart(2, '0')}:${String(startD.getMinutes()).padStart(2, '0')}`,
      end_date: dk(endD),
      end_time: `${String(endD.getHours()).padStart(2, '0')}:${String(endD.getMinutes()).padStart(2, '0')}`,
      all_day: ev.all_day || false,
      location: ev.location || '',
      guests: ev.guests || [],
    });
    setEditingEventId(ev.id);
    setShowEventModal(true);
    setSelectedEvent(null);
    setShowGuestDropdown(false);
  }

  function toggleGuest(userId) {
    setEventForm(prev => ({
      ...prev,
      guests: prev.guests.includes(userId)
        ? prev.guests.filter(id => id !== userId)
        : [...prev.guests, userId],
    }));
  }

  // ── Helpers ──

  function getVisibleRange() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    if (viewMode === 'month') {
      return { start: new Date(year, month, 1), end: new Date(year, month + 1, 0, 23, 59, 59) };
    }
    if (viewMode === 'week') {
      const weekDays = getWeekDays();
      return { start: weekDays[0], end: new Date(weekDays[6].getFullYear(), weekDays[6].getMonth(), weekDays[6].getDate(), 23, 59, 59) };
    }
    return { start: new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate()), end: new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate(), 23, 59, 59) };
  }

  function getMonthRange() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    return { start: new Date(year, month, 1), end: new Date(year, month + 1, 0, 23, 59, 59) };
  }

  function getCalendarDays() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const days = [];
    for (let i = startOffset - 1; i >= 0; i--) days.push({ date: new Date(year, month, -i), isCurrentMonth: false });
    for (let i = 1; i <= lastDay.getDate(); i++) days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    while (days.length < 42) {
      const d = new Date(year, month + 1, days.length - lastDay.getDate() - startOffset + 1);
      days.push({ date: d, isCurrentMonth: false });
    }
    return days;
  }

  function getWeekDays() {
    const d = new Date(viewDate);
    const day = d.getDay();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(d);
      date.setDate(d.getDate() - day + i);
      days.push(date);
    }
    return days;
  }

  function dk(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function navigate(dir) {
    const d = new Date(viewDate);
    if (viewMode === 'month') d.setMonth(d.getMonth() + dir);
    else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setViewDate(d);
  }

  function getEventsForDate(date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    return calendarEvents.filter(ev => {
      const evStart = new Date(ev.start_date);
      const evEnd = new Date(ev.end_date);
      return evStart <= dayEnd && evEnd >= dayStart;
    });
  }

  function formatEventTime(ev) {
    if (ev.all_day) return 'All day';
    const d = new Date(ev.start_date);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function getViewTitle() {
    if (viewMode === 'month') {
      return viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (viewMode === 'week') {
      const days = getWeekDays();
      const s = days[0];
      const e = days[6];
      const sameMonth = s.getMonth() === e.getMonth();
      if (sameMonth) {
        return `${s.toLocaleDateString('en-US', { month: 'short' })} ${s.getDate()} \u2013 ${e.getDate()}, ${e.getFullYear()}`;
      }
      return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} \u2013 ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${e.getFullYear()}`;
    }
    return viewDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  const calendarDays = getCalendarDays();
  const weeks = [];
  for (let i = 0; i < calendarDays.length; i += 7) weeks.push(calendarDays.slice(i, i + 7));

  function getProjectBarsForWeek(week) {
    const weekStart = dk(week[0].date);
    const weekEnd = dk(week[6].date);
    const bars = [];

    projects.forEach(project => {
      if (project.deadline < weekStart || project.start_date > weekEnd) return;
      let startIdx = 0;
      let endIdx = 6;
      for (let i = 0; i < 7; i++) {
        const d = dk(week[i].date);
        if (project.start_date > d) startIdx = i + 1;
        if (project.deadline < d && endIdx === 6) endIdx = i - 1;
      }
      if (startIdx > 6) return;
      startIdx = Math.max(0, startIdx);
      endIdx = Math.min(6, endIdx);
      if (endIdx < startIdx) return;
      const overlapStart = dk(week[startIdx].date);
      const overlapEnd = dk(week[endIdx].date);
      if (project.start_date > overlapEnd || project.deadline < overlapStart) return;
      bars.push({ project, startIdx, endIdx, span: endIdx - startIdx + 1 });
    });

    bars.sort((a, b) => {
      if (a.startIdx !== b.startIdx) return a.startIdx - b.startIdx;
      return b.span - a.span;
    });

    const rows = [];
    bars.forEach(bar => {
      let row = 0;
      while (true) {
        if (!rows[row]) rows[row] = [];
        const conflict = rows[row].some(existing =>
          !(bar.endIdx < existing.startIdx || bar.startIdx > existing.endIdx)
        );
        if (!conflict) {
          rows[row].push(bar);
          bar.row = row;
          break;
        }
        row++;
      }
    });

    return { bars, rowCount: rows.length };
  }

  function getPostsForDate(date) {
    const d = dk(date);
    return scheduledPosts.filter(p => p.publicationDate.dateTime.startsWith(d));
  }

  function getPostDisplayText(post) {
    if (post.youtubeTitle) return post.youtubeTitle;
    if (post.text) return post.text.split('\n')[0].substring(0, 50);
    return 'Untitled post';
  }

  function formatPostTime(dateTimeStr) {
    const d = new Date(dateTimeStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function showProjectTooltip(e, project) {
    if (activeDropdown) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveTooltip({ type: 'project', data: project, x: rect.left + rect.width / 2, y: rect.top - 4 });
  }

  function showPostTooltip(e, post) {
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveTooltip({ type: 'post', data: post, x: rect.left + rect.width / 2, y: rect.top - 4 });
  }

  function hideTooltip() { setActiveTooltip(null); }

  function handleProjectClick(e, project) {
    e.stopPropagation();
    setActiveTooltip(null);
    if (activeDropdown === project.id) {
      setActiveDropdown(null);
    } else {
      setActiveDropdown(project.id);
      setCommentText('');
      fetchComments(project.id);
    }
  }

  function handleEventClick(e, ev) {
    e.stopPropagation();
    setActiveTooltip(null);
    setSelectedEvent(selectedEvent?.id === ev.id ? null : ev);
  }

  function getUserName(userId) {
    const u = hubUsers.find(u => u.id === userId);
    return u ? (u.title ? `${u.full_name} · ${u.title}` : u.full_name) : 'Unknown';
  }

  // ── Event chip renderer (shared across views) ──
  function renderEventChip(ev, opts = {}) {
    const color = EVENT_TYPE_COLORS[ev.event_type] || '#6b7280';
    const icon = EVENT_TYPE_ICONS[ev.event_type] || '\u2022';
    const maxLen = opts.maxLen || 16;
    return (
      <div
        key={`ev-${ev.id}`}
        style={{
          ...styles.eventChip,
          background: `${color}20`,
          borderColor: `${color}50`,
        }}
        onClick={(e) => handleEventClick(e, ev)}
      >
        <span style={{ fontSize: '9px', flexShrink: 0 }}>{icon}</span>
        <span style={{ ...styles.eventChipText, color }}>
          {ev.title.substring(0, maxLen)}
        </span>
      </div>
    );
  }

  // ── Week / Day time-positioned event renderer ──
  function getTimedEventStyle(ev, dayDate, columnCount, columnIdx) {
    const evStart = new Date(ev.start_date);
    const evEnd = new Date(ev.end_date);
    const dayStart = new Date(dayDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayDate);
    dayEnd.setHours(23, 59, 59, 999);

    const clampedStart = evStart < dayStart ? dayStart : evStart;
    const clampedEnd = evEnd > dayEnd ? dayEnd : evEnd;

    const startMinutes = clampedStart.getHours() * 60 + clampedStart.getMinutes();
    const endMinutes = clampedEnd.getHours() * 60 + clampedEnd.getMinutes();
    const duration = Math.max(endMinutes - startMinutes, 25);

    const top = (startMinutes / 60) * HOUR_HEIGHT;
    const height = (duration / 60) * HOUR_HEIGHT;
    const width = columnCount > 1 ? `${(1 / columnCount) * 100}%` : '100%';
    const left = columnCount > 1 ? `${(columnIdx / columnCount) * 100}%` : '0';

    return { top: `${top}px`, height: `${height}px`, width, left };
  }

  function layoutOverlappingEvents(events) {
    if (!events.length) return [];
    const sorted = [...events].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    const columns = [];

    sorted.forEach(ev => {
      const evStart = new Date(ev.start_date);
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const lastInCol = columns[c][columns[c].length - 1];
        if (new Date(lastInCol.end_date) <= evStart) {
          columns[c].push(ev);
          placed = true;
          break;
        }
      }
      if (!placed) columns.push([ev]);
    });

    const result = [];
    columns.forEach((col, colIdx) => {
      col.forEach(ev => {
        result.push({ event: ev, columnCount: columns.length, columnIdx: colIdx });
      });
    });
    return result;
  }

  // ──────────── RENDER ────────────

  return (
    <div style={styles.page} onClick={() => { setActiveDropdown(null); setActiveTooltip(null); setSelectedEvent(null); }}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Calendar</h1>
          <p style={styles.pageSubtitle}>
            {projects.length} projects
            {calendarEvents.length > 0 && ` \u00B7 ${calendarEvents.length} events`}
            {showMetricool && scheduledPosts.length > 0 && ` \u00B7 ${scheduledPosts.length} scheduled posts`}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); openNewEventModal(new Date()); }}
          style={styles.addEventBtn}
        >
          + Add Event
        </button>
      </div>

      <div style={styles.controlsRow}>
        <div style={styles.navControls}>
          <button onClick={() => navigate(-1)} style={styles.navBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span style={styles.viewTitle}>{getViewTitle()}</span>
          <button onClick={() => navigate(1)} style={styles.navBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button onClick={() => setViewDate(new Date())} style={styles.todayBtn}>Today</button>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* View mode toggle */}
          <div style={styles.viewToggleGroup}>
            {['month', 'week', 'day'].map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  ...styles.viewToggleBtn,
                  ...(viewMode === mode ? styles.viewToggleBtnActive : {}),
                }}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setShowMetricool(!showMetricool); }}
            style={{ ...styles.metricoolToggle, ...(showMetricool ? styles.metricoolToggleActive : {}) }}
          >
            {loadingPosts ? '\u27F3' : '\uD83D\uDCC5'} Metricool
          </button>
        </div>
      </div>

      {metricoolError && showMetricool && (
        <div style={styles.errorBanner}>
          Metricool: {metricoolError}
          <button onClick={() => setMetricoolError(null)} style={styles.errorClose}>{'\u2715'}</button>
        </div>
      )}

      {/* ──── MONTH VIEW ──── */}
      {viewMode === 'month' && (
        <>
          <div style={styles.calendarGrid}>
            <div style={styles.weekdayRow}>
              {WEEKDAYS.map(day => <div key={day} style={styles.weekdayCell}>{day}</div>)}
            </div>

            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.35)' }}>Loading...</div>
            ) : (
              weeks.map((week, wi) => {
                const { bars, rowCount } = getProjectBarsForWeek(week);
                const barAreaHeight = Math.max(0, rowCount) * 24;
                return (
                  <div key={wi} style={styles.weekRow}>
                    {week.map((day, di) => {
                      const isToday = day.date.toDateString() === new Date().toDateString();
                      const dayPosts = showMetricool ? getPostsForDate(day.date) : [];
                      const dayEvents = getEventsForDate(day.date);
                      const regularEvents = dayEvents.filter(ev => ev.event_type !== 'live_recording');
                      const liveEvents = dayEvents.filter(ev => ev.event_type === 'live_recording');
                      const dayKey = dk(day.date);
                      const isSocialExpanded = expandedSocialDays[dayKey];
                      return (
                        <div key={di} style={{
                          ...styles.dayCell,
                          opacity: day.isCurrentMonth ? 1 : 0.3,
                          background: isToday ? 'rgba(99,102,241,0.06)' : 'transparent',
                          borderRight: di < 6 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        }}
                        onDoubleClick={(e) => { e.stopPropagation(); openNewEventModal(day.date); }}
                        >
                          <div style={styles.dateRow}>
                            <span style={{ ...styles.dateNumber, ...(isToday ? styles.dateNumberToday : {}) }}>
                              {day.date.getDate()}
                            </span>
                          </div>

                          <div style={{ minHeight: `${barAreaHeight}px`, flexShrink: 0 }} />

                          {/* Regular events - pinned to top, below projects */}
                          {regularEvents.length > 0 && (
                            <div style={styles.eventsContainer}>
                              {regularEvents.map(ev => renderEventChip(ev))}
                            </div>
                          )}

                          {/* Spacer pushes live/social to bottom */}
                          <div style={{ flex: 1 }} />

                          {/* Live/Recording events - pinned to bottom, above social posts */}
                          {liveEvents.length > 0 && (
                            <div style={styles.eventsContainer}>
                              {liveEvents.map(ev => renderEventChip(ev))}
                            </div>
                          )}

                          {/* Social Posts - collapsed by default, pinned to very bottom */}
                          {dayPosts.length > 0 && (
                            <div style={styles.socialPostsWrapper}>
                              <div
                                style={styles.socialPostsHeader}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedSocialDays(prev => ({ ...prev, [dayKey]: !prev[dayKey] }));
                                }}
                              >
                                <span style={{
                                  ...styles.socialPostsArrow,
                                  transform: isSocialExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                }}>{'\u25B8'}</span>
                                <span style={styles.socialPostsLabel}>Social Posts</span>
                                <span style={styles.socialPostsCount}>{dayPosts.length}</span>
                              </div>
                              {isSocialExpanded && (
                                <div style={styles.socialPostsList}>
                                  {dayPosts.map(post => {
                                    const color = NETWORK_COLORS[post.network] || '#666';
                                    const icon = NETWORK_ICONS[post.network] || '\u2022';
                                    const isPending = post.status === 'PENDING';
                                    return (
                                      <div
                                        key={`post-${post.id}`}
                                        style={{
                                          ...styles.postChip,
                                          background: `${color}18`,
                                          borderColor: `${color}35`,
                                          opacity: isPending ? 0.7 : 1,
                                        }}
                                        onMouseEnter={(e) => showPostTooltip(e, post)}
                                        onMouseLeave={hideTooltip}
                                        onClick={(e) => { e.stopPropagation(); if (post.publicUrl) window.open(post.publicUrl, '_blank'); }}
                                      >
                                        <span style={{ color, fontSize: '9px', flexShrink: 0 }}>{icon}</span>
                                        <span style={{ ...styles.postChipText, color }}>
                                          {getPostDisplayText(post).substring(0, 18)}
                                        </span>
                                        {isPending && <span style={{ fontSize: '8px', flexShrink: 0 }}>{'\u23F3'}</span>}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Project bars overlay */}
                    {bars.map(bar => {
                      const color = STATUS_COLORS[bar.project.status];
                      const leftPct = (bar.startIdx / 7) * 100;
                      const widthPct = (bar.span / 7) * 100;
                      const topPx = 30 + bar.row * 24;

                      return (
                        <div
                          key={`bar-${bar.project.id}-${wi}`}
                          style={{
                            position: 'absolute',
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            top: `${topPx}px`,
                            height: '20px',
                            background: `${color}25`,
                            borderLeft: `3px solid ${color}`,
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 6px',
                            cursor: 'pointer',
                            zIndex: 3,
                            overflow: 'visible',
                          }}
                          onMouseEnter={(e) => showProjectTooltip(e, bar.project)}
                          onMouseLeave={hideTooltip}
                          onClick={(e) => handleProjectClick(e, bar.project)}
                        >
                          <span style={{ fontSize: '10px', fontWeight: 700, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {bar.project.name}
                          </span>

                          {activeDropdown === bar.project.id && (
                            <div ref={dropdownRef} style={styles.statusDropdown} onClick={(e) => e.stopPropagation()}>
                              <div style={styles.dropdownTitle}>{bar.project.name}</div>
                              <div style={styles.dropdownTagsWrap}>
                                {STATUSES.map(s => {
                                  const isActive = bar.project.status === s;
                                  return (
                                    <button
                                      key={s}
                                      onClick={(e) => { e.stopPropagation(); handleStatusChange(bar.project.id, s); }}
                                      style={{
                                        ...styles.statusTag,
                                        background: isActive ? `${STATUS_COLORS[s]}35` : 'rgba(255,255,255,0.04)',
                                        color: isActive ? STATUS_COLORS[s] : 'rgba(255,255,255,0.4)',
                                        borderColor: isActive ? `${STATUS_COLORS[s]}60` : 'rgba(255,255,255,0.08)',
                                        fontWeight: isActive ? 700 : 500,
                                      }}
                                    >
                                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: STATUS_COLORS[s], flexShrink: 0 }} />
                                      {STATUS_LABELS[s]}
                                    </button>
                                  );
                                })}
                              </div>

                              <div style={styles.dropdownDivider} />
                              <div style={styles.dropdownSectionLabel}>Comments</div>
                              <div style={styles.dropdownComments}>
                                {dropdownComments.length === 0 ? (
                                  <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', margin: '2px 0' }}>No comments yet</p>
                                ) : (
                                  dropdownComments.map(c => (
                                    <div key={c.id} style={styles.dropdownComment}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={styles.dropdownCommentAuthor}>{c.profile?.full_name}</span>
                                        <span style={styles.dropdownCommentTime}>
                                          {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </span>
                                        {(c.user_id === profile?.id || isAdmin) && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteComment(c.id, bar.project.id); }}
                                            style={styles.dropdownCommentDelete}
                                          >{'\u2715'}</button>
                                        )}
                                      </div>
                                      <span style={styles.dropdownCommentText}>{c.content}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                              <div style={styles.dropdownCommentForm}>
                                <input
                                  value={commentText}
                                  onChange={(e) => setCommentText(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddComment(bar.project.id); } }}
                                  placeholder="Add a comment..."
                                  style={styles.dropdownCommentInput}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleAddComment(bar.project.id); }}
                                  style={styles.dropdownCommentBtn}
                                  disabled={!commentText.trim()}
                                >Post</button>
                              </div>
                              {(bar.project.created_by === profile?.id || isAdmin) && (
                                <>
                                  <div style={styles.dropdownDivider} />
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteProject(bar.project.id); }}
                                    style={styles.dropdownDeleteBtn}
                                  >{'\uD83D\uDDD1'} Delete Project</button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ──── WEEK VIEW ──── */}
      {viewMode === 'week' && (
        <div style={styles.weekViewContainer}>
          {/* Header row */}
          <div style={styles.weekViewHeader}>
            <div style={styles.timeGutterHeader} />
            {getWeekDays().map((date, i) => {
              const isToday = date.toDateString() === new Date().toDateString();
              return (
                <div key={i} style={{
                  ...styles.weekDayHeader,
                  borderRight: i < 6 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                }}>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase' }}>
                    {WEEKDAYS[i]}
                  </span>
                  <span style={{
                    ...styles.weekDayNumber,
                    ...(isToday ? styles.weekDayNumberToday : {}),
                  }}
                  onClick={() => { setViewDate(date); setViewMode('day'); }}
                  >
                    {date.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* All-day events row */}
          <div style={styles.weekAllDayRow}>
            <div style={styles.timeGutterLabel}>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>all-day</span>
            </div>
            {getWeekDays().map((date, i) => {
              const dayEvents = getEventsForDate(date).filter(ev => ev.all_day);
              return (
                <div key={i} style={{
                  ...styles.weekAllDayCell,
                  borderRight: i < 6 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                }}>
                  {dayEvents.map(ev => renderEventChip(ev, { maxLen: 12 }))}
                </div>
              );
            })}
          </div>

          {/* Time grid */}
          <div ref={timeGridRef} style={styles.timeGridScroll}>
            <div style={{ ...styles.timeGrid, height: `${24 * HOUR_HEIGHT}px` }}>
              {/* Hour lines */}
              {HOURS.map(h => (
                <div key={h} style={{
                  position: 'absolute', top: `${h * HOUR_HEIGHT}px`, left: 0, right: 0,
                  borderTop: '1px solid rgba(255,255,255,0.04)', height: `${HOUR_HEIGHT}px`,
                }}>
                  <div style={styles.timeGutterHourLabel}>{formatHourLabel(h)}</div>
                </div>
              ))}

              {/* Now indicator */}
              {(() => {
                const now = new Date();
                const weekDays = getWeekDays();
                const todayIdx = weekDays.findIndex(d => d.toDateString() === now.toDateString());
                if (todayIdx < 0) return null;
                const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
                const topPx = (minutesSinceMidnight / 60) * HOUR_HEIGHT;
                const colLeft = `calc(56px + ${(todayIdx / 7) * 100}% * (1 - 56px / 100%))`;
                return (
                  <div style={{
                    position: 'absolute', top: `${topPx}px`,
                    left: '56px', right: 0, height: '2px',
                    background: '#ef4444', zIndex: 10, pointerEvents: 'none',
                  }}>
                    <div style={{
                      position: 'absolute', left: `${(todayIdx / 7) * 100}%`,
                      top: '-4px', width: '10px', height: '10px',
                      borderRadius: '50%', background: '#ef4444',
                    }} />
                  </div>
                );
              })()}

              {/* Day columns with events */}
              <div style={styles.weekColumnsContainer}>
                {getWeekDays().map((date, i) => {
                  const dayEvents = getEventsForDate(date).filter(ev => !ev.all_day);
                  const laid = layoutOverlappingEvents(dayEvents);
                  return (
                    <div key={i} style={{
                      ...styles.weekColumn,
                      borderRight: i < 6 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const y = e.clientY - rect.top + (timeGridRef.current?.scrollTop || 0);
                      const hour = Math.floor(y / HOUR_HEIGHT);
                      openNewEventModalAtTime(date, Math.min(Math.max(hour, 0), 23));
                    }}
                    >
                      {laid.map(({ event: ev, columnCount, columnIdx }) => {
                        const color = EVENT_TYPE_COLORS[ev.event_type] || '#6b7280';
                        const icon = EVENT_TYPE_ICONS[ev.event_type] || '\u2022';
                        const pos = getTimedEventStyle(ev, date, columnCount, columnIdx);
                        return (
                          <div
                            key={`tev-${ev.id}`}
                            style={{
                              position: 'absolute',
                              ...pos,
                              background: `${color}25`,
                              borderLeft: `3px solid ${color}`,
                              borderRadius: '4px',
                              padding: '2px 6px',
                              cursor: 'pointer',
                              zIndex: 5,
                              overflow: 'hidden',
                              fontSize: '11px',
                            }}
                            onClick={(e) => handleEventClick(e, ev)}
                          >
                            <div style={{ fontWeight: 600, color, fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {icon} {ev.title}
                            </div>
                            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                              {formatEventTime(ev)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──── DAY VIEW ──── */}
      {viewMode === 'day' && (
        <div style={styles.dayViewContainer}>
          {/* All-day events */}
          {(() => {
            const allDayEvents = getEventsForDate(viewDate).filter(ev => ev.all_day);
            if (!allDayEvents.length) return null;
            return (
              <div style={styles.dayAllDayRow}>
                <div style={styles.timeGutterLabel}>
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>all-day</span>
                </div>
                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '4px 8px' }}>
                  {allDayEvents.map(ev => renderEventChip(ev, { maxLen: 40 }))}
                </div>
              </div>
            );
          })()}

          {/* Time grid */}
          <div ref={timeGridRef} style={styles.timeGridScroll}>
            <div style={{ ...styles.timeGrid, height: `${24 * HOUR_HEIGHT}px` }}>
              {/* Hour lines */}
              {HOURS.map(h => (
                <div key={h} style={{
                  position: 'absolute', top: `${h * HOUR_HEIGHT}px`, left: 0, right: 0,
                  borderTop: '1px solid rgba(255,255,255,0.04)', height: `${HOUR_HEIGHT}px`,
                }}>
                  <div style={styles.timeGutterHourLabel}>{formatHourLabel(h)}</div>
                </div>
              ))}

              {/* Now indicator */}
              {(() => {
                const now = new Date();
                if (viewDate.toDateString() !== now.toDateString()) return null;
                const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
                const topPx = (minutesSinceMidnight / 60) * HOUR_HEIGHT;
                return (
                  <div style={{
                    position: 'absolute', top: `${topPx}px`,
                    left: '56px', right: 0, height: '2px',
                    background: '#ef4444', zIndex: 10, pointerEvents: 'none',
                  }}>
                    <div style={{ position: 'absolute', left: 0, top: '-4px', width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
                  </div>
                );
              })()}

              {/* Single day column */}
              <div style={styles.dayColumnContainer}>
                <div style={styles.dayColumn}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y = e.clientY - rect.top + (timeGridRef.current?.scrollTop || 0);
                    const hour = Math.floor(y / HOUR_HEIGHT);
                    openNewEventModalAtTime(viewDate, Math.min(Math.max(hour, 0), 23));
                  }}
                >
                  {(() => {
                    const dayEvents = getEventsForDate(viewDate).filter(ev => !ev.all_day);
                    const laid = layoutOverlappingEvents(dayEvents);
                    return laid.map(({ event: ev, columnCount, columnIdx }) => {
                      const color = EVENT_TYPE_COLORS[ev.event_type] || '#6b7280';
                      const icon = EVENT_TYPE_ICONS[ev.event_type] || '\u2022';
                      const pos = getTimedEventStyle(ev, viewDate, columnCount, columnIdx);
                      return (
                        <div
                          key={`tev-${ev.id}`}
                          style={{
                            position: 'absolute',
                            ...pos,
                            background: `${color}25`,
                            borderLeft: `3px solid ${color}`,
                            borderRadius: '6px',
                            padding: '4px 10px',
                            cursor: 'pointer',
                            zIndex: 5,
                            overflow: 'hidden',
                          }}
                          onClick={(e) => handleEventClick(e, ev)}
                        >
                          <div style={{ fontWeight: 600, color, fontSize: '13px', marginBottom: '2px' }}>
                            {icon} {ev.title}
                          </div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                            {formatEventTime(ev)}
                            {ev.location && ` \u00B7 ${ev.location}`}
                          </div>
                          {ev.guests && ev.guests.length > 0 && (
                            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                              {ev.guests.map(g => getUserName(g)).join(', ')}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hover Tooltip */}
      {activeTooltip && !activeDropdown && (
        <div style={{ ...styles.tooltip, left: `${activeTooltip.x}px`, top: `${activeTooltip.y}px` }}>
          {activeTooltip.type === 'project' && (
            <>
              <div style={styles.tooltipTitle}>{activeTooltip.data.name}</div>
              <div style={styles.tooltipRow}>
                <div style={{ ...styles.tooltipDot, background: STATUS_COLORS[activeTooltip.data.status] }} />
                <span>{STATUS_LABELS[activeTooltip.data.status]}</span>
              </div>
              <div style={styles.tooltipMeta}>
                {activeTooltip.data.type.replace('_', ' ')}{activeTooltip.data.channel && ` \u00B7 ${activeTooltip.data.channel}`}
              </div>
              <div style={styles.tooltipMeta}>
                {new Date(activeTooltip.data.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' \u2192 '}
                {new Date(activeTooltip.data.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div style={styles.tooltipHint}>Click to change status</div>
            </>
          )}
          {activeTooltip.type === 'post' && (
            <>
              <div style={styles.tooltipTitle}>{getPostDisplayText(activeTooltip.data)}</div>
              <div style={styles.tooltipRow}>
                <div style={{ ...styles.tooltipDot, background: NETWORK_COLORS[activeTooltip.data.network] || '#666' }} />
                <span>{NETWORK_LABELS[activeTooltip.data.network] || activeTooltip.data.network}</span>
              </div>
              <div style={styles.tooltipMeta}>
                Scheduled: {formatPostTime(activeTooltip.data.publicationDate.dateTime)}
              </div>
              <div style={styles.tooltipMeta}>
                {activeTooltip.data.status === 'PENDING' ? '\u23F3 Pending' : '\u2713 Published'}
              </div>
              {activeTooltip.data.publicUrl && <div style={styles.tooltipHint}>Click to open</div>}
            </>
          )}
        </div>
      )}

      {/* Event detail popup */}
      {selectedEvent && (
        <div style={styles.modalOverlay} onClick={() => setSelectedEvent(null)}>
          <div style={styles.eventDetailCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{
                width: '12px', height: '12px', borderRadius: '3px',
                background: EVENT_TYPE_COLORS[selectedEvent.event_type],
                flexShrink: 0,
              }} />
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#fff', flex: 1 }}>
                {selectedEvent.title}
              </h3>
              <button onClick={() => setSelectedEvent(null)} style={styles.modalCloseBtn}>{'\u2715'}</button>
            </div>
            <div style={styles.eventDetailRow}>
              <span style={styles.eventDetailLabel}>Type</span>
              <span style={{ color: EVENT_TYPE_COLORS[selectedEvent.event_type], fontWeight: 600, fontSize: '13px' }}>
                {EVENT_TYPE_ICONS[selectedEvent.event_type]} {EVENT_TYPE_LABELS[selectedEvent.event_type]}
              </span>
            </div>
            <div style={styles.eventDetailRow}>
              <span style={styles.eventDetailLabel}>When</span>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>
                {selectedEvent.all_day ? 'All day' : new Date(selectedEvent.start_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {' \u2013 '}
                {selectedEvent.all_day
                  ? new Date(selectedEvent.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : new Date(selectedEvent.end_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                }
              </span>
            </div>
            {selectedEvent.location && (
              <div style={styles.eventDetailRow}>
                <span style={styles.eventDetailLabel}>Location</span>
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>{selectedEvent.location}</span>
              </div>
            )}
            {selectedEvent.description && (
              <div style={styles.eventDetailRow}>
                <span style={styles.eventDetailLabel}>Description</span>
                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', lineHeight: 1.4 }}>{selectedEvent.description}</span>
              </div>
            )}
            {selectedEvent.guests && selectedEvent.guests.length > 0 && (
              <div style={styles.eventDetailRow}>
                <span style={styles.eventDetailLabel}>Team Members</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {selectedEvent.guests.map(gId => (
                    <span key={gId} style={styles.guestTag}>{getUserName(gId)}</span>
                  ))}
                </div>
              </div>
            )}
            <div style={styles.eventDetailRow}>
              <span style={styles.eventDetailLabel}>Created by</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>
                {selectedEvent.creator?.full_name || 'Unknown'}
              </span>
            </div>
            {(selectedEvent.created_by === profile?.id || isAdmin) && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button
                  onClick={() => openEditEventModal(selectedEvent)}
                  style={styles.eventEditBtn}
                >
                  Edit Event
                </button>
                <button
                  onClick={() => handleDeleteEvent(selectedEvent.id)}
                  style={styles.eventDeleteBtn}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add / Edit Event Modal */}
      {showEventModal && (
        <div style={styles.modalOverlay} onClick={() => { setShowEventModal(false); setEditingEventId(null); }}>
          <div ref={modalRef} style={styles.eventModal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#fff' }}>
                {editingEventId ? 'Edit Event' : 'New Event'}
              </h2>
              <button onClick={() => { setShowEventModal(false); setEditingEventId(null); }} style={styles.modalCloseBtn}>{'\u2715'}</button>
            </div>

            {/* Title */}
            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Title *</label>
              <input
                value={eventForm.title}
                onChange={(e) => setEventForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Add title"
                style={styles.formInput}
                autoFocus
              />
            </div>

            {/* Event Type */}
            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Event Type *</label>
              <div style={styles.eventTypeGrid}>
                {EVENT_TYPES.map(type => {
                  const isActive = eventForm.event_type === type;
                  const color = EVENT_TYPE_COLORS[type];
                  return (
                    <button
                      key={type}
                      onClick={() => setEventForm(prev => ({ ...prev, event_type: type }))}
                      style={{
                        ...styles.eventTypeBtn,
                        background: isActive ? `${color}25` : 'rgba(255,255,255,0.03)',
                        borderColor: isActive ? `${color}60` : 'rgba(255,255,255,0.08)',
                        color: isActive ? color : 'rgba(255,255,255,0.5)',
                      }}
                    >
                      <span>{EVENT_TYPE_ICONS[type]}</span>
                      <span>{EVENT_TYPE_LABELS[type]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* All Day toggle */}
            <div style={styles.formGroup}>
              <label style={{ ...styles.formLabel, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={eventForm.all_day}
                  onChange={(e) => setEventForm(prev => ({ ...prev, all_day: e.target.checked }))}
                  style={{ accentColor: '#6366f1' }}
                />
                All day
              </label>
            </div>

            {/* Date / Time */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ ...styles.formGroup, flex: 1 }}>
                <label style={styles.formLabel}>Start Date *</label>
                <input
                  type="date"
                  value={eventForm.start_date}
                  onChange={(e) => setEventForm(prev => ({
                    ...prev,
                    start_date: e.target.value,
                    end_date: prev.end_date < e.target.value ? e.target.value : prev.end_date,
                  }))}
                  style={styles.formInput}
                />
              </div>
              {!eventForm.all_day && (
                <div style={{ ...styles.formGroup, flex: 1 }}>
                  <label style={styles.formLabel}>Start Time</label>
                  <input
                    type="time"
                    value={eventForm.start_time}
                    onChange={(e) => setEventForm(prev => ({ ...prev, start_time: e.target.value }))}
                    style={styles.formInput}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ ...styles.formGroup, flex: 1 }}>
                <label style={styles.formLabel}>End Date</label>
                <input
                  type="date"
                  value={eventForm.end_date}
                  min={eventForm.start_date}
                  onChange={(e) => setEventForm(prev => ({ ...prev, end_date: e.target.value }))}
                  style={styles.formInput}
                />
              </div>
              {!eventForm.all_day && (
                <div style={{ ...styles.formGroup, flex: 1 }}>
                  <label style={styles.formLabel}>End Time</label>
                  <input
                    type="time"
                    value={eventForm.end_time}
                    onChange={(e) => setEventForm(prev => ({ ...prev, end_time: e.target.value }))}
                    style={styles.formInput}
                  />
                </div>
              )}
            </div>

            {/* Location */}
            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Location</label>
              <input
                value={eventForm.location}
                onChange={(e) => setEventForm(prev => ({ ...prev, location: e.target.value }))}
                placeholder="Add location"
                style={styles.formInput}
              />
            </div>

            {/* Description */}
            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Description</label>
              <textarea
                value={eventForm.description}
                onChange={(e) => setEventForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Add description"
                rows={3}
                style={{ ...styles.formInput, resize: 'vertical', minHeight: '60px' }}
              />
            </div>

            {/* Assign team members */}
            <div style={styles.formGroup} ref={guestDropdownRef}>
              <label style={styles.formLabel}>Team Members</label>
              <div
                style={styles.guestSelector}
                onClick={() => setShowGuestDropdown(!showGuestDropdown)}
              >
                {eventForm.guests.length === 0 ? (
                  <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '13px' }}>Assign team members...</span>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {eventForm.guests.map(gId => (
                      <span key={gId} style={styles.guestTag}>
                        {getUserName(gId)}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleGuest(gId); }}
                          style={styles.guestTagRemove}
                        >{'\u2715'}</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {showGuestDropdown && (
                <div style={styles.guestDropdownList}>
                  {hubUsers.filter(u => u.id !== profile?.id).map(u => {
                    const isSelected = eventForm.guests.includes(u.id);
                    return (
                      <div
                        key={u.id}
                        style={{
                          ...styles.guestDropdownItem,
                          background: isSelected ? 'rgba(99,102,241,0.12)' : 'transparent',
                        }}
                        onClick={() => toggleGuest(u.id)}
                      >
                        <div style={styles.guestDropdownAvatar}>
                          {u.full_name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '13px', color: '#fff', fontWeight: 500 }}>{u.full_name}</div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>{u.title || u.email}</div>
                        </div>
                        {isSelected && <span style={{ color: '#a5b4fc', fontSize: '14px' }}>{'\u2713'}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Save / Cancel */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button onClick={() => { setShowEventModal(false); setEditingEventId(null); }} style={styles.cancelBtn}>Cancel</button>
              <button
                onClick={handleSaveEvent}
                disabled={!eventForm.title.trim() || !eventForm.start_date || savingEvent}
                style={{
                  ...styles.saveBtn,
                  opacity: (!eventForm.title.trim() || !eventForm.start_date || savingEvent) ? 0.5 : 1,
                }}
              >
                {savingEvent ? 'Saving...' : (editingEventId ? 'Update Event' : 'Save Event')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={styles.legend}>
        <div style={styles.legendGroup}>
          <span style={styles.legendGroupLabel}>Events:</span>
          {Object.entries(EVENT_TYPE_COLORS).map(([type, color]) => (
            <div key={type} style={styles.legendItem}>
              <div style={{ ...styles.legendDot, background: color }} /><span>{EVENT_TYPE_LABELS[type]}</span>
            </div>
          ))}
        </div>
        <div style={styles.legendGroup}>
          <span style={styles.legendGroupLabel}>Projects:</span>
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} style={styles.legendItem}>
              <div style={{ ...styles.legendDot, background: color }} /><span>{STATUS_LABELS[status]}</span>
            </div>
          ))}
        </div>
        {showMetricool && (
          <div style={styles.legendGroup}>
            <span style={styles.legendGroupLabel}>Platforms:</span>
            {Object.entries(NETWORK_COLORS).map(([network, color]) => (
              <div key={network} style={styles.legendItem}>
                <div style={{ ...styles.legendDot, background: color }} /><span>{NETWORK_LABELS[network]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px', minHeight: '100%' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },
  addEventBtn: { padding: '8px 18px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '-0.2px' },
  controlsRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' },
  navControls: { display: 'flex', alignItems: 'center', gap: '12px' },
  navBtn: { width: '34px', height: '34px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#e2e8f0', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' },
  viewTitle: { fontSize: '18px', fontWeight: 600, color: '#ffffff', minWidth: '180px', textAlign: 'center' },
  todayBtn: { padding: '6px 14px', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '8px', color: '#a5b4fc', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  viewToggleGroup: { display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' },
  viewToggleBtn: { padding: '6px 14px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  viewToggleBtnActive: { background: 'rgba(99,102,241,0.2)', color: '#a5b4fc' },
  metricoolToggle: { padding: '6px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.45)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  metricoolToggleActive: { background: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.25)', color: '#86efac' },
  errorBanner: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', marginBottom: '16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', color: '#fca5a5', fontSize: '13px' },
  errorClose: { background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '14px', padding: '0 4px' },
  // Month view
  calendarGrid: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', overflow: 'hidden' },
  weekdayRow: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' },
  weekdayCell: { padding: '10px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  weekRow: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.04)', position: 'relative', minHeight: '120px' },
  dayCell: { padding: '4px', display: 'flex', flexDirection: 'column', minHeight: '120px', cursor: 'default' },
  dateRow: { display: 'flex', justifyContent: 'flex-end', padding: '2px 4px', marginBottom: '0px' },
  dateNumber: { fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.5)', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' },
  dateNumberToday: { background: '#6366f1', color: '#ffffff', fontWeight: 700 },
  eventsContainer: { display: 'flex', flexDirection: 'column', gap: '2px' },
  eventChip: { display: 'flex', alignItems: 'center', gap: '3px', padding: '1px 5px', borderRadius: '4px', border: '1px solid', cursor: 'pointer', minHeight: '17px', transition: 'opacity 0.1s' },
  eventChipText: { fontSize: '9px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
  postsContainer: { display: 'flex', flexDirection: 'column', gap: '2px' },
  socialPostsWrapper: { borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '2px', paddingTop: '2px', flexShrink: 0 },
  socialPostsHeader: { display: 'flex', alignItems: 'center', gap: '3px', padding: '1px 4px', cursor: 'pointer', borderRadius: '3px', userSelect: 'none' },
  socialPostsArrow: { fontSize: '8px', color: 'rgba(255,255,255,0.35)', transition: 'transform 0.15s', flexShrink: 0, lineHeight: 1, width: '10px', textAlign: 'center' },
  socialPostsLabel: { fontSize: '9px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' },
  socialPostsCount: { fontSize: '8px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', padding: '0 4px', lineHeight: '14px', flexShrink: 0 },
  socialPostsList: { display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: '2px' },
  postChip: { display: 'flex', alignItems: 'center', gap: '3px', padding: '1px 5px', borderRadius: '4px', border: '1px solid', cursor: 'pointer', minHeight: '17px' },
  postChipText: { fontSize: '9px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
  // Week view
  weekViewContainer: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  weekViewHeader: { display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' },
  timeGutterHeader: { borderRight: '1px solid rgba(255,255,255,0.06)' },
  weekDayHeader: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 4px', gap: '2px' },
  weekDayNumber: { fontSize: '20px', fontWeight: 700, color: 'rgba(255,255,255,0.7)', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', cursor: 'pointer', transition: 'background 0.15s' },
  weekDayNumberToday: { background: '#6366f1', color: '#ffffff' },
  weekAllDayRow: { display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.06)', minHeight: '28px' },
  weekAllDayCell: { display: 'flex', flexWrap: 'wrap', gap: '2px', padding: '2px 4px', alignItems: 'center' },
  timeGridScroll: { overflow: 'auto', maxHeight: '600px', position: 'relative' },
  timeGrid: { position: 'relative', minWidth: '100%' },
  timeGutterLabel: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', borderRight: '1px solid rgba(255,255,255,0.06)' },
  timeGutterHourLabel: { position: 'absolute', left: '0', top: '-8px', width: '56px', textAlign: 'center', fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontWeight: 500, zIndex: 2 },
  weekColumnsContainer: { position: 'absolute', top: 0, left: '56px', right: 0, bottom: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' },
  weekColumn: { position: 'relative' },
  // Day view
  dayViewContainer: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  dayAllDayRow: { display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', minHeight: '32px', alignItems: 'center' },
  dayColumnContainer: { position: 'absolute', top: 0, left: '56px', right: 0, bottom: 0 },
  dayColumn: { position: 'relative', width: '100%', height: '100%' },
  // Shared
  statusDropdown: { position: 'absolute', top: '24px', left: '0', background: '#1e1e36', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '12px', zIndex: 100, minWidth: '250px', maxWidth: '320px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)', maxHeight: '360px', overflow: 'auto' },
  dropdownTitle: { fontSize: '13px', fontWeight: 700, color: '#ffffff', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  dropdownTagsWrap: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  statusTag: { display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '6px', border: '1px solid', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap' },
  dropdownDivider: { height: '1px', background: 'rgba(255,255,255,0.08)', margin: '10px 0' },
  dropdownSectionLabel: { fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' },
  dropdownComments: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px', maxHeight: '120px', overflow: 'auto' },
  dropdownComment: { display: 'flex', flexDirection: 'column', gap: '1px', padding: '5px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' },
  dropdownCommentAuthor: { fontSize: '10px', fontWeight: 600, color: '#a5b4fc' },
  dropdownCommentText: { fontSize: '11px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.3 },
  dropdownCommentTime: { fontSize: '9px', color: 'rgba(255,255,255,0.2)' },
  dropdownCommentForm: { display: 'flex', gap: '6px' },
  dropdownCommentInput: { flex: 1, padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '11px', fontFamily: 'inherit', outline: 'none' },
  dropdownCommentBtn: { padding: '6px 10px', background: '#6366f1', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '10px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  dropdownCommentDelete: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: '10px', padding: '0 2px', marginLeft: 'auto' },
  dropdownDeleteBtn: { width: '100%', padding: '7px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '6px', color: '#fca5a5', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' },
  tooltip: { position: 'fixed', transform: 'translate(-50%, -100%)', background: '#1e1e36', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '10px 14px', zIndex: 200, minWidth: '180px', maxWidth: '280px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)', pointerEvents: 'none' },
  tooltipTitle: { fontSize: '13px', fontWeight: 700, color: '#ffffff', marginBottom: '6px', lineHeight: 1.3 },
  tooltipRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '3px' },
  tooltipDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  tooltipMeta: { fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '2px', textTransform: 'capitalize' },
  tooltipHint: { fontSize: '10px', color: 'rgba(99,102,241,0.7)', marginTop: '6px', fontStyle: 'italic' },
  legend: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px', padding: '0 4px' },
  legendGroup: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' },
  legendGroupLabel: { fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  legendItem: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.45)' },
  legendDot: { width: '8px', height: '8px', borderRadius: '3px' },
  // Modal styles
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, backdropFilter: 'blur(4px)' },
  eventModal: { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '24px', width: '480px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' },
  modalCloseBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '18px', padding: '4px 8px', borderRadius: '6px' },
  formGroup: { marginBottom: '14px', position: 'relative' },
  formLabel: { display: 'block', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.3px' },
  formInput: { width: '100%', padding: '9px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  eventTypeGrid: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  eventTypeBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', borderRadius: '8px', border: '1px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  cancelBtn: { flex: 1, padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: 'rgba(255,255,255,0.6)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn: { flex: 1, padding: '10px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  guestSelector: { padding: '9px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', cursor: 'pointer', minHeight: '38px', display: 'flex', alignItems: 'center' },
  guestDropdownList: { position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e1e36', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', marginTop: '4px', maxHeight: '200px', overflow: 'auto', zIndex: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' },
  guestDropdownItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', cursor: 'pointer', transition: 'background 0.1s' },
  guestDropdownAvatar: { width: '28px', height: '28px', borderRadius: '8px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: '#fff', flexShrink: 0 },
  guestTag: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '6px', color: '#a5b4fc', fontSize: '11px', fontWeight: 600 },
  guestTagRemove: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '10px', padding: '0 2px' },
  // Event detail card
  eventDetailCard: { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '20px', width: '400px', maxWidth: '95vw', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' },
  eventDetailRow: { display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '12px' },
  eventDetailLabel: { fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  eventEditBtn: { flex: 1, padding: '9px', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '8px', color: '#a5b4fc', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  eventDeleteBtn: { flex: 1, padding: '9px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#fca5a5', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
};
