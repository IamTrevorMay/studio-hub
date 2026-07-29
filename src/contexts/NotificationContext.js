import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from './AuthContext';
import { isTypeEnabled } from '../lib/notificationPrefs';

const NotificationContext = createContext({});

export const useNotifications = () => useContext(NotificationContext);

export function NotificationProvider({ children }) {
  const { user, profile, refreshKey } = useAuth();

  const [unreadAnnouncementCount, setUnreadAnnouncementCount] = useState(0);
  const [unreadMentionChannelIds, setUnreadMentionChannelIds] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const [unsignedDocCount, setUnsignedDocCount] = useState(0);
  const [newAssignmentCount, setNewAssignmentCount] = useState(0);
  const [myTaskCount, setMyTaskCount] = useState(0);
  const [stuckCommentCount, setStuckCommentCount] = useState(0);
  const [flCommentCount, setFlCommentCount] = useState(0);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

  // Single RPC call to get all badge counts
  const refreshNotifications = useCallback(async () => {
    if (!user || !profile) return;
    try {
      const lastSeen = localStorage.getItem('dashboard_last_seen') || '1970-01-01T00:00:00.000Z';
      const { data, error } = await supabase.rpc('get_notification_summary', {
        p_user_id: user.id,
        p_role: profile.role,
        p_dashboard_last_seen: lastSeen,
      });
      if (error) throw error;
      if (data) {
        setUnreadAnnouncementCount(data.unread_announcement_count || 0);
        setUnreadNotificationCount(data.unread_notification_count || 0);
        setPendingProposalCount(data.pending_proposal_count || 0);
        setUnsignedDocCount(data.unsigned_doc_count || 0);
        setStuckCommentCount(data.stuck_comment_count || 0);
        setFlCommentCount(data.fl_comment_count || 0);
        setMyTaskCount(data.my_task_count || 0);
        setNewAssignmentCount(data.new_assignment_count || 0);
      }
    } catch (err) {
      console.error('Error fetching notification summary:', err);
    }
  }, [user, profile]);

  // Mentions stay client-side (depends on per-channel localStorage timestamps)
  const fetchUnreadMentions = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('channel_messages')
        .select('channel_id, created_at')
        .contains('mentions', [user.id]);
      if (error) throw error;
      if (!data || data.length === 0) { setUnreadMentionChannelIds([]); return; }
      const channelMap = {};
      data.forEach(msg => {
        if (!channelMap[msg.channel_id] || msg.created_at > channelMap[msg.channel_id]) {
          channelMap[msg.channel_id] = msg.created_at;
        }
      });
      const unread = Object.entries(channelMap).filter(([chId, latestMention]) => {
        const seen = localStorage.getItem(`channel_seen_${chId}`) || '1970-01-01T00:00:00.000Z';
        return latestMention > seen;
      }).map(([chId]) => chId);
      setUnreadMentionChannelIds(unread);
    } catch (err) {
      console.error('Error fetching unread mentions:', err);
    }
  }, [user]);

  // Unread direct messages (per-message count across all conversations)
  const fetchUnreadDms = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data, error } = await supabase.rpc('get_unread_dm_count', {
        p_user_id: profile.id,
      });
      if (error) throw error;
      setUnreadMessageCount(data || 0);
    } catch (err) {
      console.error('Error fetching unread DM count:', err);
    }
  }, [profile?.id]);

  const markChannelSeen = useCallback((channelId) => {
    localStorage.setItem(`channel_seen_${channelId}`, new Date().toISOString());
    setUnreadMentionChannelIds(prev => prev.filter(id => id !== channelId));
  }, []);

  const markDashboardSeen = useCallback(() => {
    localStorage.setItem('dashboard_last_seen', new Date().toISOString());
  }, []);

  // Browser tab badge: prefix the title with the combined unread count
  // (DMs + channel mentions + bell notifications). Counts update in
  // realtime above, so the title tracks reads/arrivals live.
  useEffect(() => {
    const count = unreadMessageCount + unreadMentionChannelIds.length + unreadNotificationCount;
    document.title = count > 0 ? `(${count > 99 ? '99+' : count}) Mayday Studio` : 'Mayday Studio';
    return () => { document.title = 'Mayday Studio'; };
  }, [unreadMessageCount, unreadMentionChannelIds, unreadNotificationCount]);

  // Fire a native OS notification for a freshly-inserted notifications row.
  // Only when the user opted in (profiles.desktop_notifications_enabled),
  // the row's category is enabled in their desktop prefs, the browser
  // permission is granted, and the tab is in the background.
  const desktopNotifEnabled = profile?.desktop_notifications_enabled === true;
  const notificationPrefs = profile?.notification_prefs;
  const fireDesktopNotification = useCallback((row) => {
    if (!desktopNotifEnabled) return;
    if (!isTypeEnabled(notificationPrefs, 'desktop', row?.type)) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    try {
      const n = new Notification(row?.title || 'Mayday Studio', {
        body: row?.body || '',
        icon: '/logo.png',
        tag: row?.id ? `mayday-notif-${row.id}` : undefined,
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) {
      // Notification constructor can throw on unsupported platforms — ignore
    }
  }, [desktopNotifEnabled, notificationPrefs]);

  // Desktop notification for an incoming DM. DMs don't create notifications
  // rows (they'd flood the bell), so this fires straight off the
  // direct_messages realtime stream under the 'messages' category pref.
  // Mobile push for DMs comes from the forward_dm_to_push DB trigger.
  const fireDmDesktopNotification = useCallback(async (row) => {
    if (!row || !profile?.id || row.user_id === profile.id) return;
    if (!desktopNotifEnabled) return;
    if (!isTypeEnabled(notificationPrefs, 'desktop', 'message')) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    try {
      // Confirm we're actually in this conversation — the realtime stream is
      // unfiltered, so don't trust the row alone.
      const { data: member } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', row.conversation_id)
        .eq('user_id', profile.id)
        .maybeSingle();
      if (!member) return;
      const { data: sender } = await supabase
        .from('profiles')
        .select('nickname, full_name')
        .eq('id', row.user_id)
        .maybeSingle();
      const senderName = sender?.nickname || sender?.full_name || 'Someone';
      fireDesktopNotification({
        id: row.id,
        type: 'message',
        title: `New message from ${senderName}`,
        body: (row.content || '').substring(0, 100),
      });
    } catch (e) {
      // best-effort — never let a notification lookup break the app
    }
  }, [profile?.id, desktopNotifEnabled, notificationPrefs, fireDesktopNotification]);

  // Initial fetch + real-time subscriptions + 5-min fallback poll
  useEffect(() => {
    if (!user || !profile) return;
    refreshNotifications();
    fetchUnreadMentions();
    fetchUnreadDms();

    const channel = supabase.channel('notification-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => { fetchUnreadDms(); fireDmDesktopNotification(payload.new); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${profile.id}` }, () => fetchUnreadDms())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => refreshNotifications())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_reads' }, () => refreshNotifications())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_messages' }, () => fetchUnreadMentions())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => refreshNotifications())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, (payload) => fireDesktopNotification(payload.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ad_read_proposals' }, () => refreshNotifications())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contractor_documents' }, () => refreshNotifications())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contractor_assignments' }, () => refreshNotifications())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => refreshNotifications())
      .subscribe();

    const interval = setInterval(() => {
      refreshNotifications();
      fetchUnreadMentions();
      fetchUnreadDms();
    }, 300000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [user, profile, refreshNotifications, fetchUnreadMentions, fetchUnreadDms, fireDesktopNotification, fireDmDesktopNotification, refreshKey]);

  const value = {
    unreadAnnouncementCount,
    markDashboardSeen,
    unreadMentionChannelIds,
    markChannelSeen,
    refreshNotifications,
    unreadNotificationCount,
    pendingProposalCount,
    unsignedDocCount,
    newAssignmentCount,
    myTaskCount,
    stuckCommentCount,
    flCommentCount,
    unreadMessageCount,
    fetchUnreadDms,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
