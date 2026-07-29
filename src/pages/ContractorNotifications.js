import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEffectivePortalIdentity } from '../lib/impersonation';
import { colors } from '../lib/styleTokens';

const TYPE_ICONS = {
  assignment: '\uD83D\uDCCB',
  comment: '\uD83D\uDCAC',
  due: '\u23F0',
  reviewed: '\u2705',
  reminder: '\uD83D\uDD14',
  mention: '\uD83D\uDCE3',
};

function formatRelativeTime(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ContractorNotifications({ onNavigate }) {
  const { profile: realProfile } = useAuth();
  const { profile, supabase, readOnly } = useEffectivePortalIdentity(realProfile);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(100);
    setNotifications(data || []);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  function handleClick(notif) {
    if (!notif.read && !readOnly) {
      supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notif.id)
        .then(() => fetchNotifications());
    }
    if (notif.link_tab && onNavigate) {
      onNavigate(notif.link_tab, notif.link_target);
    }
  }

  async function handleMarkAllRead() {
    if (readOnly) return; // preview mode — no writes
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', profile.id)
      .is('read', false);
    fetchNotifications();
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Notifications</h1>
        </div>
        <p style={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Notifications</h1>
          {unreadCount > 0 && (
            <span style={styles.unreadBadge}>{unreadCount}</span>
          )}
        </div>
        {unreadCount > 0 && (
          <button onClick={handleMarkAllRead} style={styles.markAllBtn}>
            Mark All Read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>No notifications yet</p>
        </div>
      ) : (
        <div style={styles.list}>
          {notifications.map(notif => {
            const icon = TYPE_ICONS[notif.type] || '\uD83D\uDD14';
            const isUnread = !notif.read;

            return (
              <div
                key={notif.id}
                onClick={() => handleClick(notif)}
                style={{
                  ...styles.notifCard,
                  ...(isUnread ? styles.notifCardUnread : styles.notifCardRead),
                  cursor: notif.link_tab ? 'pointer' : 'default',
                }}
              >
                <div style={styles.notifIcon}>{icon}</div>
                <div style={styles.notifContent}>
                  <div style={styles.notifTitleRow}>
                    <span style={{
                      ...styles.notifTitle,
                      ...(isUnread ? {} : styles.notifTitleRead),
                    }}>
                      {notif.title}
                    </span>
                    <span style={styles.notifTime}>
                      {formatRelativeTime(notif.created_at)}
                    </span>
                  </div>
                  {notif.body && (
                    <p style={{
                      ...styles.notifBody,
                      ...(isUnread ? {} : styles.notifBodyRead),
                    }}>
                      {notif.body}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: '32px 40px',
    maxWidth: 700,
    margin: '0 auto',
    fontFamily: 'DM Sans, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.95)',
    margin: 0,
  },
  unreadBadge: {
    background: colors.accent,
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 10,
    padding: '2px 8px',
    minWidth: 20,
    textAlign: 'center',
  },
  markAllBtn: {
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.7)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 500,
    fontFamily: 'DM Sans, sans-serif',
    cursor: 'pointer',
  },
  loadingText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 0',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  notifCard: {
    display: 'flex',
    gap: 14,
    padding: '14px 18px',
    borderRadius: 8,
    transition: 'background 0.15s',
  },
  notifCardUnread: {
    background: colors.accentA08,
    borderLeft: '3px solid #5b8fc7',
  },
  notifCardRead: {
    background: 'rgba(255,255,255,0.02)',
    borderLeft: '3px solid transparent',
  },
  notifIcon: {
    fontSize: 20,
    lineHeight: '24px',
    flexShrink: 0,
    width: 28,
    textAlign: 'center',
  },
  notifContent: {
    flex: 1,
    minWidth: 0,
  },
  notifTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: '20px',
  },
  notifTitleRead: {
    color: 'rgba(255,255,255,0.5)',
    fontWeight: 500,
  },
  notifTime: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  notifBody: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    margin: '4px 0 0 0',
    lineHeight: '18px',
  },
  notifBodyRead: {
    color: 'rgba(255,255,255,0.35)',
  },
};
