import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import usePersistedTab from '../hooks/usePersistedTab';
import { colors } from '../lib/styleTokens';
import {
  PT_TZ, getPTparts, toPTDateKey, getPTMinutesSinceMidnight,
  formatPTTime, toPTTimeString, ptToDate, getPTDayOfWeek,
  ptToday, anchorKey, addDays, addMonths,
} from '../lib/ptTime';
import { guestJoinLink } from '../lib/harbor/session';


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

const EVENT_TYPES = ['deadline', 'meeting', 'live_recording', 'filming', 'video_post', 'tmbb_video', 'unavailable'];
// Video events that mirror a project's Post Date (projects.calendar_event_id).
const VIDEO_EVENT_TYPES = ['video_post', 'tmbb_video'];
const EVENT_TYPE_COLORS = {
  deadline: '#ef4444',
  meeting: '#3b82f6',
  live_recording: '#22c55e',
  filming: '#f59e0b',
  video_post: '#a855f7',
  tmbb_video: '#06b6d4',
  unavailable: '#6b7280',
};
const EVENT_TYPE_LABELS = {
  deadline: 'Deadline',
  meeting: 'Meeting',
  live_recording: 'Live/Recording',
  filming: 'Filming/Recording',
  video_post: 'Mayday Video',
  tmbb_video: 'TMBB Video',
  unavailable: 'Unavailable',
};
const EVENT_TYPE_ICONS = {
  deadline: '\u23F0',
  meeting: '\uD83D\uDC65',
  live_recording: '\uD83D\uDD34',
  filming: '\uD83C\uDFAC',
  video_post: '\uD83D\uDCF9',
  tmbb_video: '\uD83C\uDFA5',
  unavailable: '\uD83D\uDEAB',
};

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Annually' },
  { value: 'weekdays', label: 'Every weekday (Mon\u2013Fri)' },
  { value: 'custom', label: 'Custom...' },
];

const EMPTY_EVENT_FORM = {
  title: '',
  description: '',
  event_type: 'meeting',
  start_date: '',
  start_time: '09:00',
  end_date: '',
  end_time: '09:30',
  all_day: false,
  location: '',
  is_meeting: false,
  guests: [],
  recurrence: 'none',
  recurrence_interval: 1,
  recurrence_days: [],
  recurrence_end_type: 'never',
  recurrence_end_date: '',
  recurrence_end_count: 10,
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 60;

// ── Pacific Time utilities ──
function formatHourLabel(h) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function expandRecurringEvents(events, rangeStart, rangeEnd) {
  const result = [];
  // Loop safety bound. Separate from a series' `endCount`: counts iteration
  // steps (incl. pre-window occurrences), so it must be large enough not to
  // truncate a long-running daily series before it reaches the visible window.
  const MAX_ITERATIONS = 20000;
  events.forEach(ev => {
    if (!ev.recurrence_rule || ev.recurrence_rule.type === 'none') {
      result.push(ev);
      return;
    }
    const rule = ev.recurrence_rule;
    const origStart = new Date(ev.start_date);
    const origEnd = new Date(ev.end_date);
    const duration = origEnd.getTime() - origStart.getTime();
    const interval = rule.interval || 1;
    const endDate = rule.endDate ? new Date(rule.endDate + 'T23:59:59') : null;
    const endCount = rule.endCount || 999;
    let count = 0;       // series occurrence number (drives endCount + ids)
    let iterations = 0;  // loop-safety counter (drives MAX_ITERATIONS)
    let cursor = new Date(origStart);

    const excludedDates = new Set((rule.excludedDates || []).map(d => d.split('T')[0]));
    const origTimeStr = toPTTimeString(origStart);

    function addOccurrence(d) {
      const occDateKey = toPTDateKey(d);
      const occStart = ptToDate(occDateKey, origTimeStr);
      const occEnd = new Date(occStart.getTime() + duration);
      // Series-termination checks run BEFORE the range cull so `count` reflects
      // occurrences from the series start, not just the visible window. Otherwise
      // an "ends after N" rule would render up to N occurrences in every month.
      if (endDate && occStart > endDate) return false;
      if (rule.endType === 'count' && count >= endCount) return false;
      count++;
      // Past the visible window: stop expanding (already counted toward series).
      if (occStart > rangeEnd) return false;
      // Before the window: counted, but not rendered.
      if (occEnd < rangeStart) return true;
      if (excludedDates.has(occDateKey)) return true;
      result.push({
        ...ev,
        id: count === 1 && occStart.getTime() === origStart.getTime() ? ev.id : `${ev.id}_r${count}`,
        start_date: occStart.toISOString(),
        end_date: occEnd.toISOString(),
        _isRecurrenceInstance: count > 1 || occStart.getTime() !== origStart.getTime(),
        _parentId: ev.id,
      });
      return true;
    }

    const safeEnd = new Date(Math.min(rangeEnd.getTime(), endDate ? endDate.getTime() : rangeEnd.getTime()));
    safeEnd.setFullYear(safeEnd.getFullYear() + 1);

    if (rule.type === 'daily') {
      while (cursor <= safeEnd && iterations++ < MAX_ITERATIONS) {
        if (addOccurrence(cursor) === false) break;
        cursor.setDate(cursor.getDate() + interval);
      }
    } else if (rule.type === 'weekly') {
      const days = rule.daysOfWeek && rule.daysOfWeek.length > 0 ? rule.daysOfWeek : [getPTDayOfWeek(origStart)];
      let weekCursor = new Date(cursor);
      weekCursor.setDate(weekCursor.getDate() - weekCursor.getDay());
      while (weekCursor <= safeEnd && iterations < MAX_ITERATIONS) {
        for (const dow of [...days].sort((a, b) => a - b)) {
          iterations++;
          const d = new Date(weekCursor);
          d.setDate(d.getDate() + dow);
          if (d < origStart) continue;
          if (d > safeEnd) break;
          if (addOccurrence(d) === false) break;
          if (iterations >= MAX_ITERATIONS) break;
        }
        weekCursor.setDate(weekCursor.getDate() + 7 * interval);
      }
    } else if (rule.type === 'weekdays') {
      while (cursor <= safeEnd && iterations++ < MAX_ITERATIONS) {
        const dow = getPTDayOfWeek(cursor);
        if (dow >= 1 && dow <= 5) {
          if (addOccurrence(cursor) === false) break;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    } else if (rule.type === 'monthly') {
      const dayOfMonth = origStart.getDate();
      while (cursor <= safeEnd && iterations++ < MAX_ITERATIONS) {
        const d = new Date(cursor.getFullYear(), cursor.getMonth(), dayOfMonth);
        if (d.getMonth() !== cursor.getMonth()) {
          cursor.setMonth(cursor.getMonth() + interval, 1);
          continue;
        }
        if (d >= origStart) {
          if (addOccurrence(d) === false) break;
        }
        cursor.setMonth(cursor.getMonth() + interval, 1);
      }
    } else if (rule.type === 'yearly') {
      while (cursor <= safeEnd && iterations++ < MAX_ITERATIONS) {
        if (cursor >= origStart) {
          if (addOccurrence(cursor) === false) break;
        }
        cursor.setFullYear(cursor.getFullYear() + interval);
      }
    }
  });
  return result;
}

export default function Calendar({ onNavigate }) {
  const { profile, isAdmin, refreshKey } = useAuth();
  const confirm = useConfirm();
  const [projects, setProjects] = useState([]);
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [hubUsers, setHubUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  // viewDate is a PT day anchor (lib/ptTime), not a device-local Date. Cells
  // built at local midnight resolve to the previous PT day for anyone east of
  // Pacific, which shifted their whole calendar by a day.
  const [viewDate, setViewDate] = useState(() => ptToday());
  const [viewMode, setViewMode] = usePersistedTab('calendar-view', 'month', ['month', 'week', 'day']);
  const [showMetricool, setShowMetricool] = useState(true);
  const [metricoolError, setMetricoolError] = useState(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventForm, setEventForm] = useState(EMPTY_EVENT_FORM);
  const [savingEvent, setSavingEvent] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [copiedMeetingLinkId, setCopiedMeetingLinkId] = useState(null); // eventId of last-copied guest link
  const [showGuestDropdown, setShowGuestDropdown] = useState(false);
  // Screen coords + width for the guest dropdown. Position: fixed so it
  // escapes the event modal's overflow:auto instead of being clipped.
  // Clamped so the 200px-max list never runs off the viewport.
  const [guestDropdownPos, setGuestDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const openGuestDropdownAt = (el) => {
    const r = el.getBoundingClientRect();
    setGuestDropdownPos({
      top: Math.min(r.bottom + 4, window.innerHeight - 208),
      left: Math.min(r.left, window.innerWidth - r.width - 8),
      width: r.width,
    });
  };
  // Same fixed-position escape for the "+ Assign Deliverable" dropdown,
  // which otherwise gets clipped by the event modal's overflow:auto.
  const [deliverableDropdownPos, setDeliverableDropdownPos] = useState({ top: 0, left: 0 });
  const openDeliverableDropdownAt = (el) => {
    const r = el.getBoundingClientRect();
    setDeliverableDropdownPos({
      top: Math.min(r.bottom + 4, window.innerHeight - 208),
      left: Math.min(r.left, window.innerWidth - 268),
    });
  };
  const [expandedSocialDays, setExpandedSocialDays] = useState({});
  const [showCustomRecurrence, setShowCustomRecurrence] = useState(false);
  const [recurrencePrompt, setRecurrencePrompt] = useState(null); // { action: 'edit'|'delete', event }
  const [contextMenu, setContextMenu] = useState(null); // { x, y, event }
  const [showFilters, setShowFilters] = useState(false);
  const [visibleFilters, setVisibleFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('calendar_filters');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { substack_article: true, deadline: true, meeting: true, live_recording: true, filming: true, video_post: true, tmbb_video: true, unavailable: true, social_posts: true };
  });
  const [dragOverDate, setDragOverDate] = useState(null);
  const [videoDeliverables, setVideoDeliverables] = useState([]);
  const [unassignedDeliverables, setUnassignedDeliverables] = useState([]);
  const [showDeliverableDropdown, setShowDeliverableDropdown] = useState(false);
  const deliverableDropdownRef = useRef(null);
  const modalRef = useRef(null);
  const guestDropdownRef = useRef(null);
  const timeGridRef = useRef(null);
  const dragEventRef = useRef(null);
  const initialEventFormRef = useRef(null);
  const contextMenuRef = useRef(null);

  // ── Time-grid drag state (Week / Day views) ──
  const [timeDrag, setTimeDrag] = useState(null);
  const timeDragRef = useRef(null);
  const wasDragging = useRef(false);

  useEffect(() => {
    try { localStorage.setItem('calendar_filters', JSON.stringify(visibleFilters)); } catch {}
  }, [visibleFilters]);

  function toggleFilter(key) {
    setVisibleFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // The fixed-positioned guest dropdown doesn't follow the modal when it
  // scrolls — close instead of drifting. Scrolls inside the list are fine.
  useEffect(() => {
    if (!showGuestDropdown) return;
    const onScroll = (e) => {
      if (e.target instanceof Element && e.target.closest('[data-guest-dropdown]')) return;
      setShowGuestDropdown(false);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [showGuestDropdown]);

  useEffect(() => {
    function handleClick(e) {
      if (guestDropdownRef.current && !guestDropdownRef.current.contains(e.target)) {
        setShowGuestDropdown(false);
      }
      if (deliverableDropdownRef.current && !deliverableDropdownRef.current.contains(e.target)) {
        setShowDeliverableDropdown(false);
      }
      // Don't dismiss the context menu when the click lands inside it, or its
      // items would unmount on mousedown before their onClick fires.
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target)) return;
      setContextMenu(null);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('projects').select('*').eq('type', 'substack_article').order('start_date', { ascending: true });
      if (error) throw error;
      setProjects(data || []);
    } catch (err) {
      console.error('Error:', err);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCalendarEvents = useCallback(async () => {
    try {
      const { start, end } = getVisibleRange();
      const bufferStart = new Date(start);
      bufferStart.setDate(bufferStart.getDate() - 7);
      const bufferEnd = new Date(end);
      bufferEnd.setDate(bufferEnd.getDate() + 7);
      // Fetch non-recurring events in the visible range, plus ALL recurring
      // events (whose occurrences may extend into the visible range even though
      // their original start/end dates don't overlap it).
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*, creator:profiles!created_by(id, full_name)')
        // `not.is.null` — NOT `neq.null`, which PostgREST compiles to `<> NULL`
        // (never true), silently dropping every recurring series from months
        // whose base row doesn't overlap the window.
        .or(`and(end_date.gte.${bufferStart.toISOString()},start_date.lte.${bufferEnd.toISOString()}),recurrence_rule.not.is.null`)
        .order('start_date', { ascending: true });
      if (error) throw error;
      setCalendarEvents(data || []);
    } catch (err) {
      console.error('Error fetching events:', err);
      setCalendarEvents([]);
    }
  }, [viewDate, viewMode]);

  const fetchHubUsers = useCallback(async () => {
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
  }, []);

  const fetchVideoDeliverables = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('sponsor_deliverables')
        .select('*, sponsor:sponsors(name), campaign:sponsor_campaigns(name)')
        .not('video_event_id', 'is', null);
      if (error) throw error;
      setVideoDeliverables(data || []);
    } catch (err) {
      console.error('Error fetching video deliverables:', err);
    }
  }, []);

  const fetchUnassignedDeliverables = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('sponsor_deliverables')
        .select('*, sponsor:sponsors(name), campaign:sponsor_campaigns(name)')
        .is('video_event_id', null)
        .eq('delivered', false);
      if (error) throw error;
      setUnassignedDeliverables(data || []);
    } catch (err) {
      console.error('Error fetching unassigned deliverables:', err);
    }
  }, []);

  const handleAttachDeliverable = useCallback(async (deliverableId, event) => {
    let targetEventId = event.id;

    // If this is a recurring instance, materialize it as a standalone event
    if (event._isRecurrenceInstance) {
      const parentId = event._parentId;
      const parent = calendarEvents.find(e => e.id === parentId);

      // Create standalone copy of this occurrence
      const { data: newEvent, error: insertErr } = await supabase.from('calendar_events')
        .insert({
          title: parent?.title || event.title,
          description: parent?.description || event.description || null,
          event_type: event.event_type,
          start_date: event.start_date,
          end_date: event.end_date,
          all_day: event.all_day || false,
          location: parent?.location || event.location || null,
          guests: parent?.guests || event.guests || [],
          created_by: profile.id,
        })
        .select('id')
        .single();
      if (insertErr || !newEvent) {
        console.error('Error materializing recurring instance:', insertErr);
        return;
      }
      targetEventId = newEvent.id;

      // Exclude this date from the parent's recurrence
      if (parent?.recurrence_rule) {
        const dateKey = toPTDateKey(new Date(event.start_date));
        const rule = { ...parent.recurrence_rule };
        rule.excludedDates = [...(rule.excludedDates || []), dateKey];
        await supabase.from('calendar_events')
          .update({ recurrence_rule: rule })
          .eq('id', parentId);
      }
    }

    await supabase.from('sponsor_deliverables')
      .update({ video_event_id: targetEventId })
      .eq('id', deliverableId);
    fetchCalendarEvents();
    fetchVideoDeliverables();
    fetchUnassignedDeliverables();
  }, [calendarEvents, profile.id, fetchCalendarEvents, fetchVideoDeliverables, fetchUnassignedDeliverables]);

  const handleDetachDeliverable = useCallback(async (deliverableId) => {
    await supabase.from('sponsor_deliverables')
      .update({ video_event_id: null })
      .eq('id', deliverableId);
    fetchVideoDeliverables();
    fetchUnassignedDeliverables();
  }, [fetchVideoDeliverables, fetchUnassignedDeliverables]);

  useEffect(() => {
    Promise.all([fetchProjects(), fetchCalendarEvents(), fetchHubUsers(), fetchVideoDeliverables(), fetchUnassignedDeliverables()]);
  }, [fetchProjects, fetchCalendarEvents, fetchHubUsers, fetchVideoDeliverables, fetchUnassignedDeliverables]);
  useVisibilityRefresh(useCallback(() => {
    fetchProjects();
    fetchCalendarEvents();
    fetchHubUsers();
    fetchVideoDeliverables();
    fetchUnassignedDeliverables();
  }, [fetchProjects, fetchCalendarEvents, fetchHubUsers, fetchVideoDeliverables, fetchUnassignedDeliverables]));

  // Realtime: keep deliverables in sync across users
  useEffect(() => {
    const channel = supabase
      .channel('calendar-deliverables')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_deliverables' }, () => {
        fetchVideoDeliverables();
        fetchUnassignedDeliverables();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchVideoDeliverables, fetchUnassignedDeliverables]);

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
      // The endpoint is told timezone=America/Los_Angeles, so send PT wall-clock
      // datetimes, not UTC (toISOString() shifted the window ~7-8h, dropping
      // early-morning first-day posts off the grid).
      const ptWall = (d) => new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).format(d).replace(', ', 'T');
      const startStr = ptWall(start);
      const endStr = ptWall(end);
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

  const deliverablesByEventId = useMemo(() => {
    const map = {};
    videoDeliverables.forEach(d => {
      if (!d.video_event_id) return;
      if (!map[d.video_event_id]) map[d.video_event_id] = [];
      map[d.video_event_id].push(d);
    });
    return map;
  }, [videoDeliverables]);

  async function handleEventDrop(targetDate) {
    const ev = dragEventRef.current;
    dragEventRef.current = null;
    setDragOverDate(null);
    if (!ev || ev._isRecurrenceInstance) return;
    const origStart = new Date(ev.start_date);
    const origEnd = new Date(ev.end_date);
    const duration = origEnd.getTime() - origStart.getTime();
    const targetKey = toPTDateKey(targetDate);
    const origTimeStr = toPTTimeString(origStart);
    const newStart = ptToDate(targetKey, origTimeStr);
    const newEnd = new Date(newStart.getTime() + duration);
    await supabase.from('calendar_events')
      .update({ start_date: newStart.toISOString(), end_date: newEnd.toISOString() })
      .eq('id', ev.id);
    await syncVideoEventToProject(ev.id, ev.event_type, newStart);
    fetchCalendarEvents();
  }

  // ── Reverse sync: video event ↔ linked project Post Date ──
  // A video event (video_post / tmbb_video) can be linked to a project via
  // projects.calendar_event_id. When the event's date/time changes here, write
  // the new Post Date (deadline = PT date, post_time = PT "HH:MM") back onto the
  // project so the Projects card stays in sync. Discrete user actions only — no
  // realtime echo — and writing projects.deadline never re-triggers the
  // project→event path (that only fires from the Projects page UI).
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
    if (proj.deadline === deadline && proj.post_time === postTime) return; // no-op guard
    await supabase.from('projects')
      .update({ deadline, post_time: postTime })
      .eq('id', proj.id);
  }

  // ── Week/Day time-grid drag-and-drop ──
  function handleTimeDragStart(e, ev, dayDate) {
    if (ev._isRecurrenceInstance) return;
    e.preventDefault();
    e.stopPropagation();
    const evStart = new Date(ev.start_date);
    const evEnd = new Date(ev.end_date);
    const startMin = getPTMinutesSinceMidnight(evStart);
    const durationMin = Math.round((evEnd.getTime() - evStart.getTime()) / 60000);
    const rect = e.currentTarget.closest('[data-timegrid]')?.getBoundingClientRect();
    if (!rect) return;
    const info = {
      event: ev,
      originDateKey: toPTDateKey(dayDate),
      originMinutes: startMin,
      currentMinutes: startMin,
      currentDateKey: toPTDateKey(dayDate),
      durationMin,
      gridRect: rect,
      pointerOffsetY: e.clientY - e.currentTarget.getBoundingClientRect().top,
    };
    timeDragRef.current = info;
    setTimeDrag(info);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  // Document-level listeners for drag
  useEffect(() => {
    function onMove(e) {
      const drag = timeDragRef.current;
      if (!drag) return;
      e.preventDefault();
      const scrollTop = timeGridRef.current?.scrollTop || 0;
      const gridRect = timeGridRef.current?.getBoundingClientRect();
      if (!gridRect) return;
      const y = e.clientY - gridRect.top + scrollTop;
      const rawMinutes = (y - drag.pointerOffsetY) / HOUR_HEIGHT * 60;
      const snapped = Math.max(0, Math.min(1440 - drag.durationMin, Math.round(rawMinutes / 15) * 15));

      // Determine which day column for week view
      const gutterWidth = 56;
      const colAreaLeft = gridRect.left + gutterWidth;
      const colAreaWidth = gridRect.width - gutterWidth;
      let newDateKey = drag.originDateKey;
      if (viewMode === 'week' && colAreaWidth > 0) {
        const colX = e.clientX - colAreaLeft;
        const colIdx = Math.max(0, Math.min(6, Math.floor((colX / colAreaWidth) * 7)));
        const weekDays = getWeekDays();
        newDateKey = dk(weekDays[colIdx]);
      }

      const updated = { ...drag, currentMinutes: snapped, currentDateKey: newDateKey };
      timeDragRef.current = updated;
      setTimeDrag(updated);
    }

    function onUp(e) {
      const drag = timeDragRef.current;
      timeDragRef.current = null;
      setTimeDrag(null);
      if (!drag) return;
      const moved = drag.currentMinutes !== drag.originMinutes || drag.currentDateKey !== drag.originDateKey;
      if (moved) {
        wasDragging.current = true;
        setTimeout(() => { wasDragging.current = false; }, 0);
        // Compute new times and save
        const h = Math.floor(drag.currentMinutes / 60);
        const m = drag.currentMinutes % 60;
        const startTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const newStart = ptToDate(drag.currentDateKey, startTime);
        const newEnd = new Date(newStart.getTime() + drag.durationMin * 60000);
        supabase.from('calendar_events')
          .update({ start_date: newStart.toISOString(), end_date: newEnd.toISOString() })
          .eq('id', drag.event.id)
          .then(({ error }) => {
            if (error) console.error('Drag save error:', error);
            syncVideoEventToProject(drag.event.id, drag.event.event_type, newStart)
              .then(() => fetchCalendarEvents());
          });
        syncToGoogleCalendar('update', drag.event.id);
      } else {
        wasDragging.current = true;
        setTimeout(() => { wasDragging.current = false; }, 0);
      }
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [viewMode]);

  async function syncToGoogleCalendar(action, eventId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-calendar-sync`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action, event_id: eventId }),
        }
      );
    } catch (err) {
      console.error('Google Calendar sync error:', err);
    }
  }

  async function handleSaveEvent() {
    if (!eventForm.title.trim() || !eventForm.start_date || !profile?.id) return;
    setSavingEvent(true);
    try {
      const startDate = eventForm.all_day
        ? ptToDate(eventForm.start_date, '00:00')
        : ptToDate(eventForm.start_date, eventForm.start_time);
      const endDateStr = eventForm.end_date || eventForm.start_date;
      const endDate = eventForm.all_day
        ? ptToDate(endDateStr, '23:59')
        : ptToDate(endDateStr, eventForm.end_time);

      // Preserve excludedDates when editing an existing recurring event
      const existingRule = editingEventId
        ? calendarEvents.find(e => e.id === editingEventId)?.recurrence_rule
        : null;
      const recurrenceRule = eventForm.recurrence === 'none' ? null : {
        type: eventForm.recurrence,
        interval: eventForm.recurrence_interval || 1,
        daysOfWeek: eventForm.recurrence === 'weekly' || eventForm.recurrence === 'custom'
          ? (eventForm.recurrence_days.length > 0 ? eventForm.recurrence_days : [getPTDayOfWeek(startDate)])
          : undefined,
        endType: eventForm.recurrence_end_type || 'never',
        endDate: eventForm.recurrence_end_type === 'date' ? eventForm.recurrence_end_date : undefined,
        endCount: eventForm.recurrence_end_type === 'count' ? eventForm.recurrence_end_count : undefined,
        ...(existingRule?.excludedDates?.length ? { excludedDates: existingRule.excludedDates } : {}),
      };

      const payload = {
        title: eventForm.title.trim(),
        description: eventForm.description.trim(),
        event_type: eventForm.event_type,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        all_day: eventForm.all_day,
        location: eventForm.location.trim(),
        is_meeting: eventForm.is_meeting,
        guests: eventForm.guests,
        recurrence_rule: recurrenceRule,
      };

      let eventId = editingEventId;
      if (editingEventId) {
        const { error } = await supabase.from('calendar_events').update(payload).eq('id', editingEventId);
        if (error) throw error;
        // Reverse sync: if this edited event is a video event linked to a
        // project, write its new Post Date back onto the project.
        await syncVideoEventToProject(editingEventId, payload.event_type, startDate);
      } else {
        const { data: inserted, error } = await supabase.from('calendar_events').insert({ ...payload, created_by: profile.id }).select('id').single();
        if (error) throw error;
        eventId = inserted.id;
      }

      // Sync to Google Calendar (fire-and-forget)
      syncToGoogleCalendar(editingEventId ? 'update' : 'create', eventId);

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
    if (!(await confirm('Delete this event?'))) return;
    try {
      // If a video event linked to a project is being deleted, clear that
      // project's Post Date too (fully two-way). Capture the link BEFORE the
      // row is gone — calendar_event_id also nulls via ON DELETE SET NULL, but
      // we clear deadline/post_time (and the FK) explicitly.
      const delEvent = calendarEvents.find(e => e.id === eventId);
      let linkedProjectId = null;
      if (delEvent && VIDEO_EVENT_TYPES.includes(delEvent.event_type)) {
        const { data: proj } = await supabase.from('projects')
          .select('id').eq('calendar_event_id', eventId).maybeSingle();
        linkedProjectId = proj?.id || null;
      }
      await syncToGoogleCalendar('delete', eventId);
      const { error } = await supabase.from('calendar_events').delete().eq('id', eventId);
      if (error) throw error;
      if (linkedProjectId) {
        await supabase.from('projects')
          .update({ deadline: null, post_time: null, calendar_event_id: null })
          .eq('id', linkedProjectId);
      }
      setSelectedEvent(null);
      fetchCalendarEvents();
    } catch (err) {
      console.error('Error deleting event:', err);
    }
  }

  async function handleDeleteSingleOccurrence(ev) {
    const parentId = ev._parentId || ev.id;
    const parent = calendarEvents.find(e => e.id === parentId);
    if (!parent) return;
    const dateKey = toPTDateKey(new Date(ev.start_date));
    const rule = { ...parent.recurrence_rule };
    rule.excludedDates = [...(rule.excludedDates || []), dateKey];
    try {
      const { error } = await supabase.from('calendar_events')
        .update({ recurrence_rule: rule }).eq('id', parentId);
      if (error) throw error;
      setSelectedEvent(null);
      setRecurrencePrompt(null);
      fetchCalendarEvents();
    } catch (err) {
      console.error('Error excluding occurrence:', err);
    }
  }

  function handleEditSingleOccurrence(ev) {
    // Open modal pre-filled with this occurrence's data, but as a NEW standalone event
    const startD = new Date(ev.start_date);
    const endD = new Date(ev.end_date);
    const parentId = ev._parentId || ev.id;
    const parent = calendarEvents.find(e => e.id === parentId) || ev;
    setEventForm({
      title: parent.title || '',
      description: parent.description || '',
      event_type: parent.event_type || 'meeting',
      start_date: toPTDateKey(startD),
      start_time: toPTTimeString(startD),
      end_date: toPTDateKey(endD),
      end_time: toPTTimeString(endD),
      all_day: parent.all_day || false,
      location: parent.location || '',
      // A detached one-off doesn't inherit meeting-ness — the series keeps its
      // room; the user can opt this instance into its own room explicitly.
      is_meeting: false,
      guests: parent.guests || [],
      recurrence: 'none',
      recurrence_interval: 1,
      recurrence_days: [],
      recurrence_end_type: 'never',
      recurrence_end_date: '',
      recurrence_end_count: 10,
    });
    // Store info to exclude this date from parent after save
    setEditingEventId(null);
    setShowEventModal(true);
    setSelectedEvent(null);
    setShowGuestDropdown(false);
    setShowCustomRecurrence(false);
    // Exclude the date from parent series
    const dateKey = toPTDateKey(startD);
    const rule = { ...(parent.recurrence_rule || {}) };
    rule.excludedDates = [...(rule.excludedDates || []), dateKey];
    supabase.from('calendar_events')
      .update({ recurrence_rule: rule }).eq('id', parentId)
      .then(({ error }) => { if (error) console.error('Error excluding date:', error); });
    setRecurrencePrompt(null);
  }

  function promptRecurrenceAction(action, ev) {
    const isRecurring = ev.recurrence_rule && ev.recurrence_rule.type !== 'none';
    if (!isRecurring) {
      if (action === 'edit') openEditEventModal(ev);
      else handleDeleteEvent(ev._parentId || ev.id);
      return;
    }
    setRecurrencePrompt({ action, event: ev });
  }

  function openNewEventModal(date) {
    const dateStr = dk(date);
    const form = { ...EMPTY_EVENT_FORM, start_date: dateStr, end_date: dateStr };
    initialEventFormRef.current = form;
    setEventForm(form);
    setEditingEventId(null);
    setShowEventModal(true);
    setSelectedEvent(null);
    setShowGuestDropdown(false);
    setShowCustomRecurrence(false);
  }

  function openNewEventModalAtTime(date, totalMinutes) {
    const dateStr = dk(date);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const startTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const endTotal = totalMinutes + 30;
    const endHour = endTotal >= 1440 ? 23 : Math.floor(endTotal / 60);
    const endMin = endTotal >= 1440 ? 59 : endTotal % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
    const form = { ...EMPTY_EVENT_FORM, start_date: dateStr, end_date: dateStr, start_time: startTime, end_time: endTime };
    initialEventFormRef.current = form;
    setEventForm(form);
    setEditingEventId(null);
    setShowEventModal(true);
    setSelectedEvent(null);
    setShowGuestDropdown(false);
    setShowCustomRecurrence(false);
  }

  function openEditEventModal(ev) {
    const editId = ev._parentId || ev.id;
    const parentEv = ev._isRecurrenceInstance
      ? calendarEvents.find(e => e.id === ev._parentId) || ev
      : ev;
    const startD = new Date(parentEv.start_date);
    const endD = new Date(parentEv.end_date);
    const rule = parentEv.recurrence_rule;
    const editForm = {
      title: parentEv.title || '',
      description: parentEv.description || '',
      event_type: parentEv.event_type || 'meeting',
      start_date: toPTDateKey(startD),
      start_time: toPTTimeString(startD),
      end_date: toPTDateKey(endD),
      end_time: toPTTimeString(endD),
      all_day: parentEv.all_day || false,
      location: parentEv.location || '',
      is_meeting: parentEv.is_meeting || false,
      guests: parentEv.guests || [],
      recurrence: rule?.type || 'none',
      recurrence_interval: rule?.interval || 1,
      recurrence_days: rule?.daysOfWeek || [],
      recurrence_end_type: rule?.endType || 'never',
      recurrence_end_date: rule?.endDate || '',
      recurrence_end_count: rule?.endCount || 10,
    };
    initialEventFormRef.current = editForm;
    setEventForm(editForm);
    setEditingEventId(editId);
    setShowEventModal(true);
    setSelectedEvent(null);
    setShowGuestDropdown(false);
    setShowCustomRecurrence(false);
  }

  // Fetch the linked Harbor session's guest_token on demand and copy an
  // external join link (kept off calendar_events — the token lives on the
  // session and rotates independently).
  async function copyMeetingGuestLink(sessionId, eventId) {
    try {
      const { data, error } = await supabase
        .from('harbor_sessions')
        .select('guest_token')
        .eq('id', sessionId)
        .maybeSingle();
      if (error || !data?.guest_token) throw error || new Error('No guest token');
      await navigator.clipboard.writeText(guestJoinLink(data.guest_token));
      setCopiedMeetingLinkId(eventId);
      setTimeout(() => setCopiedMeetingLinkId((cur) => (cur === eventId ? null : cur)), 2000);
    } catch (err) {
      console.error('Calendar: copy meeting guest link failed:', err);
    }
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
    return { start: ptToDate(anchorKey(viewDate), '00:00'), end: ptToDate(anchorKey(viewDate), '23:59') };
  }

  function getMonthRange() {
    const year = viewDate.getUTCFullYear();
    const month = viewDate.getUTCMonth();
    return { start: new Date(Date.UTC(year, month, 1, 12)), end: new Date(Date.UTC(year, month + 1, 0, 12)) };
  }

  function getCalendarDays() {
    const year = viewDate.getUTCFullYear();
    const month = viewDate.getUTCMonth();
    const firstDay = new Date(Date.UTC(year, month, 1, 12));
    const gridStart = addDays(firstDay, -firstDay.getUTCDay());
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      days.push({ date: d, isCurrentMonth: d.getUTCMonth() === month && d.getUTCFullYear() === year });
    }
    return days;
  }

  function getWeekDays() {
    const start = addDays(viewDate, -viewDate.getUTCDay());
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(start, i));
    return days;
  }

  function dk(d) {
    return toPTDateKey(d);
  }

  function navigate(dir) {
    let d;
    if (viewMode === 'month') d = addMonths(viewDate, dir);
    else if (viewMode === 'week') d = addDays(viewDate, dir * 7);
    else d = addDays(viewDate, dir);
    setViewDate(d);
  }

  const expandedEvents = React.useMemo(() => {
    const { start, end } = getVisibleRange();
    const bufferStart = new Date(start);
    bufferStart.setDate(bufferStart.getDate() - 7);
    const bufferEnd = new Date(end);
    bufferEnd.setDate(bufferEnd.getDate() + 7);
    return expandRecurringEvents(calendarEvents, bufferStart, bufferEnd);
  }, [calendarEvents, viewDate, viewMode]);

  function getEventsForDate(date) {
    const dateKey = dk(date);
    const dayStart = ptToDate(dateKey, '00:00');
    const dayEnd = new Date(ptToDate(dateKey, '23:59').getTime() + 59 * 1000);
    return expandedEvents.filter(ev => {
      const evStart = new Date(ev.start_date);
      const evEnd = new Date(ev.end_date);
      if (evStart > dayEnd || evEnd < dayStart) return false;
      if (!visibleFilters[ev.event_type]) return false;
      return true;
    });
  }

  function formatEventTime(ev) {
    if (ev.all_day) return 'All day';
    return formatPTTime(new Date(ev.start_date));
  }

  function getViewTitle() {
    const tzOpt = { timeZone: PT_TZ };
    if (viewMode === 'month') {
      return viewDate.toLocaleDateString('en-US', { ...tzOpt, month: 'long', year: 'numeric' });
    }
    if (viewMode === 'week') {
      const days = getWeekDays();
      const s = days[0];
      const e = days[6];
      const sp = getPTparts(s);
      const ep = getPTparts(e);
      if (sp.month === ep.month) {
        return `${s.toLocaleDateString('en-US', { ...tzOpt, month: 'short' })} ${sp.day} \u2013 ${ep.day}, ${ep.year}`;
      }
      return `${s.toLocaleDateString('en-US', { ...tzOpt, month: 'short', day: 'numeric' })} \u2013 ${e.toLocaleDateString('en-US', { ...tzOpt, month: 'short', day: 'numeric' })}, ${ep.year}`;
    }
    return viewDate.toLocaleDateString('en-US', { ...tzOpt, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  const calendarDays = getCalendarDays();
  const weeks = [];
  for (let i = 0; i < calendarDays.length; i += 7) weeks.push(calendarDays.slice(i, i + 7));

  function getProjectBarsForWeek(week) {
    const weekStart = dk(week[0].date);
    const weekEnd = dk(week[6].date);
    const bars = [];

    if (!visibleFilters.substack_article) return { bars: [], rowCount: 0 };

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
    return scheduledPosts.filter(p => {
      const dt = typeof p.publicationDate === 'string' ? p.publicationDate : p.publicationDate?.dateTime;
      return dt?.startsWith(d);
    });
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

  function showPostTooltip(e, post) {
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveTooltip({ type: 'post', data: post, x: rect.left + rect.width / 2, y: rect.top - 4 });
  }

  function hideTooltip() { setActiveTooltip(null); }

  function handleEventClick(e, ev) {
    e.stopPropagation();
    setActiveTooltip(null);
    setSelectedEvent(selectedEvent?.id === ev.id ? null : ev);
  }

  function handleEventContextMenu(e, ev) {
    e.preventDefault();
    e.stopPropagation();
    setActiveTooltip(null);
    setSelectedEvent(null);
    setContextMenu({ x: e.clientX, y: e.clientY, event: ev });
  }

  async function handleDuplicateEvent(ev) {
    const sourceEv = ev._isRecurrenceInstance
      ? calendarEvents.find(e => e.id === ev._parentId) || ev
      : ev;
    try {
      const payload = {
        title: `${sourceEv.title} (copy)`,
        description: sourceEv.description || '',
        event_type: sourceEv.event_type,
        start_date: sourceEv.start_date,
        end_date: sourceEv.end_date,
        all_day: sourceEv.all_day || false,
        location: sourceEv.location || '',
        guests: sourceEv.guests || [],
        recurrence_rule: null,
        created_by: profile.id,
      };
      const { error } = await supabase.from('calendar_events').insert(payload);
      if (error) throw error;
      fetchCalendarEvents();
    } catch (err) {
      console.error('Error duplicating event:', err);
      alert('Failed to duplicate event: ' + err.message);
    }
  }

  function getUserName(userId) {
    const u = hubUsers.find(u => u.id === userId);
    return u ? (u.title ? `${u.full_name} · ${u.title}` : u.full_name) : 'Unknown';
  }

  // ── Event chip renderer (shared across views) ──
  function renderEventChip(ev, opts = {}) {
    const color = EVENT_TYPE_COLORS[ev.event_type] || '#6b7280';
    const icon = EVENT_TYPE_ICONS[ev.event_type] || '\u2022';
    const isRecurring = ev.recurrence_rule && ev.recurrence_rule.type !== 'none';
    const isDraggable = !ev._isRecurrenceInstance;
    return (
      <div
        key={`ev-${ev.id}`}
        draggable={isDraggable}
        onDragStart={(e) => { e.stopPropagation(); dragEventRef.current = ev; }}
        style={{
          ...styles.eventChip,
          background: `${color}20`,
          borderColor: `${color}50`,
          cursor: isDraggable ? 'grab' : 'pointer',
        }}
        onClick={(e) => handleEventClick(e, ev)}
        onContextMenu={(e) => handleEventContextMenu(e, ev)}
      >
        <span style={{ fontSize: '9px', flexShrink: 0 }}>{icon}</span>
        {!ev.all_day && <span style={{ fontSize: '9px', flexShrink: 0, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{formatPTTime(new Date(ev.start_date))}</span>}
        <span style={{ ...styles.eventChipText, color }}>
          {ev.title}
        </span>
        {isRecurring && <span style={{ fontSize: '8px', flexShrink: 0, opacity: 0.6 }}>{'\uD83D\uDD01'}</span>}
        {ev.google_synced_at && <span style={{ fontSize: '8px', flexShrink: 0, opacity: 0.5 }} title="Synced to Google Calendar">{'\u2713'}</span>}
        {(ev.event_type === 'video_post' || ev.event_type === 'tmbb_video') && (deliverablesByEventId[ev.id] || []).length > 0 && (
          <span style={{ fontSize: '8px', flexShrink: 0, background: 'rgba(16,185,129,0.2)', color: '#6ee7b7', padding: '0 3px', borderRadius: '3px', fontWeight: 700 }} title={(deliverablesByEventId[ev.id] || []).map(d => d.sponsor?.name || 'Sponsor').join(', ')}>
            {'\uD83E\uDD1D'} {(deliverablesByEventId[ev.id] || []).length}
          </span>
        )}
      </div>
    );
  }

  // ── Week / Day time-positioned event renderer ──
  function getTimedEventStyle(ev, dayDate, columnCount, columnIdx) {
    const evStart = new Date(ev.start_date);
    const evEnd = new Date(ev.end_date);
    const dayKey = dk(dayDate);
    const dayStart = ptToDate(dayKey, '00:00');
    const dayEnd = new Date(ptToDate(dayKey, '23:59').getTime() + 59 * 1000);

    const clampedStart = evStart < dayStart ? dayStart : evStart;
    const clampedEnd = evEnd > dayEnd ? dayEnd : evEnd;

    const startMinutes = getPTMinutesSinceMidnight(clampedStart);
    const endMinutes = getPTMinutesSinceMidnight(clampedEnd);
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
    <div style={styles.page} onClick={() => { setActiveTooltip(null); setSelectedEvent(null); }}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Calendar</h1>
          <p style={styles.pageSubtitle}>
            {calendarEvents.length > 0 && `${calendarEvents.length} events`}
            {showMetricool && scheduledPosts.length > 0 && `${calendarEvents.length > 0 ? ' \u00B7 ' : ''}${scheduledPosts.length} scheduled posts`}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); openNewEventModal(ptToday()); }}
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
          <button onClick={() => setViewDate(ptToday())} style={styles.todayBtn}>Today</button>
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
          <button
            onClick={(e) => { e.stopPropagation(); setShowFilters(!showFilters); }}
            style={{ ...styles.metricoolToggle, ...(showFilters ? styles.filterToggleActive : {}) }}
          >
            {'\u2630'} Filters
          </button>
        </div>
      </div>

      {showFilters && (
        <div style={styles.filterRow}>
          <FilterChip
            label="📝 Substack"
            color="#FF6719"
            active={visibleFilters.substack_article}
            onClick={() => toggleFilter('substack_article')}
          />
          <span style={styles.filterDivider} />
          {EVENT_TYPES.map(type => (
            <FilterChip
              key={type}
              label={`${EVENT_TYPE_ICONS[type]} ${EVENT_TYPE_LABELS[type]}`}
              color={EVENT_TYPE_COLORS[type]}
              active={visibleFilters[type]}
              onClick={() => toggleFilter(type)}
            />
          ))}
          {showMetricool && (
            <>
              <span style={styles.filterDivider} />
              <FilterChip
                label="Social Posts"
                color="#22c55e"
                active={visibleFilters.social_posts}
                onClick={() => toggleFilter('social_posts')}
              />
            </>
          )}
        </div>
      )}

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
                      const isToday = toPTDateKey(day.date) === toPTDateKey(new Date());
                      const dayPosts = showMetricool && visibleFilters.social_posts ? getPostsForDate(day.date) : [];
                      const dayEvents = getEventsForDate(day.date);
                      const regularEvents = dayEvents.filter(ev => ev.event_type !== 'live_recording');
                      const liveEvents = dayEvents.filter(ev => ev.event_type === 'live_recording');
                      const dayKey = dk(day.date);
                      const isSocialExpanded = expandedSocialDays[dayKey];
                      return (
                        <div key={di} style={{
                          ...styles.dayCell,
                          opacity: day.isCurrentMonth ? 1 : 0.3,
                          background: dragOverDate === dayKey ? 'rgba(91, 143, 199,0.14)' : (isToday ? 'rgba(91, 143, 199,0.06)' : 'transparent'),
                          borderRight: di < 6 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                          outline: dragOverDate === dayKey ? '1px solid rgba(91, 143, 199,0.4)' : 'none',
                        }}
                        onClick={(e) => { e.stopPropagation(); openNewEventModal(day.date); }}
                        onDragOver={(e) => { e.preventDefault(); setDragOverDate(dayKey); }}
                        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverDate(null); }}
                        onDrop={(e) => { e.preventDefault(); handleEventDrop(day.date); }}
                        >
                          <div style={styles.dateRow}>
                            <span style={{ ...styles.dateNumber, ...(isToday ? styles.dateNumberToday : {}) }}>
                              {day.date.getUTCDate()}
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

                    {/* Substack bars overlay */}
                    {bars.map(bar => {
                      const color = '#FF6719';
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
                            zIndex: 3,
                            overflow: 'hidden',
                          }}
                          onMouseLeave={hideTooltip}
                        >
                          <span style={{ fontSize: '10px', fontWeight: 700, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {'\uD83D\uDCDD'} {bar.project.name}
                          </span>
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
              const isToday = toPTDateKey(date) === toPTDateKey(new Date());
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
                    {date.getUTCDate()}
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
                  {dayEvents.map(ev => renderEventChip(ev))}
                </div>
              );
            })}
          </div>

          {/* Time grid */}
          <div ref={timeGridRef} style={styles.timeGridScroll} data-timegrid="week">
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
                const nowKey = toPTDateKey(now);
                const todayIdx = weekDays.findIndex(d => toPTDateKey(d) === nowKey);
                if (todayIdx < 0) return null;
                const minutesSinceMidnight = getPTMinutesSinceMidnight(now);
                const topPx = (minutesSinceMidnight / 60) * HOUR_HEIGHT;
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
                    onClick={(e) => {
                      if (wasDragging.current || timeDragRef.current) return;
                      e.stopPropagation();
                      // The column scrolls with the grid, so its rect.top already
                      // reflects scroll — adding scrollTop again double-counts and
                      // pushed the time ~7h later (the PT offset when scrolled to
                      // the workday). Use the column-relative offset directly.
                      const rect = e.currentTarget.getBoundingClientRect();
                      const y = e.clientY - rect.top;
                      const totalMinutes = Math.floor(y / HOUR_HEIGHT * 60);
                      const snapped = Math.floor(totalMinutes / 15) * 15;
                      openNewEventModalAtTime(date, Math.min(Math.max(snapped, 0), 1425));
                    }}
                    >
                      {laid.map(({ event: ev, columnCount, columnIdx }) => {
                        const color = EVENT_TYPE_COLORS[ev.event_type] || '#6b7280';
                        const icon = EVENT_TYPE_ICONS[ev.event_type] || '\u2022';
                        const pos = getTimedEventStyle(ev, date, columnCount, columnIdx);
                        const isDraggable = !ev._isRecurrenceInstance;
                        const isBeingDragged = timeDrag && timeDrag.event.id === ev.id;
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
                              cursor: isDraggable ? 'grab' : 'pointer',
                              zIndex: 5,
                              overflow: 'hidden',
                              fontSize: '11px',
                              touchAction: isDraggable ? 'none' : undefined,
                              opacity: isBeingDragged ? 0.4 : 1,
                              transition: 'opacity 0.1s',
                            }}
                            onPointerDown={isDraggable ? (e) => handleTimeDragStart(e, ev, date) : undefined}
                            onClick={(e) => { if (wasDragging.current) return; handleEventClick(e, ev); }}
                            onContextMenu={(e) => handleEventContextMenu(e, ev)}
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

                {/* Drag ghost preview (week view) */}
                {timeDrag && viewMode === 'week' && (() => {
                  const weekDays = getWeekDays();
                  const colIdx = weekDays.findIndex(d => dk(d) === timeDrag.currentDateKey);
                  if (colIdx < 0) return null;
                  const ghostTop = (timeDrag.currentMinutes / 60) * HOUR_HEIGHT;
                  const ghostHeight = (timeDrag.durationMin / 60) * HOUR_HEIGHT;
                  const color = EVENT_TYPE_COLORS[timeDrag.event.event_type] || '#6b7280';
                  const ghostH = Math.floor(timeDrag.currentMinutes / 60);
                  const ghostM = timeDrag.currentMinutes % 60;
                  const ghostAMPM = ghostH >= 12 ? 'PM' : 'AM';
                  const ghostHour = ghostH === 0 ? 12 : ghostH > 12 ? ghostH - 12 : ghostH;
                  const ghostTimeStr = `${ghostHour}:${String(ghostM).padStart(2, '0')} ${ghostAMPM}`;
                  return (
                    <div style={{
                      position: 'absolute',
                      top: `${ghostTop}px`,
                      height: `${Math.max(ghostHeight, 20)}px`,
                      left: `${(colIdx / 7) * 100}%`,
                      width: `${100 / 7}%`,
                      background: `${color}15`,
                      border: `2px dashed ${color}80`,
                      borderRadius: '4px',
                      zIndex: 15,
                      pointerEvents: 'none',
                      padding: '2px 6px',
                      boxSizing: 'border-box',
                    }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: `${color}cc`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {timeDrag.event.title}
                      </div>
                      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>
                        {ghostTimeStr}
                      </div>
                    </div>
                  );
                })()}
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
                  {allDayEvents.map(ev => renderEventChip(ev))}
                </div>
              </div>
            );
          })()}

          {/* Time grid */}
          <div ref={timeGridRef} style={styles.timeGridScroll} data-timegrid="day">
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
                if (toPTDateKey(viewDate) !== toPTDateKey(now)) return null;
                const minutesSinceMidnight = getPTMinutesSinceMidnight(now);
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
                  onClick={(e) => {
                    if (wasDragging.current || timeDragRef.current) return;
                    e.stopPropagation();
                    // Column scrolls with the grid, so rect.top already reflects
                    // scroll — don't add scrollTop again (double-count shifted the
                    // populated time ~7h later).
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    const totalMinutes = Math.floor(y / HOUR_HEIGHT * 60);
                    const snapped = Math.floor(totalMinutes / 15) * 15;
                    openNewEventModalAtTime(viewDate, Math.min(Math.max(snapped, 0), 1425));
                  }}
                >
                  {(() => {
                    const dayEvents = getEventsForDate(viewDate).filter(ev => !ev.all_day);
                    const laid = layoutOverlappingEvents(dayEvents);
                    return laid.map(({ event: ev, columnCount, columnIdx }) => {
                      const color = EVENT_TYPE_COLORS[ev.event_type] || '#6b7280';
                      const icon = EVENT_TYPE_ICONS[ev.event_type] || '\u2022';
                      const pos = getTimedEventStyle(ev, viewDate, columnCount, columnIdx);
                      const isDraggable = !ev._isRecurrenceInstance;
                      const isBeingDragged = timeDrag && timeDrag.event.id === ev.id;
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
                            cursor: isDraggable ? 'grab' : 'pointer',
                            zIndex: 5,
                            overflow: 'hidden',
                            touchAction: isDraggable ? 'none' : undefined,
                            opacity: isBeingDragged ? 0.4 : 1,
                            transition: 'opacity 0.1s',
                          }}
                          onPointerDown={isDraggable ? (e) => handleTimeDragStart(e, ev, viewDate) : undefined}
                          onClick={(e) => { if (wasDragging.current) return; handleEventClick(e, ev); }}
                          onContextMenu={(e) => handleEventContextMenu(e, ev)}
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

                  {/* Drag ghost preview (day view) */}
                  {timeDrag && viewMode === 'day' && (() => {
                    const ghostTop = (timeDrag.currentMinutes / 60) * HOUR_HEIGHT;
                    const ghostHeight = (timeDrag.durationMin / 60) * HOUR_HEIGHT;
                    const color = EVENT_TYPE_COLORS[timeDrag.event.event_type] || '#6b7280';
                    const ghostH = Math.floor(timeDrag.currentMinutes / 60);
                    const ghostM = timeDrag.currentMinutes % 60;
                    const ghostAMPM = ghostH >= 12 ? 'PM' : 'AM';
                    const ghostHour = ghostH === 0 ? 12 : ghostH > 12 ? ghostH - 12 : ghostH;
                    const ghostTimeStr = `${ghostHour}:${String(ghostM).padStart(2, '0')} ${ghostAMPM}`;
                    return (
                      <div style={{
                        position: 'absolute',
                        top: `${ghostTop}px`,
                        height: `${Math.max(ghostHeight, 20)}px`,
                        left: 0,
                        right: 0,
                        background: `${color}15`,
                        border: `2px dashed ${color}80`,
                        borderRadius: '6px',
                        zIndex: 15,
                        pointerEvents: 'none',
                        padding: '4px 10px',
                        boxSizing: 'border-box',
                      }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: `${color}cc`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {timeDrag.event.title}
                        </div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                          {ghostTimeStr}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hover Tooltip */}
      {activeTooltip && (
        <div style={{ ...styles.tooltip, left: `${activeTooltip.x}px`, top: `${activeTooltip.y}px` }}>
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

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 10000,
            background: colors.bgHover,
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '4px 0',
            minWidth: 160,
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={styles.ctxMenuItem}
            onClick={() => {
              const ev = contextMenu.event;
              setContextMenu(null);
              promptRecurrenceAction('edit', ev);
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            Edit
          </div>
          <div
            style={styles.ctxMenuItem}
            onClick={() => {
              const ev = contextMenu.event;
              setContextMenu(null);
              handleDuplicateEvent(ev);
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            Duplicate
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
          <div
            style={{ ...styles.ctxMenuItem, color: '#fca5a5' }}
            onClick={() => {
              const ev = contextMenu.event;
              setContextMenu(null);
              promptRecurrenceAction('delete', ev);
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            Delete
          </div>
        </div>
      )}

      {/* Event detail popup */}
      {selectedEvent && (
        <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedEvent(null); }}>
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
                {selectedEvent.all_day ? 'All day' : new Date(selectedEvent.start_date).toLocaleString('en-US', { timeZone: PT_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {' \u2013 '}
                {selectedEvent.all_day
                  ? new Date(selectedEvent.end_date).toLocaleDateString('en-US', { timeZone: PT_TZ, month: 'short', day: 'numeric' })
                  : new Date(selectedEvent.end_date).toLocaleString('en-US', { timeZone: PT_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                }
              </span>
            </div>
            {selectedEvent.recurrence_rule && selectedEvent.recurrence_rule.type !== 'none' && (
              <div style={styles.eventDetailRow}>
                <span style={styles.eventDetailLabel}>Repeats</span>
                <span style={{ color: colors.accentFg, fontSize: '13px' }}>
                  {'\uD83D\uDD01'} {(() => {
                    const r = selectedEvent.recurrence_rule;
                    const interval = r.interval || 1;
                    let text = '';
                    if (r.type === 'daily') text = interval === 1 ? 'Daily' : `Every ${interval} days`;
                    else if (r.type === 'weekly') {
                      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                      const days = (r.daysOfWeek || []).map(d => dayNames[d]).join(', ');
                      text = interval === 1 ? `Weekly on ${days}` : `Every ${interval} weeks on ${days}`;
                    }
                    else if (r.type === 'weekdays') text = 'Every weekday (Mon\u2013Fri)';
                    else if (r.type === 'monthly') text = interval === 1 ? 'Monthly' : `Every ${interval} months`;
                    else if (r.type === 'yearly') text = interval === 1 ? 'Annually' : `Every ${interval} years`;
                    else text = r.type;
                    if (r.endType === 'date' && r.endDate) text += `, until ${new Date(r.endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
                    else if (r.endType === 'count' && r.endCount) text += `, ${r.endCount} times`;
                    return text;
                  })()}
                </span>
              </div>
            )}
            {selectedEvent.location && (
              <div style={styles.eventDetailRow}>
                <span style={styles.eventDetailLabel}>Location</span>
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>{selectedEvent.location}</span>
              </div>
            )}
            {selectedEvent.is_meeting && (
              <div style={styles.eventDetailRow}>
                <span style={styles.eventDetailLabel}>Video meeting</span>
                {selectedEvent.harbor_session_id ? (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <a
                      href={`/harbor/room/${selectedEvent.harbor_session_id}`}
                      style={{
                        display: 'inline-block', padding: '6px 14px', borderRadius: '8px',
                        background: '#5b8fc7', color: '#fff', fontSize: '13px', fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      Join meeting
                    </a>
                    <button
                      type="button"
                      onClick={() => copyMeetingGuestLink(selectedEvent.harbor_session_id, selectedEvent.id)}
                      style={{
                        padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
                        background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)',
                        border: '1px solid rgba(255,255,255,0.12)', fontSize: '13px',
                      }}
                    >
                      {copiedMeetingLinkId === selectedEvent.id ? 'Copied!' : 'Copy guest link'}
                    </button>
                  </div>
                ) : (
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '13px' }}>Preparing room…</span>
                )}
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
            {(selectedEvent.event_type === 'video_post' || selectedEvent.event_type === 'tmbb_video') && (
              <div style={styles.eventDetailRow}>
                <span style={styles.eventDetailLabel}>Sponsor Reads</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {(deliverablesByEventId[selectedEvent.id] || []).length > 0 ? (
                    (deliverablesByEventId[selectedEvent.id] || []).map(d => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ flex: 1, fontSize: '13px', color: '#6ee7b7', background: 'rgba(16,185,129,0.1)', padding: '3px 8px', borderRadius: '4px' }}>
                          {'\uD83E\uDD1D'} {d.sponsor?.name || 'Sponsor'}{d.title ? ` — ${d.title}` : ''}{d.campaign?.name ? ` (${d.campaign.name})` : ''}{d.pay != null ? ` · $${parseFloat(d.pay).toLocaleString()}` : ''}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() => handleDetachDeliverable(d.id)}
                            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: '14px', padding: '2px 4px', lineHeight: 1, fontFamily: 'inherit' }}
                            onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}
                            title="Detach deliverable"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>No sponsor reads assigned</span>
                  )}
                  {isAdmin && (
                    <div ref={deliverableDropdownRef} style={{ position: 'relative', marginTop: '4px' }}>
                      <button
                        onClick={(e) => { if (!showDeliverableDropdown) openDeliverableDropdownAt(e.currentTarget); setShowDeliverableDropdown(v => !v); }}
                        style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '6px', color: '#6ee7b7', fontSize: '12px', fontWeight: 600, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        + Assign Deliverable
                      </button>
                      {showDeliverableDropdown && (
                        <div style={{ position: 'fixed', left: deliverableDropdownPos.left, top: deliverableDropdownPos.top, zIndex: 9999, background: colors.bgHover, border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '4px 0', minWidth: '260px', maxHeight: '200px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                          {unassignedDeliverables.length === 0 ? (
                            <div style={{ padding: '8px 12px', fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>No unassigned deliverables</div>
                          ) : (
                            unassignedDeliverables.map(d => (
                              <div
                                key={d.id}
                                onClick={() => { handleAttachDeliverable(d.id, selectedEvent); setShowDeliverableDropdown(false); }}
                                style={{ padding: '6px 12px', fontSize: '12px', color: 'rgba(255,255,255,0.8)', cursor: 'pointer' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >
                                {d.sponsor?.name || 'Sponsor'}{d.title ? ` — ${d.title}` : ''}{d.campaign?.name ? ` (${d.campaign.name})` : ''}{d.channel ? ` · ${d.channel === 'tmb' ? 'TMB' : d.channel.charAt(0).toUpperCase() + d.channel.slice(1)}` : ''}{d.due_date ? ` · ${new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}{d.pay != null ? ` · $${parseFloat(d.pay).toLocaleString()}` : ''}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              {/* Edit (incl. adding team members) is open to all roles */}
              <button
                onClick={() => promptRecurrenceAction('edit', selectedEvent)}
                style={styles.eventEditBtn}
              >
                Edit
              </button>
              {(selectedEvent.created_by === profile?.id || isAdmin) && (
                <button
                  onClick={() => promptRecurrenceAction('delete', selectedEvent)}
                  style={styles.eventDeleteBtn}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recurrence Action Prompt */}
      {recurrencePrompt && (
        <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setRecurrencePrompt(null); }}>
          <div style={styles.recurrencePrompt} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 700, color: '#fff' }}>
              {recurrencePrompt.action === 'delete' ? 'Delete Recurring Event' : 'Edit Recurring Event'}
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>
              This is a repeating event. What would you like to {recurrencePrompt.action}?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={() => {
                  const ev = recurrencePrompt.event;
                  if (recurrencePrompt.action === 'delete') {
                    handleDeleteSingleOccurrence(ev);
                  } else {
                    handleEditSingleOccurrence(ev);
                  }
                }}
                style={styles.recurrencePromptBtn}
              >
                This event only
              </button>
              <button
                onClick={() => {
                  const ev = recurrencePrompt.event;
                  setRecurrencePrompt(null);
                  if (recurrencePrompt.action === 'delete') {
                    handleDeleteEvent(ev._parentId || ev.id);
                  } else {
                    openEditEventModal(ev);
                  }
                }}
                style={styles.recurrencePromptBtn}
              >
                All events in this series
              </button>
              <button
                onClick={() => setRecurrencePrompt(null)}
                style={styles.recurrencePromptCancelBtn}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Event Modal */}
      {showEventModal && (
        <div style={styles.modalOverlay} onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const isDirty = JSON.stringify(eventForm) !== JSON.stringify(initialEventFormRef.current);
          if (isDirty) return;
          setShowEventModal(false);
          setEditingEventId(null);
        }}>
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
                  style={{ accentColor: '#5b8fc7' }}
                />
                All day
              </label>
            </div>

            {/* Video meeting (Harbor) toggle — saving flips is_meeting, and a DB
                trigger spins up the linked Harbor room automatically. */}
            <div style={styles.formGroup}>
              <label style={{ ...styles.formLabel, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={eventForm.is_meeting}
                  onChange={(e) => setEventForm(prev => ({ ...prev, is_meeting: e.target.checked }))}
                  style={{ accentColor: '#5b8fc7' }}
                />
                Video meeting (Harbor)
              </label>
              {eventForm.is_meeting && (
                <span style={{ display: 'block', marginTop: '4px', fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>
                  A Harbor room is created on save. Recording is off unless you enable it in the call.
                </span>
              )}
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
                    onChange={(e) => {
                      const newStart = e.target.value;
                      setEventForm(prev => {
                        const [h, m] = newStart.split(':').map(Number);
                        const totalMins = h * 60 + m + 30;
                        const endH = Math.min(Math.floor(totalMins / 60), 23);
                        const endM = totalMins >= 24 * 60 ? 59 : totalMins % 60;
                        const newEnd = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
                        return { ...prev, start_time: newStart, end_time: newEnd };
                      });
                    }}
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

            {/* Repeat */}
            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Repeat</label>
              <select
                value={showCustomRecurrence ? 'custom' : eventForm.recurrence}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'custom') {
                    setShowCustomRecurrence(true);
                    setEventForm(prev => ({ ...prev, recurrence: 'weekly', recurrence_days: prev.recurrence_days.length ? prev.recurrence_days : (prev.start_date ? [new Date(prev.start_date + 'T00:00:00').getDay()] : []) }));
                  } else {
                    setShowCustomRecurrence(false);
                    setEventForm(prev => ({ ...prev, recurrence: val, recurrence_interval: 1, recurrence_days: [], recurrence_end_type: 'never' }));
                  }
                }}
                style={styles.formInput}
              >
                {RECURRENCE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Custom Recurrence */}
            {showCustomRecurrence && (
              <div style={styles.customRecurrenceBox}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Every</span>
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={eventForm.recurrence_interval}
                    onChange={(e) => setEventForm(prev => ({ ...prev, recurrence_interval: Math.max(1, parseInt(e.target.value) || 1) }))}
                    style={{ ...styles.formInput, width: '60px', textAlign: 'center' }}
                  />
                  <select
                    value={eventForm.recurrence}
                    onChange={(e) => setEventForm(prev => ({ ...prev, recurrence: e.target.value }))}
                    style={{ ...styles.formInput, width: 'auto', flex: 1 }}
                  >
                    <option value="daily">{eventForm.recurrence_interval > 1 ? 'days' : 'day'}</option>
                    <option value="weekly">{eventForm.recurrence_interval > 1 ? 'weeks' : 'week'}</option>
                    <option value="monthly">{eventForm.recurrence_interval > 1 ? 'months' : 'month'}</option>
                    <option value="yearly">{eventForm.recurrence_interval > 1 ? 'years' : 'year'}</option>
                  </select>
                </div>

                {eventForm.recurrence === 'weekly' && (
                  <div style={{ marginBottom: '12px' }}>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: '6px' }}>Repeat on</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, idx) => {
                        const isActive = eventForm.recurrence_days.includes(idx);
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              setEventForm(prev => ({
                                ...prev,
                                recurrence_days: isActive
                                  ? prev.recurrence_days.filter(d => d !== idx)
                                  : [...prev.recurrence_days, idx].sort((a, b) => a - b),
                              }));
                            }}
                            style={{
                              width: '32px', height: '32px', borderRadius: '50%',
                              border: isActive ? '2px solid #5b8fc7' : '1px solid rgba(255,255,255,0.12)',
                              background: isActive ? 'rgba(91, 143, 199,0.2)' : 'rgba(255,255,255,0.03)',
                              color: isActive ? '#8fb4d8' : 'rgba(255,255,255,0.4)',
                              fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: '6px' }}>Ends</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
                      <input type="radio" name="recEnd" checked={eventForm.recurrence_end_type === 'never'} onChange={() => setEventForm(prev => ({ ...prev, recurrence_end_type: 'never' }))} style={{ accentColor: '#5b8fc7' }} />
                      Never
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
                      <input type="radio" name="recEnd" checked={eventForm.recurrence_end_type === 'date'} onChange={() => setEventForm(prev => ({ ...prev, recurrence_end_type: 'date' }))} style={{ accentColor: '#5b8fc7' }} />
                      On
                      <input
                        type="date"
                        value={eventForm.recurrence_end_date}
                        min={eventForm.start_date}
                        onChange={(e) => setEventForm(prev => ({ ...prev, recurrence_end_date: e.target.value, recurrence_end_type: 'date' }))}
                        style={{ ...styles.formInput, width: '150px', padding: '4px 8px', fontSize: '12px' }}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
                      <input type="radio" name="recEnd" checked={eventForm.recurrence_end_type === 'count'} onChange={() => setEventForm(prev => ({ ...prev, recurrence_end_type: 'count' }))} style={{ accentColor: '#5b8fc7' }} />
                      After
                      <input
                        type="number"
                        min="1"
                        max="999"
                        value={eventForm.recurrence_end_count}
                        onChange={(e) => setEventForm(prev => ({ ...prev, recurrence_end_count: Math.max(1, parseInt(e.target.value) || 1), recurrence_end_type: 'count' }))}
                        style={{ ...styles.formInput, width: '60px', padding: '4px 8px', textAlign: 'center', fontSize: '12px' }}
                      />
                      occurrences
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Recurrence summary for non-custom presets */}
            {eventForm.recurrence !== 'none' && !showCustomRecurrence && (
              <div style={{ marginTop: '-8px', marginBottom: '14px', padding: '6px 10px', background: colors.accentA08, borderRadius: '6px', fontSize: '11px', color: colors.accentFg }}>
                {'\uD83D\uDD01'} Repeats {eventForm.recurrence === 'weekdays' ? 'every weekday (Mon\u2013Fri)' : eventForm.recurrence}
              </div>
            )}

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
                onClick={(e) => { if (!showGuestDropdown) openGuestDropdownAt(e.currentTarget); setShowGuestDropdown(!showGuestDropdown); }}
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
                <div data-guest-dropdown style={{ ...styles.guestDropdownList, position: 'fixed', top: guestDropdownPos.top, left: guestDropdownPos.left, right: 'auto', width: guestDropdownPos.width, marginTop: 0 }}>
                  {hubUsers.filter(u => u.id !== profile?.id).map(u => {
                    const isSelected = eventForm.guests.includes(u.id);
                    return (
                      <div
                        key={u.id}
                        style={{
                          ...styles.guestDropdownItem,
                          background: isSelected ? 'rgba(91, 143, 199,0.12)' : 'transparent',
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
                        {isSelected && <span style={{ color: colors.accentFg, fontSize: '14px' }}>{'\u2713'}</span>}
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

function FilterChip({ label, color, active, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: '6px', border: '1px solid',
        borderColor: active ? `${color}50` : 'rgba(255,255,255,0.08)',
        background: active ? `${color}18` : 'rgba(255,255,255,0.02)',
        color: active ? color : 'rgba(255,255,255,0.3)',
        fontSize: '12px', fontWeight: 600, cursor: 'pointer',
        fontFamily: 'inherit', transition: 'all 0.15s',
        whiteSpace: 'nowrap', opacity: active ? 1 : 0.6,
      }}
    >
      <div style={{
        width: '8px', height: '8px', borderRadius: '50%',
        background: active ? color : 'rgba(255,255,255,0.2)',
        flexShrink: 0, transition: 'background 0.15s',
      }} />
      {label}
    </button>
  );
}

const styles = {
  page: { padding: '36px 40px 64px', maxWidth: '1500px', margin: '0 auto', minHeight: '100%' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },
  addEventBtn: { padding: '8px 18px', background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)', border: 'none', borderRadius: '10px', color: colors.white, fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '-0.2px' },
  controlsRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' },
  navControls: { display: 'flex', alignItems: 'center', gap: '12px' },
  navBtn: { width: '34px', height: '34px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#e2e8f0', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' },
  viewTitle: { fontSize: '18px', fontWeight: 600, color: '#ffffff', minWidth: '180px', textAlign: 'center' },
  todayBtn: { padding: '6px 14px', background: colors.accentA12, border: '1px solid rgba(91, 143, 199,0.25)', borderRadius: '8px', color: colors.accentFg, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  viewToggleGroup: { display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' },
  viewToggleBtn: { padding: '6px 14px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  viewToggleBtnActive: { background: colors.accentA20, color: colors.accentFg },
  metricoolToggle: { padding: '6px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.45)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  metricoolToggleActive: { background: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.25)', color: '#86efac' },
  filterToggleActive: { background: colors.accentA12, borderColor: colors.accentA25, color: colors.accentFg },
  filterRow: { display: 'flex', alignItems: 'center', gap: '6px', padding: '0 0 12px', flexWrap: 'wrap' },
  filterDivider: { width: '1px', height: '20px', background: 'rgba(255,255,255,0.08)', flexShrink: 0 },
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
  dateNumberToday: { background: colors.accent, color: colors.white, fontWeight: 700 },
  eventsContainer: { display: 'flex', flexDirection: 'column', gap: '2px' },
  eventChip: { display: 'flex', alignItems: 'center', gap: '3px', padding: '1px 5px', borderRadius: '4px', border: '1px solid', cursor: 'pointer', minHeight: '17px', transition: 'opacity 0.1s' },
  eventChipText: { fontSize: '9px', fontWeight: 600, flex: 1 },
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
  weekDayNumberToday: { background: colors.accent, color: colors.white },
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
  statusDropdown: { position: 'absolute', top: '24px', left: '0', background: colors.bgHover, border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '12px', zIndex: 100, minWidth: '250px', maxWidth: '320px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)', maxHeight: '360px', overflow: 'auto' },
  dropdownTitle: { fontSize: '13px', fontWeight: 700, color: '#ffffff', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  dropdownTagsWrap: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  statusTag: { display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '6px', border: '1px solid', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap' },
  dropdownDivider: { height: '1px', background: 'rgba(255,255,255,0.08)', margin: '10px 0' },
  dropdownSectionLabel: { fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' },
  dropdownComments: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px', maxHeight: '120px', overflow: 'auto' },
  dropdownComment: { display: 'flex', flexDirection: 'column', gap: '1px', padding: '5px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' },
  dropdownCommentAuthor: { fontSize: '10px', fontWeight: 600, color: colors.accentFg },
  dropdownCommentText: { fontSize: '11px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.3 },
  dropdownCommentTime: { fontSize: '9px', color: 'rgba(255,255,255,0.2)' },
  dropdownCommentForm: { display: 'flex', gap: '6px' },
  dropdownCommentInput: { flex: 1, padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '11px', fontFamily: 'inherit', outline: 'none' },
  dropdownCommentBtn: { padding: '6px 10px', background: colors.accent, border: 'none', borderRadius: '6px', color: colors.white, fontSize: '10px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  dropdownCommentDelete: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: '10px', padding: '0 2px', marginLeft: 'auto' },
  dropdownDeleteBtn: { width: '100%', padding: '7px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '6px', color: '#fca5a5', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' },
  tooltip: { position: 'fixed', transform: 'translate(-50%, -100%)', background: colors.bgHover, border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '10px 14px', zIndex: 200, minWidth: '180px', maxWidth: '280px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)', pointerEvents: 'none' },
  tooltipTitle: { fontSize: '13px', fontWeight: 700, color: '#ffffff', marginBottom: '6px', lineHeight: 1.3 },
  tooltipRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '3px' },
  tooltipDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  tooltipMeta: { fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '2px', textTransform: 'capitalize' },
  tooltipHint: { fontSize: '10px', color: colors.accentA70, marginTop: '6px', fontStyle: 'italic' },
  legend: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px', padding: '0 4px' },
  legendGroup: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' },
  legendGroupLabel: { fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  legendItem: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.45)' },
  legendDot: { width: '8px', height: '8px', borderRadius: '3px' },
  // Modal styles
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, backdropFilter: 'blur(4px)' },
  eventModal: { background: colors.bgHover, border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '24px', width: '480px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' },
  modalCloseBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '18px', padding: '4px 8px', borderRadius: '6px' },
  formGroup: { marginBottom: '14px', position: 'relative' },
  formLabel: { display: 'block', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.3px' },
  formInput: { width: '100%', padding: '9px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  eventTypeGrid: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  eventTypeBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', borderRadius: '8px', border: '1px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  customRecurrenceBox: { marginTop: '-8px', marginBottom: '14px', padding: '14px', background: colors.accentA05, border: '1px solid rgba(91, 143, 199,0.15)', borderRadius: '10px' },
  cancelBtn: { flex: 1, padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: 'rgba(255,255,255,0.6)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn: { flex: 1, padding: '10px', background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)', border: 'none', borderRadius: '10px', color: colors.white, fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  guestSelector: { padding: '9px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', cursor: 'pointer', minHeight: '38px', display: 'flex', alignItems: 'center' },
  guestDropdownList: { position: 'absolute', top: '100%', left: 0, right: 0, background: colors.bgHover, border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', marginTop: '4px', maxHeight: '200px', overflow: 'auto', zIndex: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' },
  guestDropdownItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', cursor: 'pointer', transition: 'background 0.1s' },
  guestDropdownAvatar: { width: '28px', height: '28px', borderRadius: '8px', background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: colors.white, flexShrink: 0 },
  guestTag: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', background: colors.accentA15, border: '1px solid rgba(91, 143, 199,0.25)', borderRadius: '6px', color: colors.accentFg, fontSize: '11px', fontWeight: 600 },
  guestTagRemove: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '10px', padding: '0 2px' },
  // Event detail card
  eventDetailCard: { background: colors.bgHover, border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '20px', width: '400px', maxWidth: '95vw', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' },
  eventDetailRow: { display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '12px' },
  eventDetailLabel: { fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  ctxMenuItem: { padding: '8px 14px', fontSize: '13px', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.1s' },
  eventEditBtn: { flex: 1, padding: '9px', background: colors.accentA12, border: '1px solid rgba(91, 143, 199,0.25)', borderRadius: '8px', color: colors.accentFg, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  eventDeleteBtn: { flex: 1, padding: '9px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#fca5a5', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  recurrencePrompt: {
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px',
    padding: '24px', width: '320px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  recurrencePromptBtn: {
    padding: '11px', background: colors.accentA10, border: '1px solid rgba(91, 143, 199,0.2)',
    borderRadius: '8px', color: colors.accentFg, fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.15s',
  },
  recurrencePromptCancelBtn: {
    padding: '11px', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px', color: 'rgba(255,255,255,0.4)', fontSize: '13px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
