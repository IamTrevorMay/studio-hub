import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useRealtimeTable from '../hooks/useRealtimeTable';
import { logUploadError } from '../lib/uploadErrors';
import backdropDismiss from '../lib/backdropDismiss';
import { colors } from '../lib/styleTokens';

const SUBMISSIONS_FOLDER_ID = '1r1dENUCjNSs57MjidYbE2rWrbMKXpLM0';

const STATUS_LABELS = {
  assigned: 'Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const STATUS_BADGE_COLORS = {
  assigned: { bg: 'rgba(96,165,250,0.15)', color: '#60a5fa' },
  in_progress: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24' },
  completed: { bg: 'rgba(52,211,153,0.15)', color: '#34d399' },
};

const TYPE_ICONS = {
  edit: '\u2702\uFE0F',
  design: '\uD83C\uDFA8',
  write: '\u270D\uFE0F',
  other: '\uD83D\uDCCB',
};

function formatRelativeTime(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDueDate(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getDueDateStatus(dateString) {
  if (!dateString) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateString + 'T00:00:00');
  due.setHours(0, 0, 0, 0);
  if (due < today) return 'overdue';
  if (due.getTime() === today.getTime()) return 'today';
  return 'future';
}

export default function FreelancerDashboard({ onNavigate }) {
  const { profile } = useAuth();

  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [myPaymentType, setMyPaymentType] = useState(null);
  const [hoursModalAssignment, setHoursModalAssignment] = useState(null);
  const [hoursInput, setHoursInput] = useState('');
  const [hoursSubmitting, setHoursSubmitting] = useState(false);
  const [archivedIds, setArchivedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('fl_archived_assignments') || '[]')); }
    catch { return new Set(); }
  });

  // Submit / Stuck
  const [submitModalAssignment, setSubmitModalAssignment] = useState(null);
  const [uploadedFileUrls, setUploadedFileUrls] = useState({}); // { [assignmentId]: driveUrl }
  const [stuckAssignment, setStuckAssignment] = useState(null);
  const [stuckText, setStuckText] = useState('');
  const [stuckSending, setStuckSending] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [completeConfirmAssignment, setCompleteConfirmAssignment] = useState(null);
  const [myDriveFolderId, setMyDriveFolderId] = useState(null);

  // Notifications + announcements
  const [notifications, setNotifications] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [dismissedAnnouncementIds, setDismissedAnnouncementIds] = useState(new Set());
  const [notifsExpanded, setNotifsExpanded] = useState(false);

  // In-flight guard so double-clicking Submit/Start doesn't double-fire notifications
  const statusChangingRef = useRef(new Set());

  // ── Data Fetching ──────────────────────────────────────────────

  const fetchAssignments = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('freelancer_assignments')
      .select('*, created_by_profile:profiles!freelancer_assignments_created_by_fkey(full_name, avatar_url)')
      .eq('freelancer_id', profile.id)
      .order('created_at', { ascending: false });
    setAssignments(data || []);
    setLoading(false);
  }, [profile?.id]);

  const fetchComments = useCallback(async (assignmentId) => {
    if (!assignmentId) return;
    const { data } = await supabase
      .from('freelancer_assignment_comments')
      .select('*, author:profiles!freelancer_assignment_comments_author_id_fkey(full_name, avatar_url)')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: true });
    setComments(data || []);
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setNotifications(data || []);
  }, [profile?.id]);

  const fetchAnnouncements = useCallback(async () => {
    if (!profile?.id) return;
    const [{ data: anns }, { data: reads }] = await Promise.all([
      supabase.from('announcements')
        .select('*, author:profiles!created_by(full_name)')
        .order('target_date', { ascending: false })
        .limit(10),
      supabase.from('announcement_reads')
        .select('announcement_id')
        .eq('user_id', profile.id),
    ]);
    const readIds = new Set((reads || []).map(r => r.announcement_id));
    setDismissedAnnouncementIds(readIds);
    setAnnouncements(anns || []);
  }, [profile?.id]);

  useEffect(() => {
    fetchAssignments();
    fetchNotifications();
    fetchAnnouncements();
  }, [fetchAssignments, fetchNotifications, fetchAnnouncements]);

  // Deep-link: ?assignment=<id> from notification emails auto-selects that assignment
  useEffect(() => {
    if (loading || assignments.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const target = params.get('assignment');
    if (target && assignments.some(a => a.id === target)) {
      setSelectedId(target);
      params.delete('assignment');
      const search = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (search ? `?${search}` : ''));
    }
  }, [loading, assignments]);

  useEffect(() => {
    if (!profile?.id) return;
    supabase.from('freelancer_profiles').select('payment_type').eq('id', profile.id).single()
      .then(({ data }) => { if (data) setMyPaymentType(data.payment_type); });
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    supabase.from('profiles').select('assigned_drive_folder_id').eq('id', profile.id).single()
      .then(({ data }) => { if (data) setMyDriveFolderId(data.assigned_drive_folder_id); });
  }, [profile?.id]);

  useEffect(() => {
    if (selectedId) {
      fetchComments(selectedId);
    } else {
      setComments([]);
    }
  }, [selectedId, fetchComments]);

  // ── Realtime ───────────────────────────────────────────────────

  const refetchComments = useCallback(() => {
    if (selectedId) fetchComments(selectedId);
  }, [selectedId, fetchComments]);

  useRealtimeTable('fl-assignments', {
    table: 'freelancer_assignments',
    filter: profile?.id ? `freelancer_id=eq.${profile.id}` : undefined,
    onAny: fetchAssignments,
    enabled: !!profile?.id,
  });

  useRealtimeTable('fl-comments', {
    table: 'freelancer_assignment_comments',
    // Scope to the open assignment — refetchComments only loads selectedId's
    // thread, so an unfiltered subscription just caused needless refetch churn.
    filter: selectedId ? `assignment_id=eq.${selectedId}` : undefined,
    onAny: refetchComments,
    enabled: !!profile?.id && !!selectedId,
  });

  useRealtimeTable('fl-notifications', {
    table: 'notifications',
    filter: profile?.id ? `user_id=eq.${profile.id}` : undefined,
    onAny: fetchNotifications,
    enabled: !!profile?.id,
  });

  useRealtimeTable('fl-announcements', {
    table: 'announcements',
    onAny: fetchAnnouncements,
    enabled: !!profile?.id,
  });

  // ── Handlers ───────────────────────────────────────────────────

  async function handleStatusChange(assignment, newStatus) {
    if (statusChangingRef.current.has(assignment.id)) return; // guard double-click
    statusChangingRef.current.add(assignment.id);
    try {
      const updates = { status: newStatus, updated_at: new Date().toISOString() };
      if (newStatus === 'completed') updates.completed_at = new Date().toISOString();
      await supabase.from('freelancer_assignments').update(updates).eq('id', assignment.id);

      if (newStatus === 'completed' && assignment.created_by) {
        await supabase.from('notifications').insert({
          user_id: assignment.created_by,
          type: 'fl_assignment_completed',
          title: 'Assignment Completed',
          body: `${profile.full_name} completed "${assignment.title}"`,
          link_tab: 'freelancers',
          link_target: assignment.id,
        });

        supabase.functions.invoke('send-notification-email', {
          body: {
            trigger_key: 'fl_assignment_completed',
            recipient_id: assignment.created_by,
            context: { assignment_title: assignment.title, person_name: profile.full_name },
          },
        }).catch(() => {});
      }
      fetchAssignments();
    } catch (err) {
      console.error('handleStatusChange failed', err);
    } finally {
      statusChangingRef.current.delete(assignment.id);
    }
  }

  async function handleDeclineAssignment(assignment) {
    if (!window.confirm(`Decline "${assignment.title}"? Your admin will be notified.`)) return;
    await supabase
      .from('freelancer_assignments')
      .update({ declined_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', assignment.id);

    if (assignment.created_by) {
      await supabase.from('notifications').insert({
        user_id: assignment.created_by,
        type: 'fl_assignment_declined',
        title: 'Assignment Declined',
        body: `${profile.full_name} declined "${assignment.title}"`,
        link_tab: 'freelancers',
        link_target: assignment.id,
      });
    }
    if (selectedId === assignment.id) setSelectedId(null);
    fetchAssignments();
  }

  function handleArchiveAssignment(id) {
    const next = new Set([...archivedIds, id]);
    setArchivedIds(next);
    localStorage.setItem('fl_archived_assignments', JSON.stringify([...next]));
    setSelectedId(null);
  }

  async function handlePostComment() {
    if (!newComment.trim() || postingComment) return; // guard double-submit (Enter + button)
    setPostingComment(true);
    try {
      await supabase.from('freelancer_assignment_comments').insert({
        assignment_id: selectedId,
        author_id: profile.id,
        body: newComment.trim(),
      });

      const assignment = assignments.find(a => a.id === selectedId);
      if (assignment && assignment.created_by && profile.id !== assignment.created_by) {
        await supabase.from('notifications').insert({
          user_id: assignment.created_by,
          type: 'fl_comment',
          title: 'New Comment',
          body: `${profile.full_name} commented on "${assignment.title}"`,
          link_tab: 'freelancers',
          link_target: assignment.id,
        });

        supabase.functions.invoke('send-notification-email', {
          body: {
            trigger_key: 'fl_comment',
            recipient_id: assignment.created_by,
            context: { assignment_title: assignment.title, person_name: profile.full_name },
          },
        }).catch(() => {});
      }
      setNewComment('');
      fetchComments(selectedId);
    } finally {
      setPostingComment(false);
    }
  }

  async function handleCompleteWithHours() {
    if (!hoursModalAssignment || !hoursInput) return;
    setHoursSubmitting(true);
    try {
      const hours = parseFloat(hoursInput);
      const updates = {
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        hours_spent: hours,
      };
      await supabase.from('freelancer_assignments').update(updates).eq('id', hoursModalAssignment.id);

      if (hoursModalAssignment.created_by) {
        await supabase.from('notifications').insert({
          user_id: hoursModalAssignment.created_by,
          type: 'fl_assignment_completed',
          title: 'Assignment Completed',
          body: `${profile.full_name} completed "${hoursModalAssignment.title}" (${hours}h)`,
          link_tab: 'freelancers',
          link_target: hoursModalAssignment.id,
        });

        supabase.functions.invoke('send-notification-email', {
          body: {
            trigger_key: 'fl_assignment_completed',
            recipient_id: hoursModalAssignment.created_by,
            context: { assignment_title: hoursModalAssignment.title, person_name: profile.full_name },
          },
        }).catch(() => {});
      }
      setHoursModalAssignment(null);
      setHoursInput('');
      fetchAssignments();
    } catch (err) {
      console.error('handleCompleteWithHours failed', err);
    } finally {
      setHoursSubmitting(false);
    }
  }

  async function handleStuck(assignment) {
    if (!stuckText.trim() || stuckSending) return;
    setStuckSending(true);
    try {
      await supabase.from('freelancer_assignment_comments').insert({
        assignment_id: assignment.id,
        author_id: profile.id,
        body: `\u{1F6A7} Stuck: ${stuckText.trim()}`,
      });

      if (assignment.created_by) {
        await supabase.from('notifications').insert({
          user_id: assignment.created_by,
          type: 'fl_stuck',
          title: 'Contractor Stuck',
          body: `${profile.full_name} is stuck on "${assignment.title}": ${stuckText.trim()}`,
          link_tab: 'freelancers',
          link_target: assignment.id,
        });

        supabase.functions.invoke('send-notification-email', {
          body: {
            trigger_key: 'fl_stuck',
            recipient_id: assignment.created_by,
            context: { assignment_title: assignment.title, person_name: profile.full_name, message: stuckText.trim() },
          },
        }).catch(() => {});
      }

      setStuckText('');
      setStuckAssignment(null);
      fetchComments(assignment.id);
    } finally {
      setStuckSending(false);
    }
  }

  async function handleUploadSuccess(assignment, driveFileUrl) {
    setUploadedFileUrls(prev => ({ ...prev, [assignment.id]: driveFileUrl }));
    await supabase.from('freelancer_assignments')
      .update({ asset_url: driveFileUrl, updated_at: new Date().toISOString() })
      .eq('id', assignment.id);
    fetchAssignments();
  }

  async function handleMarkNotifRead(notifId) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', notifId);
    fetchNotifications();
  }

  async function handleMarkAllNotifsRead() {
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', profile.id).eq('is_read', false);
    fetchNotifications();
  }

  async function handleDismissNotif(notifId) {
    await supabase.from('notifications').delete().eq('id', notifId);
    fetchNotifications();
  }

  async function handleClearAllNotifs() {
    // Clear notifications
    await supabase.from('notifications').delete().eq('user_id', profile.id);
    // Dismiss all visible announcements
    const undismissed = announcements.filter(a => !dismissedAnnouncementIds.has(a.id));
    if (undismissed.length > 0) {
      await supabase.from('announcement_reads').upsert(
        undismissed.map(a => ({ user_id: profile.id, announcement_id: a.id })),
        { onConflict: 'user_id,announcement_id' }
      );
    }
    fetchNotifications();
    fetchAnnouncements();
  }

  async function handleDismissAnnouncement(announcementId) {
    await supabase.from('announcement_reads').upsert(
      { user_id: profile.id, announcement_id: announcementId },
      { onConflict: 'user_id,announcement_id' }
    );
    setDismissedAnnouncementIds(prev => new Set([...prev, announcementId]));
  }

  // ── Derived ────────────────────────────────────────────────────

  const visibleAssignments = assignments.filter(a => !archivedIds.has(a.id) && !a.declined_at);
  const filteredAssignments = statusFilter === 'all'
    ? visibleAssignments
    : visibleAssignments.filter(a => a.status === statusFilter);

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={styles.page}>
        <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 80 }}>Loading...</p>
      </div>
    );
  }

  const unreadNotifs = notifications.filter(n => !n.read);
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const visibleAnnouncements = announcements.filter(a => {
    if (dismissedAnnouncementIds.has(a.id)) return false;
    const when = a.target_date || a.created_at;
    if (!when) return false;
    return new Date(when).getTime() >= threeDaysAgo;
  });
  const allUpdates = [
    ...visibleAnnouncements.map(a => {
      // Strip HTML tags from content for plain text display
      const plainText = a.content ? a.content.replace(/<[^>]*>/g, '').trim() : '';
      return {
        id: `ann-${a.id}`,
        annId: a.id,
        type: 'announcement',
        title: 'Announcement',
        body: plainText || null,
        time: a.target_date || a.created_at,
        read: false,
        author: a.author?.full_name,
      };
    }),
    ...notifications.map(n => ({
      id: n.id,
      type: n.type || 'notification',
      title: n.title,
      body: n.body,
      time: n.created_at,
      read: n.read,
      notifId: n.id,
    })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time));

  return (
    <div style={styles.page}>
      {/* Notifications & Announcements */}
      {allUpdates.length > 0 && (
        <div style={styles.notifsSection}>
          <div
            style={styles.notifsSectionHeader}
            onClick={() => setNotifsExpanded(!notifsExpanded)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                Notifications
              </span>
              {unreadNotifs.length > 0 && (
                <span style={styles.notifsUnreadBadge}>{unreadNotifs.length}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {notifsExpanded && unreadNotifs.length > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); handleMarkAllNotifsRead(); }}
                  style={styles.markAllReadBtn}
                >
                  Mark All Read
                </button>
              )}
              {notifsExpanded && notifications.length > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); handleClearAllNotifs(); }}
                  style={styles.clearAllBtn}
                >
                  Clear All
                </button>
              )}
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                {notifsExpanded ? '\u25B2' : '\u25BC'}
              </span>
            </div>
          </div>
          {notifsExpanded && (
            <div style={styles.notifsList}>
              {allUpdates.slice(0, 10).map(item => (
                <div
                  key={item.id}
                  style={{
                    ...styles.notifItem,
                    ...(item.read ? {} : styles.notifItemUnread),
                  }}
                  onClick={() => {
                    if (item.notifId && !item.read) handleMarkNotifRead(item.notifId);
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {item.type === 'announcement' && (
                          <span style={styles.announcementTag}>Announcement</span>
                        )}
                        <span style={{
                          fontSize: 13,
                          fontWeight: item.read ? 500 : 600,
                          color: item.read ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.9)',
                        }}>
                          {item.title}
                        </span>
                      </div>
                      {item.body && (
                        <p style={{
                          fontSize: 12,
                          color: item.read ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.55)',
                          margin: '4px 0 0',
                          lineHeight: 1.4,
                        }}>
                          {item.body}
                        </p>
                      )}
                      {item.author && (
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2, display: 'block' }}>
                          — {item.author}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>
                        {formatRelativeTime(item.time)}
                      </span>
                      {(item.notifId || item.annId) && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (item.notifId) handleDismissNotif(item.notifId);
                            else if (item.annId) handleDismissAnnouncement(item.annId);
                          }}
                          style={styles.dismissBtn}
                          title="Dismiss"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>My Assignments</h1>
        <p style={styles.subtitle}>
          {visibleAssignments.length} total &middot; {visibleAssignments.filter(a => a.status === 'in_progress').length} in progress
        </p>
      </div>

      {/* Status Filter Pills */}
      <div style={styles.filterRow}>
        {['all', 'assigned', 'in_progress', 'completed'].map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            style={{
              ...styles.filterPill,
              ...(statusFilter === f ? styles.filterPillActive : {}),
            }}
          >
            {f === 'all' ? 'All' : STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Assignment Cards */}
      <div style={styles.cardList}>
        {filteredAssignments.length === 0 && (
          <p style={styles.emptyText}>
            {statusFilter === 'all' ? 'No assignments yet.' : `No ${STATUS_LABELS[statusFilter]?.toLowerCase()} assignments.`}
          </p>
        )}

        {filteredAssignments.map(a => {
          const isExpanded = selectedId === a.id;
          const dueDateStatus = getDueDateStatus(a.due_date);
          const badge = STATUS_BADGE_COLORS[a.status] || STATUS_BADGE_COLORS.assigned;
          const typeIcon = TYPE_ICONS[a.type] || TYPE_ICONS.other;

          return (
            <div key={a.id} style={styles.cardWrapper}>
              {/* Card header (always visible) */}
              <div
                style={{
                  ...styles.card,
                  ...(isExpanded ? styles.cardExpanded : {}),
                }}
                onClick={() => setSelectedId(isExpanded ? null : a.id)}
              >
                <div style={styles.cardRow}>
                  {/* Left: icon + title + due */}
                  <div style={styles.cardLeft}>
                    <span style={styles.typeIcon}>{typeIcon}</span>
                    <div>
                      <span style={styles.cardTitle}>{a.title}</span>
                      {a.due_date && (
                        <span style={{
                          ...styles.dueDate,
                          color: dueDateStatus === 'overdue' ? '#ef4444'
                            : dueDateStatus === 'today' ? '#fbbf24'
                            : 'rgba(255,255,255,0.45)',
                        }}>
                          Due {formatDueDate(a.due_date)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: pay + status */}
                  <div style={styles.cardRight}>
                    {a.pay_amount_cents != null && a.pay_amount_cents > 0 && (
                      <span style={styles.payBadge}>
                        ${(a.pay_amount_cents / 100).toFixed(2)}
                      </span>
                    )}
                    <span style={{
                      ...styles.statusBadge,
                      background: badge.bg,
                      color: badge.color,
                    }}>
                      {STATUS_LABELS[a.status] || a.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={styles.expandedSection}>
                  {/* Description */}
                  {a.description && (
                    <p style={styles.description}>{a.description}</p>
                  )}

                  {/* Asset link */}
                  {a.asset_url && (
                    <p style={{ margin: '0 0 12px' }}>
                      <a
                        href={a.asset_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '6px 12px',
                          background: colors.accentA15,
                          color: colors.accentFg,
                          borderRadius: 8,
                          fontSize: 13,
                          fontWeight: 500,
                          textDecoration: 'none',
                          border: '1px solid rgba(91, 143, 199,0.3)',
                        }}
                      >
                        Open asset link
                      </a>
                    </p>
                  )}

                  {/* Linked references */}
                  {a.project_id && (
                    <p style={styles.linkedRef}>Project: {a.project_id}</p>
                  )}
                  {a.deliverable_id && (
                    <p style={styles.linkedRef}>Deliverable: {a.deliverable_id}</p>
                  )}

                  {/* Assigned by */}
                  {a.created_by_profile?.full_name && (
                    <p style={styles.assignedBy}>
                      Assigned by {a.created_by_profile.full_name}
                    </p>
                  )}

                  {/* Status action buttons */}
                  <div style={styles.actionRow}>
                    {a.status === 'assigned' && (
                      <>
                        <button
                          style={styles.actionButton}
                          onClick={(e) => { e.stopPropagation(); handleStatusChange(a, 'in_progress'); }}
                        >
                          Start Working
                        </button>
                        <button
                          style={{
                            padding: '8px 16px',
                            background: 'rgba(239,68,68,0.12)',
                            color: '#fca5a5',
                            border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                          onClick={(e) => { e.stopPropagation(); handleDeclineAssignment(a); }}
                        >
                          Decline
                        </button>
                      </>
                    )}
                    {a.status === 'in_progress' && (
                      <>
                        <span style={styles.inProgressIndicator}>
                          ● In Progress
                        </span>

                        {a.content_type === 'podcast' ? (
                          <button
                            style={styles.actionButton}
                            onClick={(e) => { e.stopPropagation(); setCompleteConfirmAssignment(a); }}
                          >
                            Mark Complete
                          </button>
                        ) : (
                          <>
                            {uploadedFileUrls[a.id] ? (
                              <button
                                style={styles.submitButtonGreen}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (myPaymentType === 'hourly') {
                                    setHoursModalAssignment(a);
                                    setHoursInput('');
                                  } else {
                                    handleStatusChange(a, 'completed');
                                  }
                                }}
                              >
                                &#10003; Submit
                              </button>
                            ) : (
                              <button
                                style={styles.actionButton}
                                onClick={(e) => { e.stopPropagation(); setSubmitModalAssignment(a); }}
                              >
                                Submit
                              </button>
                            )}
                          </>
                        )}

                        <button
                          style={styles.stuckButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            setStuckAssignment(stuckAssignment === a.id ? null : a.id);
                            setStuckText('');
                          }}
                        >
                          I'm Stuck
                        </button>
                      </>
                    )}
                    {a.status === 'completed' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={styles.completedIndicator}>
                          <span style={{ color: '#34d399', marginRight: 6 }}>&#10003;</span>
                          Completed {a.completed_at ? formatRelativeTime(a.completed_at) : ''}
                        </div>
                        <button
                          style={styles.archiveButton}
                          onClick={(e) => { e.stopPropagation(); handleArchiveAssignment(a.id); }}
                        >
                          Archive
                        </button>
                      </div>
                    )}
                  </div>

                  {/* I'm Stuck text input */}
                  {stuckAssignment === a.id && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        style={{ ...styles.commentInput, flex: 1 }}
                        placeholder="What are you stuck on?"
                        value={stuckText}
                        onChange={e => setStuckText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleStuck(a); }}
                        autoFocus
                      />
                      <button
                        style={{ ...styles.actionButton, padding: '8px 16px' }}
                        onClick={() => handleStuck(a)}
                        disabled={stuckSending || !stuckText.trim()}
                      >
                        {stuckSending ? 'Sending...' : 'Send'}
                      </button>
                      <button
                        style={{ ...styles.archiveButton }}
                        onClick={() => { setStuckAssignment(null); setStuckText(''); }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Comment Thread */}
                  <div style={styles.commentSection}>
                    <h4 style={styles.commentHeader}>Comments</h4>

                    {comments.length === 0 && (
                      <p style={styles.noComments}>No comments yet.</p>
                    )}

                    {comments.map(c => (
                      <div key={c.id} style={styles.commentRow}>
                        <div style={styles.commentAvatar}>
                          {(c.author?.full_name || '?')[0].toUpperCase()}
                        </div>
                        <div style={styles.commentBody}>
                          <div style={styles.commentMeta}>
                            <span style={styles.commentAuthor}>{c.author?.full_name || 'Unknown'}</span>
                            <span style={styles.commentTime}>{formatRelativeTime(c.created_at)}</span>
                          </div>
                          <p style={styles.commentText}>{c.body}</p>
                        </div>
                      </div>
                    ))}

                    {/* New comment input */}
                    <div style={styles.commentInputRow}>
                      <input
                        type="text"
                        placeholder="Write a comment..."
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handlePostComment(); }}
                        style={styles.commentInput}
                      />
                      <button
                        onClick={handlePostComment}
                        disabled={!newComment.trim()}
                        style={{
                          ...styles.postButton,
                          opacity: newComment.trim() ? 1 : 0.4,
                        }}
                      >
                        Post
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Submit Modal */}
      {submitModalAssignment && (
        <AssignmentSubmitModal
          assignment={submitModalAssignment}
          folderId={submitModalAssignment.submit_folder_id || SUBMISSIONS_FOLDER_ID}
          onUploadSuccess={(driveFileUrl) => {
            handleUploadSuccess(submitModalAssignment, driveFileUrl);
            setSubmitModalAssignment(null);
          }}
          onClose={() => setSubmitModalAssignment(null)}
        />
      )}

      {/* Hours Modal */}
      {completeConfirmAssignment && (
        <div style={styles.modalOverlay} {...backdropDismiss(() => setCompleteConfirmAssignment(null))}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Mark Complete</h3>
            <p style={styles.modalSubtitle}>Are you sure you want to mark "{completeConfirmAssignment.title}" as complete?</p>
            <div style={styles.modalActions}>
              <button style={styles.modalCancelBtn} onClick={() => setCompleteConfirmAssignment(null)}>
                Cancel
              </button>
              <button
                style={styles.modalConfirmBtn}
                onClick={() => {
                  if (myPaymentType === 'hourly') {
                    setHoursModalAssignment(completeConfirmAssignment);
                    setHoursInput('');
                  } else {
                    handleStatusChange(completeConfirmAssignment, 'completed');
                  }
                  setCompleteConfirmAssignment(null);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {hoursModalAssignment && (
        <div style={styles.modalOverlay} {...backdropDismiss(() => setHoursModalAssignment(null))}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Report Hours</h3>
            <p style={styles.modalSubtitle}>{hoursModalAssignment.title}</p>
            <input
              type="number"
              step="0.25"
              min="0"
              placeholder="Hours spent"
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              style={styles.hoursInput}
              autoFocus
            />
            <div style={styles.modalActions}>
              <button style={styles.modalCancelBtn} onClick={() => setHoursModalAssignment(null)}>
                Cancel
              </button>
              <button
                style={styles.modalConfirmBtn}
                disabled={!hoursInput || parseFloat(hoursInput) <= 0 || hoursSubmitting}
                onClick={handleCompleteWithHours}
              >
                {hoursSubmitting ? 'Saving...' : 'Complete Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Submit Modal ──────────────────────────────────────────────

function AssignmentSubmitModal({ assignment, folderId, onUploadSuccess, onClose }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setResult(null);
    let phase = 'init';
    let statusCode = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const initRes = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/drive-upload-init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          parentFolderId: folderId,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });
      statusCode = initRes.status;
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(initJson.error || 'Failed to init upload');

      phase = 'put';
      const driveFileId = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', initJson.uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const resp = JSON.parse(xhr.responseText);
              resolve(resp.id);
            } catch {
              resolve(null);
            }
          } else {
            statusCode = xhr.status;
            reject(new Error(`Upload failed (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(file);
      });

      const driveUrl = driveFileId
        ? `https://drive.google.com/file/d/${driveFileId}/view`
        : null;

      setResult({ type: 'success', text: `"${file.name}" uploaded successfully!` });
      setFile(null);
      if (driveUrl) {
        onUploadSuccess(driveUrl);
      }
    } catch (err) {
      setResult({ type: 'error', text: err.message });
      logUploadError({ phase, file, statusCode, error: err, context: { assignment_id: assignment?.id, folder_id: folderId } });
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) { setFile(dropped); setResult(null); }
  }

  return (
    <div style={submitStyles.overlay} {...backdropDismiss(onClose)}>
      <div style={submitStyles.modal} onClick={e => e.stopPropagation()}>
        <div style={submitStyles.header}>
          <span style={submitStyles.title}>Submit — {assignment.title}</span>
          <button onClick={onClose} style={submitStyles.closeBtn}>&times;</button>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            ...submitStyles.dropZone,
            borderColor: dragOver ? '#5b8fc7' : 'rgba(255,255,255,0.15)',
            background: dragOver ? 'rgba(91, 143, 199,0.08)' : 'rgba(255,255,255,0.02)',
          }}
        >
          {file ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', wordBreak: 'break-all', textAlign: 'center' }}>{file.name}</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
              <button onClick={() => { setFile(null); setResult(null); }} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', marginTop: 4 }}>Remove</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Drag & drop a file here</span>
              <button onClick={() => fileInputRef.current?.click()} style={submitStyles.browseBtn}>Browse</button>
              <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) { setFile(e.target.files[0]); setResult(null); } }} />
            </div>
          )}
        </div>

        {uploading && (
          <div style={submitStyles.progressContainer}>
            <div style={{ ...submitStyles.progressBar, width: `${progress}%` }} />
          </div>
        )}

        {result && (
          <p style={{ fontSize: 13, color: result.type === 'success' ? '#34d399' : '#f87171', margin: '8px 0 0' }}>{result.text}</p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            style={{ ...submitStyles.uploadBtn, opacity: (!file || uploading) ? 0.5 : 1 }}
          >
            {uploading ? `Uploading... ${progress}%` : 'Upload'}
          </button>
          <button onClick={onClose} style={submitStyles.cancelBtn}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const submitStyles = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, fontFamily: "'DM Sans', sans-serif",
  },
  modal: {
    background: colors.bgHover, borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
  },
  title: {
    fontSize: 18, fontWeight: 600, color: '#fff',
  },
  closeBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 22,
    cursor: 'pointer', padding: '0 4px', lineHeight: 1,
  },
  dropZone: {
    border: '2px dashed', borderRadius: 10, padding: '32px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 120, transition: 'border-color 0.15s, background 0.15s',
  },
  browseBtn: {
    padding: '6px 16px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer', fontSize: 13, fontFamily: 'DM Sans, sans-serif',
  },
  progressContainer: {
    height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', marginTop: 12, overflow: 'hidden',
  },
  progressBar: {
    height: '100%', borderRadius: 3, background: colors.accent, transition: 'width 0.2s ease', // style-lint-ignore
  },
  uploadBtn: {
    padding: '8px 20px', borderRadius: 8, border: 'none', background: colors.accent,
    color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'DM Sans, sans-serif',
  },
  cancelBtn: {
    padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
    background: 'transparent', color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
    fontSize: 14, fontFamily: 'DM Sans, sans-serif',
  },
};

// ── Styles ─────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: '100vh',
    background: colors.bg,
    padding: '32px 24px',
    fontFamily: 'DM Sans, sans-serif',
    color: 'rgba(255,255,255,0.9)',
    maxWidth: 800,
    margin: '0 auto',
  },
  notifsSection: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    marginBottom: 28,
    overflow: 'hidden',
  },
  notifsSectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 18px',
    cursor: 'pointer',
  },
  notifsUnreadBadge: {
    background: colors.accent,
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 10,
    padding: '1px 7px',
    minWidth: 18,
    textAlign: 'center',
  },
  markAllReadBtn: {
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 500,
    fontFamily: 'DM Sans, sans-serif',
    cursor: 'pointer',
  },
  notifsList: {
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  notifItem: {
    padding: '12px 18px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    cursor: 'pointer',
  },
  notifItemUnread: {
    background: colors.accentA06,
    borderLeft: '3px solid #5b8fc7',
  },
  clearAllBtn: {
    background: 'rgba(239,68,68,0.08)',
    color: 'rgba(248,113,113,0.8)',
    border: '1px solid rgba(239,68,68,0.15)',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 500,
    fontFamily: 'DM Sans, sans-serif',
    cursor: 'pointer',
  },
  dismissBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.25)',
    fontSize: 16,
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1,
    fontFamily: 'DM Sans, sans-serif',
  },
  announcementTag: {
    fontSize: 10,
    fontWeight: 600,
    color: '#fbbf24',
    background: 'rgba(251,191,36,0.12)',
    padding: '1px 6px',
    borderRadius: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    flexShrink: 0,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: '#fff',
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.45)',
    margin: '6px 0 0',
  },

  // Filter pills
  filterRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  filterPill: {
    padding: '6px 16px',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    transition: 'all 0.15s',
  },
  filterPillActive: {
    background: colors.accent,
    color: '#fff',
    borderColor: colors.accent,
  },

  // Card list
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    padding: '40px 0',
    fontSize: 14,
  },

  // Card
  cardWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: '16px 20px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  cardExpanded: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottom: 'none',
  },
  cardRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  typeIcon: {
    fontSize: 20,
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    display: 'block',
  },
  dueDate: {
    fontSize: 12,
    marginTop: 2,
    display: 'block',
  },
  cardRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  payBadge: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    whiteSpace: 'nowrap',
  },

  // Expanded section
  expandedSection: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderTop: 'none',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: '16px 20px 20px',
  },
  description: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 1.6,
    margin: '0 0 12px',
  },
  linkedRef: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 4px',
    fontFamily: 'monospace',
  },
  assignedBy: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    margin: '8px 0 0',
    fontStyle: 'italic',
  },

  // Action buttons
  actionRow: {
    marginTop: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  actionButton: {
    padding: '8px 20px',
    borderRadius: 8,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    transition: 'opacity 0.15s',
  },
  actionButtonComplete: {
    background: '#22c55e',
  },
  inProgressIndicator: {
    padding: '8px 16px',
    background: 'rgba(251,191,36,0.15)',
    color: '#fbbf24',
    border: '1px solid rgba(251,191,36,0.3)',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
  },
  submitButtonGreen: {
    padding: '8px 20px',
    borderRadius: 8,
    border: 'none',
    background: '#22c55e',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    transition: 'opacity 0.15s',
  },
  stuckButton: {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid rgba(251,191,36,0.3)',
    background: 'rgba(251,191,36,0.08)',
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  completedIndicator: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    display: 'flex',
    alignItems: 'center',
  },
  archiveButton: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },

  // Comments
  commentSection: {
    marginTop: 20,
    borderTop: '1px solid rgba(255,255,255,0.06)',
    paddingTop: 16,
  },
  commentHeader: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
    margin: '0 0 12px',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  noComments: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    margin: '0 0 12px',
  },
  commentRow: {
    display: 'flex',
    gap: 10,
    marginBottom: 12,
  },
  commentAvatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: colors.accent,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
  },
  commentMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.8)',
  },
  commentTime: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
  commentText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    margin: 0,
    lineHeight: 1.5,
  },
  commentInputRow: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
  },
  commentInput: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
  },
  postButton: {
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    transition: 'opacity 0.15s',
  },

  // Hours modal
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modalContent: {
    background: colors.bgHover,
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: '32px',
    width: 360,
    maxWidth: '90vw',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 4px',
  },
  modalSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    margin: '0 0 24px',
  },
  hoursInput: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: 16,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    boxSizing: 'border-box',
  },
  modalActions: {
    display: 'flex',
    gap: 10,
    marginTop: 24,
    justifyContent: 'flex-end',
  },
  modalCancelBtn: {
    padding: '10px 20px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  modalConfirmBtn: {
    padding: '10px 20px',
    borderRadius: 8,
    border: 'none',
    background: '#22c55e',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
};
