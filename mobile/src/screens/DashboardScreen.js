import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  TouchableOpacity, TextInput, ActivityIndicator, Modal,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

const TABS = ['General', 'Tasks'];

const CHECKIN_COLORS = {
  1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#84cc16', 5: '#22c55e',
};

const DELIVERABLE_STATUS_COLORS = {
  script: '#3b82f6', production: '#f59e0b', editing: '#f97316',
  sent_for_review: '#ec4899', posted: '#22c55e',
};

const PROJECT_STATUS_COLORS = {
  concept: '#8b5cf6', script: '#3b82f6', production: '#f59e0b',
  edit: '#f97316', review: '#ec4899', published: '#22c55e',
};

const TASK_CATEGORY_COLORS = {
  task: '#6366f1', idea: '#f59e0b', follow_up: '#ec4899', note: '#8b5cf6',
};

const TASK_PRIORITY_COLORS = {
  high: '#ef4444', medium: '#f59e0b', low: '#6b7280',
};

const BOARD_COLUMNS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'done', label: 'Done' },
];

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function formatTimeRange(start, end) {
  if (!start && !end) return 'All day';
  const s = start ? formatTime(start) : '';
  const e = end ? formatTime(end) : '';
  if (s && e) return `${s} – ${e}`;
  return s || e;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target - today) / 86400000);
}

function urgencyColor(days) {
  if (days === null) return colors.textTertiary;
  if (days < 0) return '#ef4444';
  if (days <= 2) return '#f97316';
  if (days <= 7) return '#eab308';
  return colors.textSecondary;
}

function urgencyLabel(days) {
  if (days === null) return '';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `${days}d left`;
}

const EVENT_TYPE_COLORS = {
  meeting: '#3b82f6', deadline: '#ef4444', shoot: '#f59e0b',
  stream: '#8b5cf6', event: '#22c55e', other: colors.textTertiary,
};

// ──────────── COMPONENT ────────────

export default function DashboardScreen() {
  const { user, profile } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [tab, setTab] = useState('General');
  const [refreshing, setRefreshing] = useState(false);

  // General tab state
  const [announcements, setAnnouncements] = useState([]);
  const [todayEvents, setTodayEvents] = useState([]);
  const [itinerary, setItinerary] = useState([]);
  const [teamPresence, setTeamPresence] = useState([]);

  // Check-in state
  const [checkin, setCheckin] = useState(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinRating, setCheckinRating] = useState(null);
  const [checkinNote, setCheckinNote] = useState('');
  const [checkinEditing, setCheckinEditing] = useState(false);
  const [checkinError, setCheckinError] = useState('');

  // Tasks tab state
  const [sponsored, setSponsored] = useState([]);
  const [projectTasks, setProjectTasks] = useState([]);
  const [personalTasks, setPersonalTasks] = useState([]);

  // Out of Office state
  const [pendingOoo, setPendingOoo] = useState([]);
  const [myActiveOoo, setMyActiveOoo] = useState([]);
  const [showOooModal, setShowOooModal] = useState(false);
  const [oooStart, setOooStart] = useState('');
  const [oooEnd, setOooEnd] = useState('');
  const [oooSubmitting, setOooSubmitting] = useState(false);
  const [oooProcessingId, setOooProcessingId] = useState(null);
  const [oooError, setOooError] = useState('');

  const isAdminRole = profile?.role === 'admin'
    || profile?.role === 'director_creative'
    || profile?.role === 'director_comms';

  const todayStr = new Date().toISOString().split('T')[0];

  // ── Fetch General data ──
  const fetchGeneral = useCallback(async () => {
    const [announcementsR, eventsR, itineraryR, presenceR, checkinR] = await Promise.all([
      safeQuery(() =>
        supabase.from('announcements').select('*')
          .eq('target_date', todayStr)
          .order('created_at', { ascending: false })
      ),
      safeQuery(() =>
        supabase.from('calendar_events').select('*')
          .eq('event_date', todayStr)
          .order('start_time', { ascending: true })
      ),
      safeQuery(() =>
        supabase.from('daily_itinerary').select('*')
          .eq('target_date', todayStr)
          .order('time_slot', { ascending: true })
      ),
      safeQuery(() =>
        supabase.from('profiles')
          .select('id, full_name, avatar_url, status, last_seen_at')
          .order('full_name')
      ),
      safeQuery(() =>
        supabase.from('daily_checkins').select('*')
          .eq('user_id', profile?.id)
          .eq('date', todayStr)
      ),
    ]);

    if (announcementsR.data) setAnnouncements(announcementsR.data);
    if (eventsR.data) setTodayEvents(eventsR.data);
    if (itineraryR.data) setItinerary(itineraryR.data);
    if (presenceR.data) {
      const sorted = [...presenceR.data].sort((a, b) => {
        const order = { active: 0, busy: 1 };
        const aO = order[a.status] ?? 2;
        const bO = order[b.status] ?? 2;
        return aO - bO || (a.full_name || '').localeCompare(b.full_name || '');
      });
      setTeamPresence(sorted);
    }
    if (checkinR.data?.length) {
      setCheckin(checkinR.data[0]);
      setCheckinEditing(false);
    } else {
      setCheckin(null);
    }
  }, [safeQuery, profile?.id, todayStr]);

  // ── Fetch OOO ──
  const fetchOoo = useCallback(async () => {
    if (!profile?.id) return;
    const tasks = [
      safeQuery(() =>
        supabase.from('ooo_requests')
          .select('id, user_id, start_date, end_date, status, created_at, requester:profiles!user_id(id, full_name)')
          .eq('user_id', profile.id)
          .in('status', ['pending', 'approved'])
          .gte('end_date', todayStr)
          .order('start_date', { ascending: true })
      ),
    ];
    if (isAdminRole) {
      tasks.push(
        safeQuery(() =>
          supabase.from('ooo_requests')
            .select('id, user_id, start_date, end_date, status, created_at, requester:profiles!user_id(id, full_name)')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
        )
      );
    }
    const results = await Promise.all(tasks);
    if (results[0]?.data) setMyActiveOoo(results[0].data);
    if (isAdminRole && results[1]?.data) {
      setPendingOoo(results[1].data.filter((r) => r.user_id !== profile.id));
    } else if (!isAdminRole) {
      setPendingOoo([]);
    }
  }, [safeQuery, profile?.id, isAdminRole, todayStr]);

  // ── Fetch Tasks data ──
  const fetchTasks = useCallback(async () => {
    if (!profile?.id) return;

    const [sponsoredR, projectR, personalR] = await Promise.all([
      safeQuery(() =>
        supabase.from('deliverable_stage_assignments')
          .select('*, deliverable:sponsor_deliverables(id, title, status, due_date, sponsor_id, campaign_id, sponsors(name), sponsor_campaigns(name))')
          .eq('user_id', profile.id)
      ),
      safeQuery(() =>
        supabase.from('project_stage_assignments')
          .select('*, project:projects(id, name, status, channel, deadline)')
          .eq('user_id', profile.id)
      ),
      safeQuery(() =>
        supabase.from('personal_tasks')
          .select('*')
          .eq('created_by', profile.id)
          .order('position', { ascending: true })
      ),
    ]);

    if (sponsoredR.data) setSponsored(sponsoredR.data);
    if (projectR.data) setProjectTasks(projectR.data);
    if (personalR.data) setPersonalTasks(personalR.data);
  }, [safeQuery, profile?.id]);

  // ── Initial fetch ──
  useEffect(() => { fetchGeneral(); }, [fetchGeneral]);
  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchOoo(); }, [fetchOoo]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchGeneral(), fetchTasks(), fetchOoo()]);
    setRefreshing(false);
  }, [fetchGeneral, fetchTasks, fetchOoo]);

  // ── Check-in submit ──
  const submitCheckin = useCallback(async () => {
    if (!checkinRating) return;
    setCheckinLoading(true);
    setCheckinError('');
    try {
      if (checkin) {
        const { data, error } = await supabase
          .from('daily_checkins')
          .update({ rating: checkinRating, note: checkinNote || null })
          .eq('id', checkin.id)
          .select()
          .single();
        if (error) throw error;
        setCheckin(data);
      } else {
        const { data, error } = await supabase
          .from('daily_checkins')
          .insert({ user_id: profile.id, date: todayStr, rating: checkinRating, note: checkinNote || null })
          .select()
          .single();
        if (error) throw error;
        setCheckin(data);
      }
      setCheckinEditing(false);
      setCheckinRating(null);
      setCheckinNote('');
    } catch (e) {
      setCheckinError(e.message || 'Failed to save');
    } finally {
      setCheckinLoading(false);
    }
  }, [checkin, checkinRating, checkinNote, profile?.id, todayStr]);

  // ── OOO submit ──
  const submitOoo = useCallback(async () => {
    if (!oooStart || !oooEnd || !profile?.id) {
      setOooError('Pick a start and end date');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(oooStart) || !/^\d{4}-\d{2}-\d{2}$/.test(oooEnd)) {
      setOooError('Dates must be YYYY-MM-DD');
      return;
    }
    if (oooEnd < oooStart) {
      setOooError('End date must be on or after start date');
      return;
    }
    setOooSubmitting(true);
    setOooError('');
    try {
      const { error } = await supabase.from('ooo_requests').insert({
        user_id: profile.id,
        start_date: oooStart,
        end_date: oooEnd,
      });
      if (error) throw error;
      // Notify admins.
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .in('role', ['admin', 'director_creative', 'director_comms']);
      const notifications = (admins || [])
        .filter((a) => a.id !== profile.id)
        .map((a) => ({
          user_id: a.id,
          type: 'ooo_request',
          title: `${profile.full_name} requested time off`,
          body: `${oooStart} to ${oooEnd}`,
          created_at: new Date().toISOString(),
        }));
      if (notifications.length > 0) {
        await supabase.from('notifications').insert(notifications);
      }
      setShowOooModal(false);
      setOooStart('');
      setOooEnd('');
      fetchOoo();
    } catch (e) {
      setOooError(e.message || 'Failed to submit');
    } finally {
      setOooSubmitting(false);
    }
  }, [oooStart, oooEnd, profile?.id, profile?.full_name, fetchOoo]);

  // ── OOO approve/decline ──
  const decideOoo = useCallback(async (request, decision) => {
    if (!profile?.id || oooProcessingId) return;
    setOooProcessingId(request.id);
    try {
      if (decision === 'approved') {
        const requesterName = request.requester?.full_name || 'Team member';
        const { data: calEvent, error: evError } = await supabase
          .from('calendar_events')
          .insert({
            title: `${requesterName} — Out of Office`,
            event_type: 'unavailable',
            start_date: new Date(`${request.start_date}T00:00:00`).toISOString(),
            end_date: new Date(`${request.end_date}T23:59:59`).toISOString(),
            all_day: true,
            created_by: profile.id,
          })
          .select('id')
          .single();
        if (evError) throw evError;

        await supabase
          .from('ooo_requests')
          .update({
            status: 'approved',
            reviewed_by: profile.id,
            reviewed_at: new Date().toISOString(),
            calendar_event_id: calEvent.id,
          })
          .eq('id', request.id);

        await supabase.from('notifications').insert({
          user_id: request.user_id,
          type: 'ooo_request',
          title: 'Time off approved',
          body: `Your OOO request (${request.start_date} to ${request.end_date}) was approved.`,
          created_at: new Date().toISOString(),
        });
      } else {
        await supabase
          .from('ooo_requests')
          .update({
            status: 'rejected',
            reviewed_by: profile.id,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', request.id);

        await supabase.from('notifications').insert({
          user_id: request.user_id,
          type: 'ooo_request',
          title: 'Time off declined',
          body: `Your OOO request (${request.start_date} to ${request.end_date}) was declined.`,
          created_at: new Date().toISOString(),
        });
      }
      fetchOoo();
    } catch (e) {
      // Best-effort; surface in console for debugging.
      // eslint-disable-next-line no-console
      console.error('OOO decision failed:', e);
    } finally {
      setOooProcessingId(null);
    }
  }, [profile?.id, oooProcessingId, fetchOoo]);

  function applyOooQuick(days) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + days - 1);
    setOooStart(start.toISOString().slice(0, 10));
    setOooEnd(end.toISOString().slice(0, 10));
  }

  // ── Status helpers ──
  const statusLabel = (s) => s === 'active' ? 'Online' : s === 'busy' ? 'Busy' : 'Offline';
  const statusColor = (s) => s === 'active' ? colors.green : s === 'busy' ? colors.orange : colors.textTertiary;

  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.split(' ');
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name[0].toUpperCase();
  };

  // ── Board grouping ──
  const boardGroups = BOARD_COLUMNS.reduce((acc, col) => {
    acc[col.key] = personalTasks.filter(t => (t.status || 'inbox') === col.key);
    return acc;
  }, {});

  // ──────────── RENDER ────────────

  return (
    <View style={styles.container}>
      {/* Tab row */}
      <View style={styles.tabRow}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Welcome */}
        <Text style={styles.greeting}>
          Welcome back{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
        </Text>

        {/* ═══════ GENERAL TAB ═══════ */}
        {tab === 'General' && (
          <>
            {/* Announcements */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Announcements</Text>
              {announcements.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No announcements today</Text>
                </View>
              ) : (
                announcements.map(a => (
                  <View key={a.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{a.title}</Text>
                    <Text style={styles.cardBody}>{a.content}</Text>
                  </View>
                ))
              )}
            </View>

            {/* Today's Events */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Today</Text>
              {todayEvents.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No events today</Text>
                </View>
              ) : (
                todayEvents.map(ev => (
                  <View key={ev.id} style={styles.eventRow}>
                    <View style={[styles.eventTypeBadge, { backgroundColor: (EVENT_TYPE_COLORS[ev.type] || EVENT_TYPE_COLORS.other) + '22' }]}>
                      <Text style={[styles.eventTypeText, { color: EVENT_TYPE_COLORS[ev.type] || EVENT_TYPE_COLORS.other }]}>
                        {(ev.type || 'event').toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.eventInfo}>
                      <Text style={styles.eventTitle}>{ev.title}</Text>
                      <Text style={styles.eventMeta}>
                        {formatTimeRange(ev.start_time, ev.end_time)}
                        {ev.location ? `  ·  ${ev.location}` : ''}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Itinerary */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Itinerary</Text>
              {itinerary.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No items scheduled</Text>
                </View>
              ) : (
                itinerary.map(item => (
                  <View key={item.id} style={styles.itineraryRow}>
                    <Text style={styles.timeSlot}>{item.time_slot}</Text>
                    <View style={styles.itineraryInfo}>
                      <Text style={styles.itineraryTitle}>{item.title}</Text>
                      {item.description ? <Text style={styles.itineraryDesc}>{item.description}</Text> : null}
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Check-in */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Check-in</Text>
              {checkin && !checkinEditing ? (
                <View style={styles.card}>
                  <View style={styles.checkinLockedRow}>
                    <View style={[styles.checkinBadge, { backgroundColor: CHECKIN_COLORS[checkin.rating] + '22' }]}>
                      <Text style={[styles.checkinBadgeText, { color: CHECKIN_COLORS[checkin.rating] }]}>
                        {checkin.rating}/5
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.editBtn}
                      onPress={() => {
                        setCheckinEditing(true);
                        setCheckinRating(checkin.rating);
                        setCheckinNote(checkin.note || '');
                      }}
                    >
                      <Text style={styles.editBtnText}>Edit</Text>
                    </TouchableOpacity>
                  </View>
                  {checkin.note ? <Text style={styles.checkinNoteText}>{checkin.note}</Text> : null}
                </View>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.checkinPrompt}>What do I have today?</Text>
                  <View style={styles.ratingRow}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <TouchableOpacity
                        key={n}
                        style={[
                          styles.ratingBtn,
                          { backgroundColor: checkinRating === n ? CHECKIN_COLORS[n] : CHECKIN_COLORS[n] + '22' },
                        ]}
                        onPress={() => setCheckinRating(n)}
                      >
                        <Text style={[styles.ratingBtnText, { color: checkinRating === n ? '#fff' : CHECKIN_COLORS[n] }]}>
                          {n}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={styles.checkinInput}
                    placeholder="Add a note (optional)"
                    placeholderTextColor={colors.textTertiary}
                    value={checkinNote}
                    onChangeText={setCheckinNote}
                    maxLength={300}
                    multiline
                  />
                  {checkinError ? <Text style={styles.errorText}>{checkinError}</Text> : null}
                  <TouchableOpacity
                    style={[styles.submitBtn, !checkinRating && styles.submitBtnDisabled]}
                    onPress={submitCheckin}
                    disabled={!checkinRating || checkinLoading}
                  >
                    {checkinLoading
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.submitBtnText}>Submit</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Out of Office */}
            <View style={styles.section}>
              <View style={styles.oooHeader}>
                <Text style={styles.sectionTitle}>Out of Office</Text>
                <TouchableOpacity
                  style={styles.oooRequestBtn}
                  onPress={() => {
                    setOooError('');
                    setOooStart('');
                    setOooEnd('');
                    setShowOooModal(true);
                  }}
                >
                  <Text style={styles.oooRequestBtnText}>+ Request</Text>
                </TouchableOpacity>
              </View>

              {/* My active / upcoming OOO */}
              {myActiveOoo.length > 0 && (
                myActiveOoo.map((r) => (
                  <View key={r.id} style={[styles.card, styles.oooMyCard]}>
                    <Text style={styles.oooStatusLabel}>
                      {r.status === 'pending' ? 'Pending review' : 'Approved'}
                    </Text>
                    <Text style={styles.oooDates}>{r.start_date} → {r.end_date}</Text>
                  </View>
                ))
              )}

              {/* Pending approvals (admin) */}
              {isAdminRole && pendingOoo.length > 0 && (
                <>
                  <Text style={styles.oooSubTitle}>Pending approvals</Text>
                  {pendingOoo.map((r) => {
                    const processing = oooProcessingId === r.id;
                    return (
                      <View key={r.id} style={styles.card}>
                        <Text style={styles.oooRequesterName}>{r.requester?.full_name || 'Team member'}</Text>
                        <Text style={styles.oooStatusLabel}>Out of Office</Text>
                        <Text style={styles.oooDates}>{r.start_date} → {r.end_date}</Text>
                        <View style={styles.oooActionRow}>
                          <TouchableOpacity
                            style={[styles.oooApproveBtn, processing && styles.oooBtnDisabled]}
                            onPress={() => decideOoo(r, 'approved')}
                            disabled={processing}
                          >
                            {processing
                              ? <ActivityIndicator color="#fff" size="small" />
                              : <Text style={styles.oooApproveBtnText}>Approve</Text>
                            }
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.oooDeclineBtn, processing && styles.oooBtnDisabled]}
                            onPress={() => decideOoo(r, 'rejected')}
                            disabled={processing}
                          >
                            <Text style={styles.oooDeclineBtnText}>Decline</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </>
              )}

              {myActiveOoo.length === 0 && (!isAdminRole || pendingOoo.length === 0) && (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No active or pending requests</Text>
                </View>
              )}
            </View>

            {/* Team */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Team</Text>
              {teamPresence.map(member => {
                const isMe = member.id === profile?.id;
                return (
                  <View key={member.id} style={styles.teamRow}>
                    <View style={[styles.teamAvatar, { borderColor: statusColor(member.status) }]}>
                      <Text style={styles.teamAvatarText}>{getInitials(member.full_name)}</Text>
                    </View>
                    <View style={styles.teamInfo}>
                      <View style={styles.teamNameRow}>
                        <Text style={styles.teamName}>{member.full_name || 'Unknown'}</Text>
                        {isMe && (
                          <View style={styles.youBadge}>
                            <Text style={styles.youBadgeText}>you</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.teamStatusRow}>
                        <View style={[styles.teamStatusDot, { backgroundColor: statusColor(member.status) }]} />
                        <Text style={[styles.teamStatusLabel, { color: statusColor(member.status) }]}>
                          {statusLabel(member.status)}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* ═══════ TASKS TAB ═══════ */}
        {tab === 'Tasks' && (
          <>
            {/* Sponsored */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sponsored</Text>
              {sponsored.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No sponsored deliverables</Text>
                </View>
              ) : (
                sponsored.map(item => {
                  const d = item.deliverable;
                  const days = daysUntil(d?.due_date);
                  return (
                    <View key={item.id} style={styles.card}>
                      <View style={styles.taskHeader}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{d?.title || 'Untitled'}</Text>
                        {d?.status && (
                          <View style={[styles.statusBadge, { backgroundColor: (DELIVERABLE_STATUS_COLORS[d.status] || colors.textTertiary) + '22' }]}>
                            <Text style={[styles.statusBadgeText, { color: DELIVERABLE_STATUS_COLORS[d.status] || colors.textTertiary }]}>
                              {d.status.replace(/_/g, ' ')}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.taskMeta}>
                        {d?.sponsors?.name}{d?.sponsor_campaigns?.name ? ` · ${d.sponsor_campaigns.name}` : ''}
                      </Text>
                      {d?.due_date && (
                        <Text style={[styles.taskDue, { color: urgencyColor(days) }]}>
                          {urgencyLabel(days)}
                        </Text>
                      )}
                    </View>
                  );
                })
              )}
            </View>

            {/* Project Tasks */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Project Tasks</Text>
              {projectTasks.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No project tasks</Text>
                </View>
              ) : (
                projectTasks.map(item => {
                  const p = item.project;
                  const days = daysUntil(p?.deadline);
                  return (
                    <View key={item.id} style={styles.card}>
                      <View style={styles.taskHeader}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{p?.name || 'Untitled'}</Text>
                        {p?.status && (
                          <View style={[styles.statusBadge, { backgroundColor: (PROJECT_STATUS_COLORS[p.status] || colors.textTertiary) + '22' }]}>
                            <Text style={[styles.statusBadgeText, { color: PROJECT_STATUS_COLORS[p.status] || colors.textTertiary }]}>
                              {p.status}
                            </Text>
                          </View>
                        )}
                      </View>
                      {p?.channel && <Text style={styles.taskMeta}>{p.channel}</Text>}
                      {p?.deadline && (
                        <Text style={[styles.taskDue, { color: urgencyColor(days) }]}>
                          {urgencyLabel(days)}
                        </Text>
                      )}
                    </View>
                  );
                })
              )}
            </View>

            {/* My Board */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>My Board</Text>
              {personalTasks.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No personal tasks</Text>
                </View>
              ) : (
                BOARD_COLUMNS.map(col => {
                  const items = boardGroups[col.key];
                  if (!items?.length) return null;
                  return (
                    <View key={col.key} style={styles.boardColumn}>
                      <Text style={styles.boardColumnTitle}>{col.label}</Text>
                      {items.map(task => {
                        const days = daysUntil(task.due_date);
                        return (
                          <View
                            key={task.id}
                            style={[
                              styles.boardCard,
                              task.priority && { borderLeftWidth: 3, borderLeftColor: TASK_PRIORITY_COLORS[task.priority] || colors.textTertiary },
                            ]}
                          >
                            <View style={styles.boardCardTop}>
                              <Text style={styles.boardCardText} numberOfLines={2}>{task.content}</Text>
                            </View>
                            <View style={styles.boardCardBottom}>
                              {task.category && (
                                <View style={[styles.categoryBadge, { backgroundColor: (TASK_CATEGORY_COLORS[task.category] || colors.textTertiary) + '22' }]}>
                                  <Text style={[styles.categoryBadgeText, { color: TASK_CATEGORY_COLORS[task.category] || colors.textTertiary }]}>
                                    {task.category.replace(/_/g, ' ')}
                                  </Text>
                                </View>
                              )}
                              {task.due_date && (
                                <Text style={[styles.boardDue, { color: urgencyColor(days) }]}>
                                  {urgencyLabel(days)}
                                </Text>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* OOO Request Modal */}
      <Modal
        visible={showOooModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowOooModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Request Out of Office</Text>
            <Text style={styles.modalHint}>Format: YYYY-MM-DD</Text>

            <View style={styles.oooQuickRow}>
              <TouchableOpacity style={styles.oooQuickBtn} onPress={() => applyOooQuick(1)}>
                <Text style={styles.oooQuickBtnText}>Today</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.oooQuickBtn} onPress={() => applyOooQuick(3)}>
                <Text style={styles.oooQuickBtnText}>3 days</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.oooQuickBtn} onPress={() => applyOooQuick(7)}>
                <Text style={styles.oooQuickBtnText}>1 week</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Start date</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="2026-06-06"
              placeholderTextColor={colors.textTertiary}
              value={oooStart}
              onChangeText={setOooStart}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />
            <Text style={styles.modalLabel}>End date</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="2026-06-08"
              placeholderTextColor={colors.textTertiary}
              value={oooEnd}
              onChangeText={setOooEnd}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />

            {oooError ? <Text style={styles.errorText}>{oooError}</Text> : null}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowOooModal(false)}
                disabled={oooSubmitting}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, oooSubmitting && styles.modalSubmitBtnDisabled]}
                onPress={submitOoo}
                disabled={oooSubmitting}
              >
                {oooSubmitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalSubmitText}>Submit</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ──────────── STYLES ────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingTop: spacing.md },
  greeting: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xxl,
  },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primaryLight },
  tabText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.primary },

  // Sections
  section: { marginBottom: spacing.xxl },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
    flex: 1,
  },
  cardBody: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  emptyCard: {
    padding: spacing.xxl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },

  // Today's Events
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventTypeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    marginTop: 2,
  },
  eventTypeText: { fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.5 },
  eventInfo: { flex: 1 },
  eventTitle: { fontSize: fontSize.md, fontWeight: '500', color: colors.text },
  eventMeta: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },

  // Itinerary
  itineraryRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  timeSlot: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
    width: 60,
    paddingTop: 2,
  },
  itineraryInfo: { flex: 1 },
  itineraryTitle: { fontSize: fontSize.md, fontWeight: '500', color: colors.text },
  itineraryDesc: { fontSize: fontSize.sm, color: colors.textTertiary, marginTop: 2 },

  // Check-in
  checkinLockedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  checkinBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  checkinBadgeText: { fontSize: fontSize.base, fontWeight: '700' },
  checkinNoteText: { fontSize: fontSize.md, color: colors.textSecondary, lineHeight: 20 },
  editBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceHover,
  },
  editBtnText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600' },
  checkinPrompt: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: '500',
    marginBottom: spacing.md,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  ratingBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingBtnText: { fontSize: fontSize.lg, fontWeight: '700' },
  checkinInput: {
    backgroundColor: colors.surfaceHover,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  errorText: { fontSize: fontSize.sm, color: colors.red, marginBottom: spacing.sm },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { fontSize: fontSize.base, fontWeight: '600', color: '#fff' },

  // Team list
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  teamAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  teamAvatarText: { fontSize: fontSize.base, fontWeight: '700', color: colors.textSecondary },
  teamInfo: { flex: 1 },
  teamNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  teamName: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  youBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
  },
  youBadgeText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '600' },
  teamStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  teamStatusDot: { width: 7, height: 7, borderRadius: 4 },
  teamStatusLabel: { fontSize: fontSize.sm, fontWeight: '500' },

  // Tasks tab
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  statusBadgeText: { fontSize: fontSize.xs, fontWeight: '600', textTransform: 'capitalize' },
  taskMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  taskDue: { fontSize: fontSize.sm, fontWeight: '500', marginTop: spacing.xs },

  // My Board
  boardColumn: { marginBottom: spacing.lg },
  boardColumnTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  boardCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  boardCardTop: { marginBottom: spacing.xs },
  boardCardText: { fontSize: fontSize.md, color: colors.text, fontWeight: '500' },
  boardCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  categoryBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  categoryBadgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  boardDue: { fontSize: fontSize.xs, fontWeight: '500' },

  // Out of Office
  oooHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  oooRequestBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.primary + '22',
  },
  oooRequestBtnText: { color: colors.primary, fontWeight: '600', fontSize: fontSize.sm },
  oooMyCard: { borderLeftWidth: 3, borderLeftColor: colors.primary },
  oooSubTitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  oooRequesterName: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  oooStatusLabel: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  oooDates: { fontSize: fontSize.sm, color: colors.text, marginTop: spacing.xs },
  oooActionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  oooApproveBtn: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm,
    backgroundColor: colors.green, alignItems: 'center',
  },
  oooApproveBtnText: { color: '#fff', fontWeight: '600', fontSize: fontSize.sm },
  oooDeclineBtn: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  oooDeclineBtnText: { color: colors.text, fontWeight: '600', fontSize: fontSize.sm },
  oooBtnDisabled: { opacity: 0.5 },

  // Modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: spacing.lg,
  },
  modalCard: {
    width: '100%', backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, gap: spacing.sm,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  modalHint: { fontSize: fontSize.xs, color: colors.textTertiary, marginBottom: spacing.sm },
  modalLabel: {
    fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600',
    marginTop: spacing.sm,
  },
  modalInput: {
    backgroundColor: colors.surfaceHover, borderRadius: radius.sm,
    padding: spacing.sm, color: colors.text, fontSize: fontSize.md,
    borderWidth: 1, borderColor: colors.border,
  },
  oooQuickRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  oooQuickBtn: {
    flex: 1, paddingVertical: spacing.xs, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  oooQuickBtnText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalCancelBtn: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  modalCancelText: { color: colors.text, fontWeight: '600', fontSize: fontSize.sm },
  modalSubmitBtn: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm,
    backgroundColor: colors.primary, alignItems: 'center',
  },
  modalSubmitBtnDisabled: { opacity: 0.5 },
  modalSubmitText: { color: '#fff', fontWeight: '600', fontSize: fontSize.sm },
});
