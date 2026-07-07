import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { ptDayKey } from '../lib/ptDate';
import { colors, spacing, fontSizes, fontWeights } from '../lib/styleTokens';
import { modalOverlay, modal as modalShell, button as buttonRecipe } from '../lib/styleRecipes';

import SprintBoard from '../components/SprintBoard';
import SprintPanel from '../components/SprintPanel';
import NotificationSettings from '../components/NotificationSettings';
import MyTasks from './MyTasks';

const STATUS_COLORS = {
  concept: '#8b5cf6',
  script: '#3b82f6',
  production: '#f59e0b',
  edit: '#f97316',
  review: '#ec4899',
  published: '#22c55e',
};

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
const EVENT_TYPE_ICONS = {
  deadline: '\u23F0', meeting: '\uD83D\uDC65', live_recording: '\uD83D\uDD34',
  filming: '\uD83C\uDFAC', video_post: '\uD83D\uDCF9', tmbb_video: '\uD83C\uDFA5',
  unavailable: '\uD83D\uDEAB',
};

const STATUS_LABELS = {
  concept: 'Concept',
  script: 'Script',
  production: 'Production',
  edit: 'Edit',
  review: 'Review',
  published: 'Published',
};

const DELIVERABLE_STAGE_COLORS = {
  script: '#3b82f6', production: '#f59e0b', editing: '#f97316',
  sent_for_review: '#ec4899', posted: '#22c55e',
};
const DELIVERABLE_STAGE_LABELS = {
  script: 'Script', production: 'Production', editing: 'Editing',
  sent_for_review: 'Sent for Review', posted: 'Posted',
};

const CHECKIN_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#84cc16', 5: '#22c55e' };
const CHECKIN_LABELS = { 1: 'Red', 2: 'Orange', 3: 'Yellow', 4: 'Light Green', 5: 'Green' };

const PRIORITY_COLORS = {
  10: '#ef4444', 9: '#f97316', 8: '#fb923c',
  6: '#fbbf24', 5: '#eab308', 4: '#a3e635',
  3: '#4ade80', 2: '#22c55e', 1: '#15803d',
};
const PRIORITY_OPTIONS = [10, 9, 8, 6, 5, 4, 3, 2, 1];

function ToggleSwitch({ on, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        position: 'relative',
        width: '40px',
        height: '22px',
        borderRadius: '11px',
        border: 'none',
        background: on ? colors.success.fg : 'rgba(255,255,255,0.15)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.2s',
        padding: 0,
        flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute',
        top: '2px',
        left: on ? '20px' : '2px',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

function sortByPriority(items, completedKey = 'checked') {
  return [...items].sort((a, b) => {
    const ac = a[completedKey] ? 1 : 0;
    const bc = b[completedKey] ? 1 : 0;
    if (ac !== bc) return ac - bc;
    const ap = a.priority ?? 0;
    const bp = b.priority ?? 0;
    if (ap !== bp) return bp - ap;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

export default function Dashboard({ onNavigate }) {
  const { profile, updateProfile, isAdmin, isAssistant, isPartner, refreshKey } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(profile?.title || '');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile?.full_name || '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarHover, setAvatarHover] = useState(false);
  const avatarInputRef = useRef(null);

  // Settings modal (cogwheel on profile card)
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Cross-component refresh counters
  const [boardVersion, setBoardVersion] = useState(0);   // SprintBoard changed → SprintPanel re-fetches
  const [sprintVersion, setSprintVersion] = useState(0); // SprintPanel changed → SprintBoard re-fetches

  // Announcements state
  const [announcements, setAnnouncements] = useState([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementsCollapsed, setAnnouncementsCollapsed] = useState(false);
  const [announcementToolbarOpen, setAnnouncementToolbarOpen] = useState(true);

  // Todo list state
  const [todoItems, setTodoItems] = useState([]);
  const [todoCollapsed, setTodoCollapsed] = useState(true);
  const [newTodoText, setNewTodoText] = useState('');
  const [showTodoInput, setShowTodoInput] = useState(false);
  const [editingTodoId, setEditingTodoId] = useState(null);
  const [editingTodoText, setEditingTodoText] = useState('');
  const [newTodoPriority, setNewTodoPriority] = useState(null);
  const [editingTodoPriority, setEditingTodoPriority] = useState(null);

  // Today's schedule state
  const [todayEvents, setTodayEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);


  // Team presence state
  const [teamProfiles, setTeamProfiles] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [editingStatusNote, setEditingStatusNote] = useState(false);
  const [statusNoteDraft, setStatusNoteDraft] = useState(profile?.status_note || '');
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef(null);

  // OOO state
  const [showOooModal, setShowOooModal] = useState(false);
  const [oooStartDate, setOooStartDate] = useState('');
  const [oooEndDate, setOooEndDate] = useState('');
  const [oooSubmitting, setOooSubmitting] = useState(false);
  const [pendingOooRequests, setPendingOooRequests] = useState([]);
  const [oooProcessingId, setOooProcessingId] = useState(null);
  const [approvedOooToday, setApprovedOooToday] = useState([]);
  const [upcomingOoo, setUpcomingOoo] = useState([]);

  // Stage tasks state

  // Stats counters

  // Sponsor deliverables state
  const [sponsorDeliverables, setSponsorDeliverables] = useState([]);
  const [sponsorDelLoading, setSponsorDelLoading] = useState(false);

  // Check In state
  const [todayCheckin, setTodayCheckin] = useState(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinRating, setCheckinRating] = useState(null);
  const [checkinNote, setCheckinNote] = useState('');
  const [checkinEditing, setCheckinEditing] = useState(false);
  const [checkinHistory, setCheckinHistory] = useState([]);
  const [checkinView, setCheckinView] = useState('week'); // 'week' | 'month'

  // Unread contractor-comment notifications surfaced as cards in My Tasks (admin only)
  const [assignmentCommentNotifs, setAssignmentCommentNotifs] = useState([]);

  const fetchAssignmentCommentNotifs = useCallback(async () => {
    if (!isAdmin || !profile?.id) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, body, link_target, created_at')
      .eq('user_id', profile.id)
      .eq('type', 'fl_comment')
      .eq('is_read', false)
      .order('created_at', { ascending: false });
    setAssignmentCommentNotifs(data || []);
  }, [isAdmin, profile?.id]);

  useEffect(() => {
    if (!isAdmin || !profile?.id) return;
    fetchAssignmentCommentNotifs();
    const ch = supabase.channel('dash-fl-comments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, () => fetchAssignmentCommentNotifs())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, profile?.id, fetchAssignmentCommentNotifs]);

  async function handleGoToAssignmentComment(notif) {
    setAssignmentCommentNotifs(prev => prev.filter(n => n.id !== notif.id));
    await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id);
    if (onNavigate) onNavigate('freelancers', notif.link_target);
  }

  // Tiptap editor for announcement modal
  const announcementEditor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Underline,
      Placeholder.configure({ placeholder: 'Write your announcement...' }),
    ],
    content: '',
  });

  useEffect(() => {
    if (!statusMenuOpen) return;
    function handleClick(e) {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target)) setStatusMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [statusMenuOpen]);

  // Load todo items from Supabase on mount (drop any previously-checked items
  // on refresh, mirroring the old localStorage behavior).
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      try {
        await supabase.from('dashboard_todos').delete().eq('user_id', profile.id).eq('checked', true);
        const { data, error } = await supabase
          .from('dashboard_todos')
          .select('*')
          .eq('user_id', profile.id)
          .order('position', { ascending: true });
        if (error) throw error;
        if (!cancelled) setTodoItems(sortByPriority(data || []));
      } catch (err) {
        console.error('Error loading dashboard todos:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id]);

  const now = new Date();
  const todayStr = ptDayKey(now);

  const fetchTeamProfiles = useCallback(async () => {
    if (!profile?.id) return;
    setTeamLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, title, avatar_url, status, status_note, last_seen_at')
        .order('full_name');
      if (error) throw error;
      setTeamProfiles(data || []);
    } catch (err) {
      console.error('Error fetching team profiles:', err);
      setTeamProfiles([]);
    } finally {
      setTeamLoading(false);
    }
  }, [profile?.id]);

  const fetchOooRequests = useCallback(async () => {
    if (!profile?.id) return;
    try {
      // Fetch pending requests (admin needs these for approval)
      const { data: pending } = await supabase
        .from('ooo_requests')
        .select('*, requester:profiles!ooo_requests_user_id_fkey(id, full_name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      setPendingOooRequests(pending || []);

      // Fetch approved requests overlapping today
      const { data: approved } = await supabase
        .from('ooo_requests')
        .select('user_id')
        .eq('status', 'approved')
        .lte('start_date', todayStr)
        .gte('end_date', todayStr);
      setApprovedOooToday((approved || []).map(r => r.user_id));
    } catch (err) {
      console.error('Error fetching OOO requests:', err);
    }
  }, [profile?.id, todayStr]);

  const fetchUpcomingOoo = useCallback(async () => {
    if (!profile?.id) return;
    try {
      // Only sessions happening now or in the future.
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, title, start_date, end_date, all_day')
        .eq('event_type', 'unavailable')
        .gte('end_date', nowIso)
        .order('start_date', { ascending: true });
      if (error) {
        console.error('fetchUpcomingOoo error:', error);
        return;
      }
      setUpcomingOoo(data || []);
    } catch (err) {
      console.error('Error fetching upcoming OOO:', err);
    }
  }, [profile?.id]);

  const fetchAnnouncements = useCallback(async () => {
    if (!profile?.id) return;
    setAnnouncementsLoading(true);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

      const [announcementsResult, readsResult] = await Promise.all([
        supabase
          .from('announcements')
          .select('*, creator:profiles!created_by(full_name)')
          .gte('target_date', cutoff)
          .order('target_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('announcement_reads')
          .select('announcement_id')
          .eq('user_id', profile.id),
      ]);

      if (announcementsResult.error) throw announcementsResult.error;
      const data = announcementsResult.data || [];
      const readIds = new Set((readsResult.data || []).map(r => r.announcement_id));

      const visible = data
        .map(a => ({ ...a, isRead: readIds.has(a.id) }))
        .filter(a => a.target_date === todayStr || !a.isRead);

      setAnnouncements(visible);
    } catch (err) {
      console.error('Error fetching announcements:', err);
      setAnnouncements([]);
    } finally {
      setAnnouncementsLoading(false);
    }
  }, [profile?.id, todayStr]);


  const fetchSponsorDeliverables = useCallback(async () => {
    if (!profile?.id) return;
    setSponsorDelLoading(true);
    try {
      const { data } = await supabase
        .from('deliverable_stage_assignments')
        .select('stage, deliverable:sponsor_deliverables(id, title, status, due_date, deliverable_type, campaign_id, sponsor_id, sponsors(name), sponsor_campaigns(name))')
        .eq('user_id', profile.id);

      const items = [];
      (data || []).forEach(a => {
        if (a.deliverable && a.deliverable.status === a.stage && a.deliverable.status !== 'posted') {
          items.push({
            ...a.deliverable, assigned_stage: a.stage,
            sponsor_name: a.deliverable.sponsors?.name || 'Unknown Sponsor',
            campaign_name: a.deliverable.sponsor_campaigns?.name || null,
          });
        }
      });
      setSponsorDeliverables(items);
    } catch (err) {
      console.error('Error fetching sponsor deliverables:', err);
      setSponsorDeliverables([]);
    } finally {
      setSponsorDelLoading(false);
    }
  }, [profile?.id]);

  const fetchCheckins = useCallback(async () => {
    if (!profile?.id) return;
    setCheckinLoading(true);
    try {
      const now = new Date();
      const startDate = new Date(now);
      startDate.setDate(now.getDate() - 30);
      const startStr = startDate.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('daily_checkins')
        .select('*')
        .eq('user_id', profile.id)
        .gte('date', startStr)
        .order('date', { ascending: false });

      if (error) throw error;
      const all = data || [];
      const todayRecord = all.find(r => r.date === todayStr) || null;
      setTodayCheckin(todayRecord);
      if (todayRecord) {
        setCheckinRating(todayRecord.rating);
        setCheckinNote(todayRecord.note || '');
      }
      setCheckinHistory(all);
    } catch (err) {
      console.error('Error fetching checkins:', err);
    } finally {
      setCheckinLoading(false);
    }
  }, [profile?.id, todayStr]);

  const saveCheckin = useCallback(async () => {
    if (!checkinRating || !profile?.id) return;
    try {
      if (todayCheckin) {
        const { data, error } = await supabase
          .from('daily_checkins')
          .update({ rating: checkinRating, note: checkinNote || null })
          .eq('id', todayCheckin.id)
          .select()
          .single();
        if (error) throw error;
        setTodayCheckin(data);
        setCheckinHistory(prev => prev.map(r => r.id === data.id ? data : r));
      } else {
        const { data, error } = await supabase
          .from('daily_checkins')
          .insert({ user_id: profile.id, date: todayStr, rating: checkinRating, note: checkinNote || null })
          .select()
          .single();
        if (error) throw error;
        setTodayCheckin(data);
        setCheckinHistory(prev => [data, ...prev]);
      }
      setCheckinEditing(false);
    } catch (err) {
      console.error('Error saving checkin:', err);
    }
  }, [checkinRating, checkinNote, todayCheckin, profile?.id, todayStr]);

  const fetchAssignments = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data, error } = await safeQuery(() =>
        supabase
          .from('project_assignments')
          .select(`
            assignment_role,
            project:projects(*)
          `)
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
      );

      if (error) throw error;
      setAssignments(data || []);
    } catch (err) {
      console.error('Error fetching assignments:', err);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, safeQuery]);

  useEffect(() => {
    if (!profile?.id) return;
    if (!isPartner) {
      fetchAssignments();
      fetchSponsorDeliverables();
    }
  }, [profile?.id, isPartner, fetchAssignments, fetchSponsorDeliverables]);

  useEffect(() => {
    if (profile?.id) {
      fetchAnnouncements();
    }
  }, [profile?.id, fetchAnnouncements]);

  useEffect(() => {
    if (!profile?.id) return;
    fetchTeamProfiles();
  }, [profile?.id, fetchTeamProfiles]);

  useEffect(() => {
    if (profile?.id) {
      fetchOooRequests();
      fetchUpcomingOoo();
    }
  }, [profile?.id, fetchOooRequests, fetchUpcomingOoo]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel('team-presence')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'profiles',
      }, (payload) => {
        setTeamProfiles(prev => prev.map(p =>
          p.id === payload.new.id
            ? { ...p, status: payload.new.status, status_note: payload.new.status_note, last_seen_at: payload.new.last_seen_at }
            : p
        ));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, fetchTeamProfiles, refreshKey]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel('ooo-changes')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ooo_requests',
      }, () => { fetchOooRequests(); })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'calendar_events',
      }, () => { fetchUpcomingOoo(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, fetchOooRequests, fetchUpcomingOoo]);

  useVisibilityRefresh(useCallback(() => {
    if (!profile?.id) return;
    if (!isPartner) {
      fetchAssignments();
      fetchSponsorDeliverables();
    }
    fetchAnnouncements();
    fetchTeamProfiles();
    fetchOooRequests();
    fetchUpcomingOoo();
  }, [profile?.id, isAdmin, isAssistant, isPartner, fetchAssignments, fetchSponsorDeliverables, fetchAnnouncements, fetchTeamProfiles, fetchOooRequests, fetchUpcomingOoo]));

  useEffect(() => {
    if (profile?.id) fetchCheckins();
  }, [profile?.id, fetchCheckins]);

  const fetchTodayEvents = useCallback(async () => {
    if (!profile?.id) return;
    setEventsLoading(true);
    try {
      if (isAdmin) {
        // Admin: pull today's events from personal Google Calendar
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const res = await fetch(
            `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-calendar-fetch`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
                'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({ date: todayStr }),
            }
          );
          const result = await res.json();
          setTodayEvents(result.events || []);
        } else {
          setTodayEvents([]);
        }
      } else {
        // Non-admin: show Mayday calendar events as before
        const dayStart = new Date(todayStr + 'T00:00:00').toISOString();
        const dayEnd = new Date(todayStr + 'T23:59:59').toISOString();
        const { data, error } = await supabase
          .from('calendar_events')
          .select('*, creator:profiles!created_by(id, full_name)')
          .lte('start_date', dayEnd)
          .gte('end_date', dayStart)
          .order('all_day', { ascending: false })
          .order('start_date', { ascending: true });
        if (error) throw error;
        setTodayEvents(data || []);
      }
    } catch (err) {
      console.error('Error fetching today events:', err);
      setTodayEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [profile?.id, todayStr, isAdmin]);

  useEffect(() => {
    if (profile?.id) fetchTodayEvents();
  }, [profile?.id, fetchTodayEvents]);

  // Announcement handlers
  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  async function addAnnouncement() {
    if (!announcementEditor) return;
    const html = announcementEditor.getHTML();
    const plainText = stripHtml(html).trim();
    if (!plainText) return;
    const content = html;
    const tempAnnouncement = {
      id: `temp-${Date.now()}`,
      created_by: profile.id,
      target_date: todayStr,
      content,
      created_at: new Date().toISOString(),
      creator: { full_name: profile.full_name },
      isRead: true,
    };
    announcementEditor.commands.clearContent();
    setShowAnnouncementModal(false);
    setAnnouncements(prev => [tempAnnouncement, ...prev]);
    try {
      const { error } = await supabase.from('announcements').insert({
        created_by: profile.id,
        target_date: todayStr,
        content,
      });
      if (error) throw error;
      // Notify all team members
      try {
        const { data: allMembers } = await supabase.from('profiles').select('id');
        if (allMembers) {
          const notifs = allMembers
            .filter(m => m.id !== profile.id)
            .map(m => ({
              user_id: m.id,
              type: 'announcement',
              title: 'New announcement',
              body: plainText.substring(0, 100),
              link_tab: 'dashboard',
            }));
          if (notifs.length > 0) {
            await supabase.from('notifications').insert(notifs);
          }
        }
      } catch (e) {
        console.error('Error sending announcement notifications:', e);
      }
      fetchAnnouncements(); // Re-fetch to get real ID
    } catch (err) {
      console.error('Error adding announcement:', err);
      setAnnouncements(prev => prev.filter(a => a.id !== tempAnnouncement.id));
    }
  }

  async function deleteAnnouncement(id) {
    const prev = announcements;
    setAnnouncements(items => items.filter(a => a.id !== id));
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error deleting announcement:', err);
      setAnnouncements(prev);
    }
  }

  async function markAnnouncementRead(announcementId) {
    setAnnouncements(prev => prev.map(a => a.id === announcementId ? { ...a, isRead: true } : a));
    try {
      const { error } = await supabase.from('announcement_reads').insert({
        announcement_id: announcementId,
        user_id: profile.id,
      });
      if (error) throw error;
    } catch (err) {
      console.error('Error marking announcement read:', err);
    }
  }

  async function handleTitleSave() {
    await updateProfile({ title: titleDraft });
    setEditingTitle(false);
  }

  async function handleNameSave() {
    if (!nameDraft.trim()) return;
    await updateProfile({ full_name: nameDraft.trim() });
    await supabase.auth.updateUser({ data: { full_name: nameDraft.trim() } });
    setEditingName(false);
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !profile?.id) return;
    setAvatarUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${profile.id}/avatar.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      // Cache-bust so the new image shows immediately.
      const url = `${publicUrl}?t=${Date.now()}`;
      await updateProfile({ avatar_url: url });
    } catch (err) {
      console.error('Error uploading avatar:', err);
      alert('Could not upload photo: ' + err.message);
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  }

  // ── Team status handlers ──
  // Re-render every 60s so a member whose last_seen_at has aged past the 2-min
  // threshold flips to "offline" even without an unrelated realtime event.
  const [, setPresenceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPresenceTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  function getEffectiveStatus(member) {
    if (member.status === 'away') return 'busy';
    if (member.status === 'offline') return 'offline';
    // If 'active' but last_seen_at is older than 2 minutes, treat as offline
    if (member.last_seen_at) {
      const lastSeen = new Date(member.last_seen_at);
      const diff = Date.now() - lastSeen.getTime();
      if (diff > 2 * 60 * 1000) return 'offline';
    }
    return 'online';
  }

  async function setMyStatus(newStatus) {
    // Map UI status to DB values: online→active, busy→away, offline→offline
    const dbStatus = newStatus === 'online' ? 'active' : newStatus === 'busy' ? 'away' : 'offline';
    await updateProfile({ status: dbStatus });
    setStatusMenuOpen(false);
  }

  async function saveStatusNote() {
    await updateProfile({ status_note: statusNoteDraft.trim() || null });
    setEditingStatusNote(false);
  }

  async function submitOooRequest() {
    if (!oooStartDate || !oooEndDate || !profile?.id) return;
    setOooSubmitting(true);
    try {
      const { error } = await supabase.from('ooo_requests').insert({
        user_id: profile.id,
        start_date: oooStartDate,
        end_date: oooEndDate,
      });
      if (error) throw error;

      // Notify admins
      const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
      const notifications = (admins || [])
        .filter(a => a.id !== profile.id)
        .map(a => ({
          user_id: a.id,
          type: 'ooo_request',
          title: `${profile.full_name} requested time off`,
          body: `${oooStartDate} to ${oooEndDate}`,
          created_at: new Date().toISOString(),
        }));
      if (notifications.length > 0) {
        await supabase.from('notifications').insert(notifications);
      }

      setShowOooModal(false);
      setOooStartDate('');
      setOooEndDate('');
      fetchOooRequests();
    } catch (err) {
      console.error('Error submitting OOO request:', err);
    } finally {
      setOooSubmitting(false);
    }
  }

  async function handleOooDecision(request, decision) {
    if (!profile?.id || oooProcessingId) return;
    setOooProcessingId(request.id);
    try {
      if (decision === 'approved') {
        // Create calendar event for the OOO period
        const requesterName = request.requester?.full_name || 'Team member';
        const { data: calEvent, error: evError } = await supabase.from('calendar_events').insert({
          title: `${requesterName} \u2014 Out of Office`,
          event_type: 'unavailable',
          start_date: new Date(`${request.start_date}T00:00:00`).toISOString(),
          end_date: new Date(`${request.end_date}T23:59:59`).toISOString(),
          all_day: true,
          created_by: profile.id,
        }).select('id').single();
        if (evError) throw evError;

        await supabase.from('ooo_requests').update({
          status: 'approved',
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
          calendar_event_id: calEvent.id,
        }).eq('id', request.id);

        // Notify requester
        await supabase.from('notifications').insert({
          user_id: request.user_id,
          type: 'ooo_request',
          title: 'Time off approved',
          body: `Your OOO request (${request.start_date} to ${request.end_date}) was approved.`,
          created_at: new Date().toISOString(),
        });
      } else {
        await supabase.from('ooo_requests').update({
          status: 'rejected',
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
        }).eq('id', request.id);

        await supabase.from('notifications').insert({
          user_id: request.user_id,
          type: 'ooo_request',
          title: 'Time off declined',
          body: `Your OOO request (${request.start_date} to ${request.end_date}) was declined.`,
          created_at: new Date().toISOString(),
        });
      }
      fetchOooRequests();
      fetchUpcomingOoo();
    } catch (err) {
      console.error('Error handling OOO decision:', err);
    } finally {
      setOooProcessingId(null);
    }
  }

  function getDaysUntil(deadline) {
    const now = new Date();
    const dl = new Date(deadline);
    const diff = Math.ceil((dl - now) / (1000 * 60 * 60 * 24));
    return diff;
  }

  function getUrgencyColor(days) {
    if (days < 0) return '#ef4444';
    if (days <= 3) return '#f97316';
    if (days <= 7) return '#f59e0b';
    return '#22c55e';
  }

  function formatContent(content) {
    const parts = content.split(/(#\w+(?:-\w+)*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('#')) {
        const chName = part.slice(1);
        return (
          <span
            key={i}
            style={styles.channelLink}
            onClick={() => onNavigate && onNavigate('channels', chName)}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  }

  // Sort: active projects first, then by deadline urgency
  const activeAssignments = assignments
    .filter(a => a.project && a.project.status !== 'published')
    .sort((a, b) => new Date(a.project.deadline) - new Date(b.project.deadline));

  const completedAssignments = assignments
    .filter(a => a.project && a.project.status === 'published');

  // ── Todo list functions ──
  const addTodoItem = async () => {
    const text = newTodoText.trim();
    if (!text || newTodoPriority === null) return;
    if (!profile?.id) { alert('Cannot add todo: not signed in yet.'); return; }
    const nextPosition = todoItems.length > 0
      ? Math.max(...todoItems.map(i => i.position || 0)) + 1
      : 0;
    const { data, error } = await supabase
      .from('dashboard_todos')
      .insert({ user_id: profile.id, text, checked: false, position: nextPosition, priority: newTodoPriority })
      .select()
      .single();
    if (error) {
      console.error('Error adding todo:', error);
      alert(`Could not save todo: ${error.message || 'unknown error'}`);
      return;
    }
    if (!data) {
      alert('Todo saved but no row came back — check RLS / network tab.');
      return;
    }
    setTodoItems(prev => sortByPriority([...prev, data]));
    setNewTodoText('');
    setNewTodoPriority(null);
    setShowTodoInput(false);
  };

  const toggleTodoItem = async (id) => {
    const current = todoItems.find(i => i.id === id);
    if (!current) return;
    const nextChecked = !current.checked;
    setTodoItems(prev => sortByPriority(prev.map(item => item.id === id ? { ...item, checked: nextChecked } : item)));
    const { error } = await supabase
      .from('dashboard_todos')
      .update({ checked: nextChecked, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Error toggling todo:', error);
      setTodoItems(prev => sortByPriority(prev.map(item => item.id === id ? { ...item, checked: current.checked } : item)));
    }
  };

  const deleteTodoItem = async (id) => {
    const previous = todoItems;
    setTodoItems(prev => prev.filter(item => item.id !== id));
    const { error } = await supabase.from('dashboard_todos').delete().eq('id', id);
    if (error) {
      console.error('Error deleting todo:', error);
      setTodoItems(previous);
    }
  };

  const saveTodoEdit = async (id) => {
    const trimmed = editingTodoText.trim();
    const newPriority = editingTodoPriority;
    setEditingTodoId(null);
    setEditingTodoText('');
    setEditingTodoPriority(null);
    if (!trimmed) return;
    const current = todoItems.find(i => i.id === id);
    if (!current) return;
    const updates = { updated_at: new Date().toISOString() };
    if (current.text !== trimmed) updates.text = trimmed;
    if (newPriority !== null && current.priority !== newPriority) updates.priority = newPriority;
    if (Object.keys(updates).length === 1) return; // only updated_at
    setTodoItems(prev => sortByPriority(prev.map(item => item.id === id ? { ...item, text: trimmed, ...(newPriority !== null ? { priority: newPriority } : {}) } : item)));
    const { error } = await supabase
      .from('dashboard_todos')
      .update(updates)
      .eq('id', id);
    if (error) {
      console.error('Error saving todo edit:', error);
      setTodoItems(prev => sortByPriority(prev.map(item => item.id === id ? { ...item, text: current.text, priority: current.priority } : item)));
    }
  };

  // ── Todo list renderer ──
  function renderTodoList() {
    return (
      <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: todoCollapsed ? 0 : '10px' }}>
          <button
            onClick={() => setTodoCollapsed(prev => !prev)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span style={{ ...styles.subSectionTitle, margin: 0 }}>To Do</span>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>{todoCollapsed ? '▶' : '▼'}</span>
          </button>
          {!todoCollapsed && !showTodoInput && (
            <button onClick={() => setShowTodoInput(true)} style={styles.postAnnouncementBtn}>+ Add</button>
          )}
        </div>
        {!todoCollapsed && (
          <>
            {showTodoInput && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={styles.itineraryAddRow}>
                  <input
                    value={newTodoText}
                    onChange={(e) => setNewTodoText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTodoPriority !== null) addTodoItem();
                      if (e.key === 'Escape') { setShowTodoInput(false); setNewTodoText(''); setNewTodoPriority(null); }
                    }}
                    placeholder="Add a to-do item..."
                    style={styles.itineraryInput}
                    autoFocus
                  />
                  <button
                    onClick={addTodoItem}
                    disabled={!newTodoText.trim() || newTodoPriority === null}
                    style={{ ...styles.itineraryAddBtn, opacity: (newTodoText.trim() && newTodoPriority !== null) ? 1 : 0.4 }}
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setShowTodoInput(false); setNewTodoText(''); setNewTodoPriority(null); }}
                    style={styles.cancelTitleBtn}
                  >
                    Cancel
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                  {PRIORITY_OPTIONS.map(p => (
                    <button
                      key={p}
                      onClick={() => setNewTodoPriority(p)}
                      style={{
                        width: 26, height: 26, borderRadius: '4px', border: newTodoPriority === p ? `2px solid ${PRIORITY_COLORS[p]}` : '1px solid rgba(255,255,255,0.12)',
                        background: newTodoPriority === p ? `${PRIORITY_COLORS[p]}22` : 'rgba(255,255,255,0.04)',
                        color: newTodoPriority === p ? PRIORITY_COLORS[p] : 'rgba(255,255,255,0.5)',
                        fontSize: '11px', fontWeight: 700, cursor: 'pointer', padding: 0,
                      }}
                    >{p}</button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ ...styles.itineraryList, marginTop: showTodoInput ? '8px' : '0' }}>
              {todoItems.map((item) => {
                const borderColor = item.priority ? PRIORITY_COLORS[item.priority] : undefined;
                return (
                  <div key={item.id} style={{ ...styles.itineraryItemWrapper, ...(borderColor ? { borderLeft: `3px solid ${borderColor}` } : {}) }}>
                    <div style={styles.itineraryItem}>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => toggleTodoItem(item.id)}
                        style={styles.itineraryCheckbox}
                      />
                      {editingTodoId === item.id ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <input
                            value={editingTodoText}
                            onChange={(e) => setEditingTodoText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveTodoEdit(item.id);
                              if (e.key === 'Escape') { setEditingTodoId(null); setEditingTodoText(''); setEditingTodoPriority(null); }
                            }}
                            style={{ ...styles.itineraryEditInput, flex: 1 }}
                            autoFocus
                          />
                          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                            {PRIORITY_OPTIONS.map(p => (
                              <button
                                key={p}
                                onClick={() => setEditingTodoPriority(p)}
                                style={{
                                  width: 26, height: 26, borderRadius: '4px', border: editingTodoPriority === p ? `2px solid ${PRIORITY_COLORS[p]}` : '1px solid rgba(255,255,255,0.12)',
                                  background: editingTodoPriority === p ? `${PRIORITY_COLORS[p]}22` : 'rgba(255,255,255,0.04)',
                                  color: editingTodoPriority === p ? PRIORITY_COLORS[p] : 'rgba(255,255,255,0.5)',
                                  fontSize: '11px', fontWeight: 700, cursor: 'pointer', padding: 0,
                                }}
                              >{p}</button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span
                          style={{ ...styles.itineraryContent, flex: 1, textDecoration: item.checked ? 'line-through' : 'none', opacity: item.checked ? 0.45 : 1, cursor: 'text' }}
                          onDoubleClick={() => { setEditingTodoId(item.id); setEditingTodoText(item.text); setEditingTodoPriority(item.priority || null); }}
                          title="Double-click to edit"
                        >
                          {item.text}
                        </span>
                      )}
                      <button
                        onClick={() => deleteTodoItem(item.id)}
                        style={{ ...styles.itineraryActionBtn, color: '#ef4444' }}
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
              {todoItems.length === 0 && (
                <p style={{ ...styles.emptyText, marginTop: '8px' }}>No items yet</p>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Announcements renderer ──
  function renderAnnouncementContent(content) {
    if (!content) return null;
    // If content looks like HTML, render it directly
    if (content.startsWith('<')) {
      return <div className="announcement-rich" style={styles.announcementContent} dangerouslySetInnerHTML={{ __html: content }} />;
    }
    // Legacy plain text: wrap in paragraph and apply formatContent for channel links
    return <span style={styles.announcementContent}>{formatContent(content)}</span>;
  }

  function renderAnnouncementModal() {
    if (!showAnnouncementModal) return null;
    const ToolbarBtn = ({ active, onClick, title, children }) => (
      <button
        onClick={onClick}
        title={title}
        style={{
          background: active ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
          border: '1px solid ' + (active ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'),
          borderRadius: 5,
          color: active ? '#a5b4fc' : 'rgba(255,255,255,0.6)',
          cursor: 'pointer',
          padding: '4px 8px',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: active ? 700 : 400,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 28,
          height: 28,
        }}
      >
        {children}
      </button>
    );
    return (
      <div style={styles.announcementModalOverlay} onClick={() => setShowAnnouncementModal(false)}>
        <div style={styles.announcementModalContent} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>New Announcement</h3>
            <button onClick={() => setShowAnnouncementModal(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          {/* Collapsible toolbar */}
          <div style={{ marginBottom: 8 }}>
            <button
              onClick={() => setAnnouncementToolbarOpen(prev => !prev)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: announcementToolbarOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}>
                <path d="M2 3.5l3 3 3-3" />
              </svg>
              Formatting
            </button>
            {announcementToolbarOpen && announcementEditor && (
              <div style={styles.announcementToolbar}>
                <ToolbarBtn active={announcementEditor.isActive('bold')} onClick={() => announcementEditor.chain().focus().toggleBold().run()} title="Bold">
                  <strong>B</strong>
                </ToolbarBtn>
                <ToolbarBtn active={announcementEditor.isActive('italic')} onClick={() => announcementEditor.chain().focus().toggleItalic().run()} title="Italic">
                  <em>I</em>
                </ToolbarBtn>
                <ToolbarBtn active={announcementEditor.isActive('underline')} onClick={() => announcementEditor.chain().focus().toggleUnderline().run()} title="Underline">
                  <span style={{ textDecoration: 'underline' }}>U</span>
                </ToolbarBtn>
                <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                <ToolbarBtn active={announcementEditor.isActive('bulletList')} onClick={() => announcementEditor.chain().focus().toggleBulletList().run()} title="Bullet List">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <circle cx="2.5" cy="3.5" r="1" fill="currentColor" stroke="none" />
                    <circle cx="2.5" cy="7" r="1" fill="currentColor" stroke="none" />
                    <circle cx="2.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
                    <line x1="5.5" y1="3.5" x2="12" y2="3.5" />
                    <line x1="5.5" y1="7" x2="12" y2="7" />
                    <line x1="5.5" y1="10.5" x2="12" y2="10.5" />
                  </svg>
                </ToolbarBtn>
                <ToolbarBtn active={announcementEditor.isActive('orderedList')} onClick={() => announcementEditor.chain().focus().toggleOrderedList().run()} title="Numbered List">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <text x="1" y="5" fontSize="5" fill="currentColor" stroke="none" fontFamily="inherit">1</text>
                    <text x="1" y="8.5" fontSize="5" fill="currentColor" stroke="none" fontFamily="inherit">2</text>
                    <text x="1" y="12" fontSize="5" fill="currentColor" stroke="none" fontFamily="inherit">3</text>
                    <line x1="5.5" y1="3.5" x2="12" y2="3.5" />
                    <line x1="5.5" y1="7" x2="12" y2="7" />
                    <line x1="5.5" y1="10.5" x2="12" y2="10.5" />
                  </svg>
                </ToolbarBtn>
              </div>
            )}
          </div>

          {/* Editor */}
          <style>{`
            .announcement-editor .tiptap { outline: none; min-height: 100px; }
            .announcement-editor .tiptap p { margin: 0 0 0.4em; }
            .announcement-editor .tiptap ul, .announcement-editor .tiptap ol { padding-left: 1.4em; margin: 0.2em 0; }
            .announcement-editor .tiptap li { margin: 0.1em 0; }
            .announcement-editor .tiptap p.is-editor-empty:first-child::before {
              content: attr(data-placeholder);
              color: rgba(255,255,255,0.25);
              pointer-events: none;
              float: left;
              height: 0;
            }
          `}</style>
          <div style={styles.announcementEditorWrap} className="announcement-editor">
            <EditorContent editor={announcementEditor} />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button onClick={() => { announcementEditor?.commands.clearContent(); setShowAnnouncementModal(false); }} style={styles.cancelTitleBtn}>Cancel</button>
            <button onClick={addAnnouncement} style={styles.announcementPostBtn}>Post</button>
          </div>
        </div>
      </div>
    );
  }

  function renderAnnouncements({ showInput }) {
    const unreadCount = announcements.filter(a => !a.isRead).length;
    return (
      <div style={styles.announcementsSection}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: announcementsCollapsed ? 0 : undefined }}>
          <h3
            onClick={() => setAnnouncementsCollapsed(prev => !prev)}
            style={{ ...styles.subSectionTitle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}
          >
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>{announcementsCollapsed ? '▶' : '▼'}</span>
            Announcements
            {announcementsCollapsed && unreadCount > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#6366f1', marginLeft: 4 }}>
                {unreadCount} unread
              </span>
            )}
          </h3>
          {!announcementsCollapsed && showInput && (
            <button
              onClick={() => { announcementEditor?.commands.clearContent(); setShowAnnouncementModal(true); }}
              style={styles.postAnnouncementBtn}
            >
              + Post
            </button>
          )}
        </div>
        {!announcementsCollapsed && (
          announcementsLoading ? (
            <p style={styles.emptyText}>Loading...</p>
          ) : announcements.length === 0 ? (
            <p style={{ ...styles.emptyText, marginTop: '8px' }}>No announcements</p>
          ) : (
            <div style={styles.announcementList}>
              {announcements.map(a => (
                <div key={a.id} style={{
                  ...styles.announcementItem,
                  borderLeft: a.isRead ? '3px solid rgba(255,255,255,0.1)' : '3px solid #6366f1',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {renderAnnouncementContent(a.content)}
                    <span style={styles.announcementMeta}>
                      {a.creator?.full_name} &middot; {new Date(a.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={styles.announcementActions}>
                    {!a.isRead && (
                      <button onClick={() => markAnnouncementRead(a.id)} style={styles.readBtn}>
                        Mark Read
                      </button>
                    )}
                    {a.created_by === profile.id && (
                      <button
                        onClick={() => deleteAnnouncement(a.id)}
                        style={{ ...styles.itineraryActionBtn, color: '#ef4444' }}
                        title="Delete"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    );
  }

  // ── Today's Schedule renderer ──
  function renderTodaySchedule() {
    const isGoogleSource = isAdmin && todayEvents.length > 0 && todayEvents[0]?.source === 'google';
    return (
      <div style={styles.scheduleSection}>
        <h3 style={styles.subSectionTitle}>Today's Schedule</h3>
        {eventsLoading ? (
          <p style={styles.emptyText}>Loading...</p>
        ) : todayEvents.length === 0 ? (
          <p style={{ ...styles.emptyText, marginTop: '8px' }}>No events scheduled for today</p>
        ) : (
          <div style={styles.scheduleList}>
            {todayEvents.map(ev => {
              const color = isGoogleSource
                ? '#3b82f6'
                : (EVENT_TYPE_COLORS[ev.event_type] || '#6b7280');
              const icon = isGoogleSource
                ? '\u2022'
                : (EVENT_TYPE_ICONS[ev.event_type] || '\u2022');
              const startD = new Date(ev.start_date);
              const endD = new Date(ev.end_date);
              const timeStr = ev.all_day
                ? 'All day'
                : `${startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} \u2013 ${endD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
              return (
                <div key={ev.id} style={{ ...styles.scheduleItem, borderLeftColor: color }}>
                  <div style={styles.scheduleItemHeader}>
                    <span style={{ fontSize: '13px' }}>{icon}</span>
                    <span style={{ ...styles.scheduleItemTitle, color }}>{ev.title}</span>
                    {!isGoogleSource && ev.event_type && (
                      <span style={styles.scheduleItemType}>{EVENT_TYPE_LABELS[ev.event_type]}</span>
                    )}
                  </div>
                  <div style={styles.scheduleItemMeta}>
                    <span>{timeStr}</span>
                    {ev.location && <span> &middot; {ev.location}</span>}
                  </div>
                  {ev.description && (
                    <p style={styles.scheduleItemDesc}>{ev.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const isMember = !isAdmin && !isAssistant && !isPartner;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.greeting}>
            Welcome back, {profile?.full_name?.split(' ')[0]}
          </h1>
          <p style={styles.date}>
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: '28px', alignItems: 'flex-start' }}>
      {/* Left Column */}
      <div style={{ flex: 1, minWidth: 0 }}>

      {/* Profile Card */}
      <div style={styles.profileCard}>
        <label
          style={styles.profileAvatarUpload}
          title="Click to upload a profile picture"
          onMouseEnter={() => setAvatarHover(true)}
          onMouseLeave={() => setAvatarHover(false)}
        >
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" style={styles.profileAvatarImg} />
          ) : (
            <div style={styles.profileAvatar}>
              {profile?.full_name?.charAt(0)?.toUpperCase()}
            </div>
          )}
          <div style={{ ...styles.profileAvatarHover, opacity: (avatarHover || avatarUploading) ? 1 : 0 }}>
            {avatarUploading ? '…' : '📷'}
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarUpload}
          />
        </label>
        <div style={styles.profileInfo}>
          {editingName ? (
            <div style={styles.titleEdit}>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Enter your name"
                style={styles.titleInput}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
              />
              <button onClick={handleNameSave} style={styles.saveTitleBtn}>Save</button>
              <button onClick={() => setEditingName(false)} style={styles.cancelTitleBtn}>Cancel</button>
            </div>
          ) : (
            <h2
              style={{ ...styles.profileName, cursor: 'pointer' }}
              onClick={() => { setNameDraft(profile?.full_name || ''); setEditingName(true); }}
              title="Click to edit"
            >
              {profile?.full_name} <span style={{ fontSize: '14px', opacity: 0.4 }}>✎</span>
            </h2>
          )}
          {editingTitle ? (
            <div style={styles.titleEdit}>
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                placeholder="Enter your title"
                style={styles.titleInput}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
              />
              <button onClick={handleTitleSave} style={styles.saveTitleBtn}>Save</button>
              <button onClick={() => setEditingTitle(false)} style={styles.cancelTitleBtn}>Cancel</button>
            </div>
          ) : (
            <p
              style={styles.profileTitle}
              onClick={() => { setTitleDraft(profile?.title || ''); setEditingTitle(true); }}
              title="Click to edit"
            >
              {profile?.title || 'Click to set your title'} ✎
            </p>
          )}
          <p style={styles.profileEmail}>{profile?.email}</p>
        </div>
        <button
          onClick={() => setShowSettingsModal(true)}
          style={styles.settingsCog}
          title="Settings"
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.textMuted; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
        >
          <span style={styles.settingsCogIcon}>⚙</span>
          Settings
        </button>
      </div>

      {/* Announcements */}
      <div style={{ ...styles.itineraryCard, marginBottom: '36px' }}>
        {renderAnnouncements({ showInput: isAdmin || isAssistant })}
      </div>

      {/* Today */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Today</h2>
        <div style={styles.itineraryCard}>
          <h3 style={styles.subSectionTitle}>My Tasks</h3>
          {assignmentCommentNotifs.map(notif => (
            <div key={notif.id} style={styles.assignmentCommentCard}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '2px' }}>
                  There's a new comment on an Assignment that needs your attention.
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {notif.body}
                </div>
              </div>
              <button onClick={() => handleGoToAssignmentComment(notif)} style={styles.assignmentCommentBtn}>
                Go There
              </button>
            </div>
          ))}
          <MyTasks embedded onNavigate={onNavigate} />
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '16px 0' }} />
          {renderTodaySchedule()}
          {renderTodoList()}
        </div>
      </div>

      {/* Team + Check In */}
      <div style={styles.section}>
        <div style={styles.teamCheckinRow}>

          {/* Team Column */}
          <div style={styles.teamCol}>
            <h2 style={styles.sectionTitle}>Team</h2>
            <div style={{ ...styles.teamCard, flex: 1 }}>
              {/* My Status Controls */}
              <div style={styles.myStatusRow}>
                <span style={styles.myStatusLabel}>Your status:</span>
                <div style={{ position: 'relative' }} ref={statusMenuRef}>
                  <button
                    onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                    style={styles.statusPickerBtn}
                  >
                    <span style={{
                      ...styles.statusDot,
                      background: getEffectiveStatus({ status: profile?.status, last_seen_at: profile?.last_seen_at }) === 'online'
                        ? '#22c55e' : getEffectiveStatus({ status: profile?.status, last_seen_at: profile?.last_seen_at }) === 'busy'
                        ? '#f59e0b' : '#6b7280',
                    }} />
                    <span style={styles.statusPickerText}>
                      {getEffectiveStatus({ status: profile?.status, last_seen_at: profile?.last_seen_at }) === 'online'
                        ? 'Online' : getEffectiveStatus({ status: profile?.status, last_seen_at: profile?.last_seen_at }) === 'busy'
                        ? 'Busy' : 'Offline'}
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.5 }}>▼</span>
                  </button>
                  {statusMenuOpen && (
                    <div style={styles.statusDropdown}>
                      {[
                        { key: 'online', label: 'Online', color: '#22c55e' },
                        { key: 'busy', label: 'Busy', color: '#f59e0b' },
                        { key: 'offline', label: 'Offline', color: '#6b7280' },
                      ].map(opt => (
                        <button
                          key={opt.key}
                          onClick={() => setMyStatus(opt.key)}
                          style={styles.statusDropdownItem}
                        >
                          <span style={{ ...styles.statusDot, background: opt.color }} />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowOooModal(true); }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'rgba(255,255,255,0.5)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Request OOO
                </button>
                <div style={{ flex: 1 }} />
                {editingStatusNote ? (
                  <div style={styles.noteEditRow}>
                    <input
                      value={statusNoteDraft}
                      onChange={(e) => setStatusNoteDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveStatusNote();
                        if (e.key === 'Escape') { setEditingStatusNote(false); setStatusNoteDraft(profile?.status_note || ''); }
                      }}
                      placeholder="Set a status note..."
                      style={styles.noteInput}
                      autoFocus
                      maxLength={100}
                    />
                    <button onClick={saveStatusNote} style={styles.noteSaveBtn}>Save</button>
                    <button onClick={() => { setEditingStatusNote(false); setStatusNoteDraft(profile?.status_note || ''); }} style={styles.noteCancelBtn}>Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setStatusNoteDraft(profile?.status_note || ''); setEditingStatusNote(true); }}
                    style={styles.noteSetBtn}
                  >
                    {profile?.status_note || 'Set a note...'}
                  </button>
                )}
              </div>

              {/* Team Members List */}
              {teamLoading ? (
                <p style={styles.emptyText}>Loading...</p>
              ) : (
                <div style={styles.teamList}>
                  {teamProfiles
                    .sort((a, b) => {
                      const order = { online: 0, busy: 1, offline: 2 };
                      return (order[getEffectiveStatus(a)] ?? 2) - (order[getEffectiveStatus(b)] ?? 2);
                    })
                    .map(member => {
                      const isOoo = approvedOooToday.includes(member.id);
                      const effectiveStatus = getEffectiveStatus(member);
                      const dotColor = isOoo ? '#f97316' : effectiveStatus === 'online' ? '#22c55e' : effectiveStatus === 'busy' ? '#f59e0b' : '#6b7280';
                      const isMe = member.id === profile?.id;
                      return (
                        <div key={member.id} style={{
                          ...styles.teamMember,
                          opacity: isOoo ? 0.7 : effectiveStatus === 'offline' ? 0.5 : 1,
                        }}>
                          <div style={styles.teamMemberAvatar}>
                            {member.avatar_url ? (
                              <img src={member.avatar_url} alt="" style={styles.teamMemberAvatarImg} />
                            ) : (member.full_name?.charAt(0)?.toUpperCase() || '?')}
                            <span style={{ ...styles.statusIndicator, background: dotColor }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={styles.teamMemberName}>
                              {member.full_name}{isMe && <span style={styles.youBadge}>you</span>}
                            </div>
                            <div style={styles.teamMemberMeta}>
                              {member.title && <span>{member.title}</span>}
                              {!isOoo && member.status_note && (
                                <span style={styles.teamMemberNote}>
                                  {member.title ? ' · ' : ''}{member.status_note}
                                </span>
                              )}
                            </div>
                          </div>
                          <span style={{ ...styles.statusLabel, color: dotColor }}>
                            {isOoo ? 'Out of Office' : effectiveStatus === 'online' ? 'Online' : effectiveStatus === 'busy' ? 'Busy' : 'Offline'}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Check In Column */}
          <div style={styles.checkinCol}>
            <h2 style={styles.sectionTitle}>Check In</h2>
            <div style={styles.checkinCard}>
              {checkinLoading ? (
                <p style={styles.emptyText}>Loading...</p>
              ) : (todayCheckin && !checkinEditing) ? (
                /* Locked view */
                <div style={styles.checkinLockedView}>
                  <p style={styles.checkinQuestion}>What do I have today?</p>
                  <div style={styles.checkinLockedResult}>
                    <span style={{
                      ...styles.checkinRatingBadge,
                      background: `${CHECKIN_COLORS[todayCheckin.rating]}20`,
                      color: CHECKIN_COLORS[todayCheckin.rating],
                      borderColor: `${CHECKIN_COLORS[todayCheckin.rating]}40`,
                    }}>
                      {todayCheckin.rating} — {CHECKIN_LABELS[todayCheckin.rating]}
                    </span>
                    <button
                      onClick={() => { setCheckinRating(todayCheckin.rating); setCheckinNote(todayCheckin.note || ''); setCheckinEditing(true); }}
                      style={styles.checkinEditBtn}
                    >
                      Edit
                    </button>
                  </div>
                  {todayCheckin.note && (
                    <p style={styles.checkinLockedNote}>{todayCheckin.note}</p>
                  )}
                </div>
              ) : (
                /* Input form */
                <div style={styles.checkinForm}>
                  <p style={styles.checkinQuestion}>What do I have today?</p>
                  <div style={styles.checkinOptions}>
                    {[1, 2, 3, 4, 5].map(r => (
                      <button
                        key={r}
                        onClick={() => setCheckinRating(r)}
                        style={{
                          ...styles.checkinOption,
                          borderColor: checkinRating === r ? CHECKIN_COLORS[r] : 'rgba(255,255,255,0.08)',
                          background: checkinRating === r ? `${CHECKIN_COLORS[r]}18` : 'rgba(255,255,255,0.03)',
                          color: checkinRating === r ? CHECKIN_COLORS[r] : 'rgba(255,255,255,0.55)',
                        }}
                      >
                        <span style={{
                          width: '10px', height: '10px', borderRadius: '50%',
                          background: CHECKIN_COLORS[r], flexShrink: 0,
                          display: 'inline-block',
                        }} />
                        {r} — {CHECKIN_LABELS[r]}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={checkinNote}
                    onChange={e => setCheckinNote(e.target.value)}
                    placeholder="Optional note..."
                    style={styles.checkinNoteInput}
                    rows={2}
                    maxLength={300}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={saveCheckin}
                      disabled={!checkinRating}
                      style={{
                        ...styles.checkinSubmitBtn,
                        opacity: checkinRating ? 1 : 0.4,
                        cursor: checkinRating ? 'pointer' : 'default',
                      }}
                    >
                      {todayCheckin ? 'Update' : 'Submit'}
                    </button>
                    {checkinEditing && (
                      <button
                        onClick={() => setCheckinEditing(false)}
                        style={styles.checkinCancelBtn}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Graph */}
              {(() => {
                const days = checkinView === 'week' ? 7 : 30;
                const graphData = [];
                for (let i = days - 1; i >= 0; i--) {
                  const d = new Date();
                  d.setDate(d.getDate() - i);
                  const dateStr = d.toISOString().split('T')[0];
                  const record = checkinHistory.find(r => r.date === dateStr);
                  graphData.push({
                    date: dateStr,
                    rating: record ? record.rating : null,
                    label: checkinView === 'week'
                      ? d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)
                      : (i === 0 ? 'T' : d.getDate() % 5 === 0 ? d.getDate().toString() : ''),
                  });
                }
                const validRatings = graphData.filter(d => d.rating !== null).map(d => d.rating);
                const avg = validRatings.length > 0
                  ? (validRatings.reduce((a, b) => a + b, 0) / validRatings.length).toFixed(1)
                  : null;
                return (
                  <div style={styles.checkinGraph}>
                    <div style={styles.checkinGraphHeader}>
                      <div style={styles.checkinViewToggle}>
                        {['week', 'month'].map(v => (
                          <button
                            key={v}
                            onClick={() => setCheckinView(v)}
                            style={{
                              ...styles.checkinViewBtn,
                              background: checkinView === v ? 'rgba(255,255,255,0.1)' : 'transparent',
                              color: checkinView === v ? '#e2e8f0' : 'rgba(255,255,255,0.35)',
                            }}
                          >
                            {v.charAt(0).toUpperCase() + v.slice(1)}
                          </button>
                        ))}
                      </div>
                      {avg !== null && (
                        <span style={styles.checkinAvg}>
                          Avg <span style={{ color: CHECKIN_COLORS[Math.round(Number(avg))] || '#e2e8f0', fontWeight: 700 }}>{avg}</span>
                        </span>
                      )}
                    </div>
                    <div style={styles.checkinBars}>
                      {graphData.map((day, i) => (
                        <div key={i} style={styles.checkinBarCol}>
                          <div style={styles.checkinBarTrack}>
                            {day.rating !== null ? (
                              <div style={{
                                ...styles.checkinBar,
                                height: `${(day.rating / 5) * 100}%`,
                                background: CHECKIN_COLORS[day.rating],
                              }} />
                            ) : (
                              <div style={styles.checkinBarEmpty} />
                            )}
                          </div>
                          {day.label && (
                            <span style={styles.checkinBarLabel}>{day.label}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

        </div>
      </div>

      {/* Admin: Pending OOO Requests */}
      {isAdmin && pendingOooRequests.length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Pending Requests</h2>
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '12px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}>
            {pendingOooRequests.map(req => {
              const startFmt = new Date(req.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const endFmt = new Date(req.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              return (
                <div key={req.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  background: 'rgba(249,115,22,0.06)',
                  border: '1px solid rgba(249,115,22,0.15)',
                  borderRadius: '8px',
                }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: 'rgba(249,115,22,0.15)', color: '#f97316',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '13px', fontWeight: 700, flexShrink: 0,
                  }}>
                    {req.requester?.full_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                      {req.requester?.full_name || 'Unknown'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#f97316', fontWeight: 600, marginTop: '2px' }}>
                      Out of Office
                    </div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>
                      {startFmt} {'\u2013'} {endFmt}
                    </div>
                  </div>
                  <button
                    onClick={() => handleOooDecision(req, 'approved')}
                    disabled={!!oooProcessingId}
                    style={{
                      padding: '5px 12px', borderRadius: '6px',
                      border: '1px solid rgba(34,197,94,0.3)',
                      background: 'rgba(34,197,94,0.1)', color: '#22c55e',
                      fontSize: '11px', fontWeight: 600, cursor: oooProcessingId ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                      opacity: oooProcessingId ? 0.5 : 1,
                    }}
                  >
                    {oooProcessingId === req.id ? 'Approving...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => handleOooDecision(req, 'rejected')}
                    disabled={!!oooProcessingId}
                    style={{
                      padding: '5px 12px', borderRadius: '6px',
                      border: '1px solid rgba(239,68,68,0.3)',
                      background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                      fontSize: '11px', fontWeight: 600, cursor: oooProcessingId ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                      opacity: oooProcessingId ? 0.5 : 1,
                    }}
                  >
                    Decline
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin: Upcoming Out of Office */}
      {isAdmin && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Upcoming Out of Office</h2>
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '12px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}>
            {upcomingOoo.length === 0 ? (
              <div style={{
                color: 'rgba(255,255,255,0.45)',
                fontSize: '13px',
                fontStyle: 'italic',
                padding: '6px 4px',
              }}>
                No upcoming time off.
              </div>
            ) : upcomingOoo.map(ev => {
              const start = new Date(ev.start_date);
              const end = new Date(ev.end_date);
              const now = new Date();
              const isCurrentlyOut = start <= now && now <= end;
              const startDayKey = start.toISOString().slice(0, 10);
              const endDayKey = end.toISOString().slice(0, 10);
              const isSingleDay = startDayKey === endDayKey;
              const startFmt = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const endFmt = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

              let timeStr = null;
              if (ev.all_day === false) {
                const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                timeStr = `${fmtTime(start)} \u2013 ${fmtTime(end)}`;
              }

              const displayTitle = ev.title || 'Unavailable';
              const initial = displayTitle.trim().charAt(0).toUpperCase() || '?';

              return (
                <div key={ev.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  background: isCurrentlyOut ? 'rgba(249,115,22,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isCurrentlyOut ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: '8px',
                }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: 'rgba(249,115,22,0.15)', color: '#f97316',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '13px', fontWeight: 700, flexShrink: 0,
                  }}>
                    {initial}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                        {displayTitle}
                      </span>
                      {isCurrentlyOut && (
                        <span style={{
                          fontSize: '10px', fontWeight: 700, color: '#f97316',
                          background: 'rgba(249,115,22,0.12)',
                          padding: '2px 6px', borderRadius: '4px',
                        }}>
                          Currently Out
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginTop: '2px' }}>
                      {isSingleDay ? startFmt : `${startFmt} \u2013 ${endFmt}`}
                      {timeStr && <span style={{ marginLeft: '6px' }}>{timeStr}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sponsored Deliverables */}
      {!isPartner && (sponsorDeliverables.length > 0 || sponsorDelLoading) && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Sponsored</h2>
          {sponsorDelLoading ? (
            <p style={styles.emptyText}>Loading...</p>
          ) : (
            <div style={styles.projectGrid}>
              {sponsorDeliverables.map(d => {
                const days = d.due_date ? getDaysUntil(d.due_date) : null;
                const urgency = days !== null ? getUrgencyColor(days) : null;
                return (
                  <div key={d.id} style={styles.projectCard}>
                    <div style={styles.projectCardHeader}>
                      <span style={{
                        ...styles.statusBadge,
                        background: `${DELIVERABLE_STAGE_COLORS[d.status] || '#6b7280'}20`,
                        color: DELIVERABLE_STAGE_COLORS[d.status] || '#6b7280',
                      }}>
                        {DELIVERABLE_STAGE_LABELS[d.status] || d.status}
                      </span>
                      <span style={styles.roleBadge}>{DELIVERABLE_STAGE_LABELS[d.assigned_stage] || d.assigned_stage}</span>
                    </div>
                    <h3 style={styles.projectName}>{d.title}</h3>
                    <p style={styles.projectChannel}>{d.sponsor_name}{d.campaign_name ? ` — ${d.campaign_name}` : ''}</p>
                    {days !== null && (
                      <>
                        <div style={styles.projectDeadline}>
                          <div style={{ ...styles.deadlineIndicator, background: urgency }} />
                          <span style={{ color: urgency, fontWeight: 600, fontSize: '13px' }}>
                            {days < 0
                              ? `${Math.abs(days)} days overdue`
                              : days === 0
                                ? 'Due today'
                                : `${days} days remaining`}
                          </span>
                        </div>
                        <div style={styles.projectDates}>
                          <span>Due {new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}


      {/* Completed Projects */}
      {!isPartner && completedAssignments.length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Recently Completed</h2>
          <div style={styles.completedList}>
            {completedAssignments.slice(0, 5).map(({ project, assignment_role }) => (
              <div key={project.id} style={styles.completedItem}>
                <div style={styles.checkIcon}>✓</div>
                <span style={styles.completedName}>{project.name}</span>
                <span style={styles.completedRole}>{assignment_role}</span>
                <span style={styles.completedDate}>
                  {new Date(project.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      </div>
      {/* Right Column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={styles.sectionTitle}>Sprint</h2>
        {/* Sprint Planning */}
        {!isPartner && <SprintPanel profile={profile} boardVersion={boardVersion} onSprintChange={() => setSprintVersion(v => v + 1)} />}

        {/* SprintBoard */}
        {!isPartner && <SprintBoard profile={profile} onNavigate={onNavigate} todayEvents={todayEvents} onBoardChange={() => setBoardVersion(v => v + 1)} sprintVersion={sprintVersion} />}
      </div>
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div
          style={modalOverlay()}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowSettingsModal(false); }}
        >
          <div style={{ ...modalShell({ width: 420 }), fontFamily: 'inherit' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{
              margin: `0 0 ${spacing.xl}px`,
              fontSize: fontSizes.xl,
              fontWeight: fontWeights.bold,
              color: colors.text,
            }}>
              Settings
            </h3>

            {/* Desktop + Mobile notification sections */}
            <NotificationSettings />

            {/* Morty */}
            <div style={styles.settingsRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.settingsLabel}>Morty</div>
                <div style={styles.settingsCaption}>Mascot appearances around the app</div>
              </div>
              {isAdmin && profile?.mascot_enabled !== false && (
                <button
                  onClick={() => window.dispatchEvent(new Event('summon-morty'))}
                  style={{ ...buttonRecipe({ variant: 'ghost', size: 'sm' }), color: colors.accentFg, borderColor: colors.accentBorder, fontFamily: 'inherit' }}
                  title="Summon Morty now"
                >
                  Summon
                </button>
              )}
              <ToggleSwitch
                on={profile?.mascot_enabled !== false}
                onClick={() => updateProfile({ mascot_enabled: profile?.mascot_enabled === false ? true : false })}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: spacing.xl }}>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{ ...buttonRecipe({ variant: 'secondary', size: 'md' }), fontFamily: 'inherit' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Announcement rich content styles */}
      <style>{`
        .announcement-rich p { margin: 0 0 0.3em; }
        .announcement-rich p:last-child { margin-bottom: 0; }
        .announcement-rich ul, .announcement-rich ol { padding-left: 1.4em; margin: 0.2em 0; }
        .announcement-rich li { margin: 0.1em 0; }
      `}</style>

      {/* Announcement Editor Modal */}
      {renderAnnouncementModal()}

      {/* OOO Request Modal */}
      {showOooModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowOooModal(false); }}>
          <div style={{
            background: '#1a1a2e', borderRadius: '14px',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: '28px', width: '380px', maxWidth: '90vw',
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: 700, color: '#fff' }}>
              Request Time Off
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px', fontWeight: 600 }}>
                  Start Date
                </label>
                <input
                  type="date"
                  value={oooStartDate}
                  onChange={(e) => { setOooStartDate(e.target.value); if (!oooEndDate || e.target.value > oooEndDate) setOooEndDate(e.target.value); }}
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                    color: '#e2e8f0', fontSize: '13px', fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px', fontWeight: 600 }}>
                  End Date
                </label>
                <input
                  type="date"
                  value={oooEndDate}
                  min={oooStartDate}
                  onChange={(e) => setOooEndDate(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                    color: '#e2e8f0', fontSize: '13px', fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '22px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowOooModal(false); setOooStartDate(''); setOooEndDate(''); }}
                style={{
                  padding: '8px 16px', borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.1)', background: 'transparent',
                  color: 'rgba(255,255,255,0.6)', fontSize: '13px', fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitOooRequest}
                disabled={!oooStartDate || !oooEndDate || oooSubmitting}
                style={{
                  padding: '8px 16px', borderRadius: '8px',
                  border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.15)',
                  color: '#a5b4fc', fontSize: '13px', fontWeight: 600,
                  cursor: (!oooStartDate || !oooEndDate || oooSubmitting) ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  opacity: (!oooStartDate || !oooEndDate || oooSubmitting) ? 0.5 : 1,
                }}
              >
                {oooSubmitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    padding: '32px 40px',
    maxWidth: 'none',
  },
  assignmentCommentCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 14px',
    marginBottom: '12px',
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: '10px',
  },
  assignmentCommentBtn: {
    flexShrink: 0,
    padding: '8px 16px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  header: {
    marginBottom: '32px',
  },
  greeting: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 4px 0',
    letterSpacing: '-0.5px',
  },
  date: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
  },
  profileCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '16px',
    padding: '28px',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    marginBottom: '36px',
    flexWrap: 'wrap',
  },
  profileAvatar: {
    width: '60px',
    height: '60px',
    borderRadius: '16px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
  },
  profileAvatarUpload: {
    position: 'relative',
    width: '60px',
    height: '60px',
    flexShrink: 0,
    cursor: 'pointer',
    display: 'block',
  },
  profileAvatarImg: {
    width: '60px',
    height: '60px',
    borderRadius: '16px',
    objectFit: 'cover',
    display: 'block',
  },
  profileAvatarHover: {
    position: 'absolute',
    inset: 0,
    borderRadius: '16px',
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    opacity: 0,
    transition: 'opacity 0.15s',
  },
  profileInfo: {
    flex: 1,
    minWidth: '200px',
  },
  settingsCog: {
    marginLeft: 'auto',
    alignSelf: 'center',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: colors.textDim,
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: `${spacing.xs}px ${spacing.md}px`,
    lineHeight: 1,
    transition: 'color 0.15s',
    flexShrink: 0,
  },
  settingsCogIcon: {
    fontSize: '16px',
    lineHeight: 1,
  },
  settingsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: `${spacing.md}px`,
    padding: `${spacing.md}px 0`,
    borderBottom: `1px solid ${colors.border}`,
  },
  settingsLabel: {
    fontSize: `${fontSizes.lg}px`,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  settingsCaption: {
    fontSize: `${fontSizes.sm}px`,
    color: colors.textSubtle,
    marginTop: '2px',
    lineHeight: 1.4,
  },
  profileName: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 2px 0',
  },
  profileTitle: {
    fontSize: '14px',
    color: '#a5b4fc',
    margin: '0 0 2px 0',
    cursor: 'pointer',
  },
  profileEmail: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
  },
  titleEdit: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    margin: '4px 0',
  },
  titleInput: {
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    width: '200px',
  },
  saveTitleBtn: {
    padding: '6px 12px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cancelTitleBtn: {
    padding: '6px 12px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  statsRow: {
    display: 'flex',
    gap: '24px',
  },
  stat: {
    textAlign: 'center',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#ffffff',
  },
  statLabel: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  section: {
    marginBottom: '36px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
    margin: '0 0 16px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  subSectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    margin: '0 0 10px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  // Itinerary styles
  itineraryCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '20px',
  },
  itineraryAddRow: {
    display: 'flex',
    gap: '10px',
    marginBottom: '4px',
  },
  itineraryInput: {
    flex: 1,
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  itineraryAddBtn: {
    padding: '10px 20px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  itineraryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginTop: '12px',
  },
  itineraryItemWrapper: {
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  itineraryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    transition: 'background 0.1s',
  },
  itineraryCheckbox: {
    width: '18px',
    height: '18px',
    accentColor: '#6366f1',
    cursor: 'pointer',
    flexShrink: 0,
  },
  itineraryContent: {
    fontSize: '14px',
    color: '#e2e8f0',
    display: 'block',
  },
  itineraryCreator: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.35)',
    marginTop: '2px',
    display: 'block',
  },
  itineraryEditInput: {
    width: '100%',
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  itineraryActions: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
  itineraryActionBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '4px 6px',
    borderRadius: '4px',
    lineHeight: 1,
  },
  // Admin comment styles
  commentSection: {
    padding: '4px 14px 10px 44px',
  },
  commentEditRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  commentInput: {
    flex: 1,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  commentSaveBtn: {
    padding: '5px 12px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  commentCancelBtn: {
    padding: '5px 12px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  commentDisplay: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
  },
  commentLabel: {
    color: '#a5b4fc',
    fontWeight: 600,
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  commentText: {
    color: 'rgba(255,255,255,0.6)',
    flex: 1,
  },
  commentEditBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    fontSize: '13px',
    padding: '2px 4px',
  },
  addCommentBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    fontSize: '12px',
    padding: 0,
    fontFamily: 'inherit',
  },
  // Announcement styles
  announcementsSection: {
  },
  announcementList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: '10px',
  },
  announcementItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '8px',
  },
  announcementContent: {
    fontSize: '14px',
    color: '#e2e8f0',
    display: 'block',
  },
  announcementMeta: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
    marginTop: '2px',
    display: 'block',
  },
  announcementActions: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexShrink: 0,
  },
  readBtn: {
    padding: '4px 10px',
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: '6px',
    color: '#a5b4fc',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  // Project styles
  projectGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
  },
  projectCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '20px',
    transition: 'border-color 0.15s',
  },
  projectCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  statusBadge: {
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  roleBadge: {
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: 600,
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'capitalize',
  },
  projectName: {
    fontSize: '17px',
    fontWeight: 600,
    color: '#ffffff',
    margin: '0 0 4px 0',
  },
  projectChannel: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 14px 0',
  },
  projectDeadline: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  deadlineIndicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  projectDates: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
  },
  dateArrow: {
    color: 'rgba(255,255,255,0.2)',
  },
  emptyCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: '14px',
    padding: '40px',
    textAlign: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: '14px',
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  },
  completedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  completedItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '10px',
  },
  checkIcon: {
    color: '#22c55e',
    fontSize: '14px',
    fontWeight: 700,
  },
  completedName: {
    flex: 1,
    fontSize: '14px',
    color: 'rgba(255,255,255,0.5)',
  },
  completedRole: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'capitalize',
  },
  completedDate: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.25)',
  },
  channelLink: {
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
    padding: '1px 4px',
    borderRadius: '4px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  // Team styles
  teamCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '20px',
  },
  myStatusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    paddingBottom: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  myStatusLabel: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.45)',
    fontWeight: 600,
  },
  statusPickerBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusPickerText: {
    fontWeight: 600,
  },
  statusDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: '4px',
    background: '#1e1e36',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    padding: '4px',
    zIndex: 50,
    minWidth: '120px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  statusDropdownItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px 10px',
    background: 'none',
    border: 'none',
    borderRadius: '6px',
    color: '#e2e8f0',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  noteEditRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  noteInput: {
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    width: '200px',
  },
  noteSaveBtn: {
    padding: '5px 12px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  noteCancelBtn: {
    padding: '5px 12px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  noteSetBtn: {
    padding: '6px 12px',
    background: 'none',
    border: '1px dashed rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontStyle: 'italic',
    maxWidth: '250px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  teamList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  teamMember: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: '10px',
    transition: 'background 0.1s',
  },
  teamMemberAvatar: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
    position: 'relative',
  },
  teamMemberAvatarImg: {
    width: '36px', height: '36px', borderRadius: '10px', objectFit: 'cover',
  },
  statusIndicator: {
    position: 'absolute',
    bottom: '-2px',
    right: '-2px',
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    border: '2px solid #0f0f1a',
  },
  teamMemberName: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  youBadge: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#a5b4fc',
    background: 'rgba(99,102,241,0.15)',
    padding: '1px 6px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  teamMemberMeta: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  teamMemberNote: {
    color: 'rgba(255,255,255,0.45)',
    fontStyle: 'italic',
  },
  statusLabel: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    flexShrink: 0,
  },
  postAnnouncementBtn: {
    padding: '4px 12px',
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: '6px',
    color: '#a5b4fc',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  scheduleSection: {
    marginBottom: '16px',
    paddingBottom: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  scheduleList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '8px',
  },
  scheduleItem: {
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderLeft: '3px solid',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  scheduleItemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
    minWidth: 0,
  },
  scheduleItemTitle: {
    fontSize: '14px',
    fontWeight: 600,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  scheduleItemType: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  scheduleItemMeta: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  scheduleItemDesc: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
    margin: '4px 0 0 0',
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    wordBreak: 'break-word',
  },
  // Team + Check In layout
  teamCheckinRow: {
    display: 'flex',
    gap: '20px',
    alignItems: 'stretch',
  },
  teamCol: {
    flex: 2,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  checkinCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  // Check In card styles
  checkinCard: {
    flex: 1,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  checkinQuestion: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
    margin: '0 0 10px 0',
  },
  checkinLockedView: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  checkinLockedResult: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  checkinRatingBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    borderRadius: '8px',
    border: '1px solid',
    fontSize: '14px',
    fontWeight: 700,
  },
  checkinEditBtn: {
    padding: '5px 12px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  checkinLockedNote: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    lineHeight: 1.4,
    fontStyle: 'italic',
  },
  checkinForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  checkinOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  checkinOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    border: '1px solid',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    transition: 'background 0.1s, border-color 0.1s',
  },
  checkinNoteInput: {
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'none',
    lineHeight: 1.4,
  },
  checkinSubmitBtn: {
    padding: '8px 20px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  },
  checkinCancelBtn: {
    padding: '8px 14px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  // Graph styles
  checkinGraph: {
    marginTop: 'auto',
    paddingTop: '16px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  checkinGraphHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px',
  },
  checkinViewToggle: {
    display: 'flex',
    gap: '2px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '6px',
    padding: '2px',
  },
  checkinViewBtn: {
    padding: '3px 10px',
    border: 'none',
    borderRadius: '5px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.15s, color 0.15s',
  },
  checkinAvg: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
    fontWeight: 600,
  },
  checkinBars: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '3px',
    height: '60px',
  },
  checkinBarCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    height: '100%',
    gap: '3px',
  },
  checkinBarTrack: {
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    borderRadius: '3px',
    overflow: 'hidden',
    background: 'rgba(255,255,255,0.04)',
  },
  checkinBar: {
    width: '100%',
    borderRadius: '3px 3px 0 0',
    transition: 'height 0.3s',
  },
  checkinBarEmpty: {
    width: '100%',
    height: '2px',
    background: 'rgba(255,255,255,0.06)',
  },
  checkinBarLabel: {
    fontSize: '9px',
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    lineHeight: 1,
  },

  // ── announcement editor modal ──
  announcementModalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  announcementModalContent: {
    background: '#1a1a2e',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '20px 24px',
    width: '100%',
    maxWidth: 540,
    maxHeight: '80vh',
    overflow: 'auto',
  },
  announcementToolbar: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    padding: '6px 0',
  },
  announcementEditorWrap: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '10px 14px',
    minHeight: 120,
    maxHeight: 300,
    overflow: 'auto',
    fontSize: 14,
    color: '#e2e8f0',
    lineHeight: 1.6,
  },
  announcementPostBtn: {
    padding: '6px 18px',
    background: '#6366f1',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
