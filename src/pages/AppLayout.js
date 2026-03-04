import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import Dashboard from './Dashboard';
import Projects from './Projects';
import Calendar from './Calendar';
import Channels from './Channels';
import Messages from './Messages';
import AdminPanel from './AdminPanel';
import Ideation from './Ideation';
import Reviews from './Reviews';
import Resources from './Resources';
import Analytics from './Analytics';
import Research from './Research';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { key: 'projects', label: 'Projects', icon: ProjectsIcon },
  { key: 'ideation', label: 'Create', icon: IdeationIcon },
  { key: 'resources', label: 'Resources', icon: ResourcesIcon },
  { key: 'analytics', label: 'Analytics', icon: AnalyticsIcon },
  { key: 'research', label: 'Research', icon: ResearchIcon },
  { key: 'reviews', label: 'Reviews', icon: ReviewsIcon },
  { key: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { key: 'channels', label: 'Channels', icon: ChannelsIcon },
  { key: 'messages', label: 'Messages', icon: MessagesIcon },
];

export default function AppLayout() {
  const { profile, signOut, isAdmin, isAssistant, unreadAnnouncementCount, newItineraryCount, markDashboardSeen, unreadMentionChannelIds, unreadNotificationCount, refreshNotifications } = useAuth();
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('studio-hub-tab') || 'dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navTarget, setNavTarget] = useState(null);
  const [adminInitialTab, setAdminInitialTab] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const notifPanelRef = React.useRef(null);

  // Persist active tab to localStorage
  useEffect(() => {
    localStorage.setItem('studio-hub-tab', activeTab);
  }, [activeTab]);

  // Handle Google Calendar OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gcal_connected') === 'true' || params.get('gcal_error')) {
      setAdminInitialTab('google');
      setActiveTab('admin');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const dashboardNotifCount = unreadAnnouncementCount + (isAdmin ? newItineraryCount : 0);

  function handleNavClick(key) {
    if (key === 'dashboard' && isAdmin) markDashboardSeen();
    setActiveTab(key);
  }

  function navigateTo(tab, target) {
    setNavTarget(target || null);
    setActiveTab(tab);
  }

  async function fetchNotifications() {
    setNotificationsLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile?.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function markNotificationRead(id) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    refreshNotifications();
  }

  async function markAllNotificationsRead() {
    if (!profile?.id) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', profile.id).eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    refreshNotifications();
  }

  function handleNotificationClick(notif) {
    markNotificationRead(notif.id);
    if (notif.link_tab) {
      navigateTo(notif.link_tab, notif.link_target);
    }
    setShowNotifications(false);
  }

  React.useEffect(() => {
    if (showNotifications && profile?.id) fetchNotifications();
  }, [showNotifications, profile?.id]);

  React.useEffect(() => {
    if (!showNotifications) return;
    function handleClickOutside(e) {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications]);

  const renderPage = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard onNavigate={navigateTo} />;
      case 'projects': return <Projects onNavigate={navigateTo} />;
      case 'calendar': return <Calendar onNavigate={navigateTo} />;
      case 'ideation': return <Ideation initialConceptId={navTarget} onConceptOpened={() => setNavTarget(null)} />;
      case 'resources': return <Resources />;
      case 'analytics': return <Analytics />;
      case 'research': return <Research />;
      case 'reviews': return <Reviews />;
      case 'channels': return <Channels initialChannelName={navTarget} onChannelOpened={() => setNavTarget(null)} />;
      case 'messages': return <Messages onNavigate={navigateTo} />;
      case 'admin': return <AdminPanel initialTab={adminInitialTab} />;
      default: return <Dashboard />;
    }
  };

  return (
    <div style={styles.layout}>
      {/* Sidebar */}
      <aside style={{
        ...styles.sidebar,
        width: sidebarCollapsed ? '72px' : '240px',
      }}>
        {/* Logo */}
        <div style={styles.logoArea}>
          <div style={styles.logoIcon}>
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
              <rect x="2" y="6" width="12" height="8" rx="2" fill="#6366f1" />
              <rect x="18" y="6" width="12" height="8" rx="2" fill="#818cf8" />
              <rect x="2" y="18" width="12" height="8" rx="2" fill="#818cf8" />
              <rect x="18" y="18" width="12" height="8" rx="2" fill="#6366f1" />
            </svg>
          </div>
          {!sidebarCollapsed && <span style={styles.logoText}>Mayday Media<br /><span style={styles.logoTextSub}>Creative</span></span>}
        </div>

        {/* Navigation */}
        <nav style={styles.nav}>
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => handleNavClick(key)}
              style={{
                ...styles.navItem,
                ...(activeTab === key ? styles.navItemActive : {}),
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                position: 'relative',
              }}
              title={sidebarCollapsed ? label : undefined}
            >
              <Icon active={activeTab === key} />
              {!sidebarCollapsed && <span>{label}</span>}
              {key === 'dashboard' && dashboardNotifCount > 0 && (
                <span style={styles.navBadge}>{dashboardNotifCount}</span>
              )}
              {key === 'channels' && unreadMentionChannelIds.length > 0 && (
                <span style={styles.navBadge}>{unreadMentionChannelIds.length}</span>
              )}
            </button>
          ))}

          {isAdmin && (
            <button
              onClick={() => setActiveTab('admin')}
              style={{
                ...styles.navItem,
                ...(activeTab === 'admin' ? styles.navItemActive : {}),
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                marginTop: '8px',
              }}
              title={sidebarCollapsed ? 'Admin' : undefined}
            >
              <AdminIcon active={activeTab === 'admin'} />
              {!sidebarCollapsed && <span>Admin</span>}
            </button>
          )}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          style={styles.collapseBtn}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            {sidebarCollapsed ? (
              <path d="M6 3l5 5-5 5V3z" />
            ) : (
              <path d="M10 3L5 8l5 5V3z" />
            )}
          </svg>
        </button>

        {/* User area */}
        <div style={{
          ...styles.userArea,
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
        }}>
          <div style={styles.avatar}>
            {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          {!sidebarCollapsed && (
            <div style={styles.userInfo}>
              <div style={styles.userName}>{profile?.full_name}</div>
              <div style={styles.userTitle}>{profile?.title || 'Team Member'}</div>
            </div>
          )}
          {!sidebarCollapsed && (
            <button onClick={signOut} style={styles.signOutBtn} title="Sign out">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        <div style={styles.mainHeader}>
          <div style={{ flex: 1 }} />
          <div style={{ position: 'relative' }} ref={notifPanelRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              style={styles.bellBtn}
              title="Notifications"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
              </svg>
              {unreadNotificationCount > 0 && (
                <span style={styles.bellBadge}>{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>
              )}
            </button>
            {showNotifications && (
              <div style={styles.notifPanel}>
                <div style={styles.notifHeader}>
                  <span style={styles.notifTitle}>Notifications</span>
                  <button onClick={markAllNotificationsRead} style={styles.markAllReadBtn}>Mark all read</button>
                </div>
                <div style={styles.notifList}>
                  {notificationsLoading ? (
                    <p style={styles.notifEmpty}>Loading...</p>
                  ) : notifications.length === 0 ? (
                    <p style={styles.notifEmpty}>You're all caught up!</p>
                  ) : (
                    notifications.map(n => (
                      <button
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        style={{
                          ...styles.notifItem,
                          background: n.is_read ? 'transparent' : 'rgba(99,102,241,0.06)',
                        }}
                      >
                        <div style={styles.notifIcon}>
                          {n.type === 'assignment' ? '\u{1F464}' : n.type === 'mention' ? '@' : n.type === 'comment' ? '\u{1F4AC}' : n.type === 'status_change' ? '\u{1F504}' : n.type === 'announcement' ? '\u{1F4E2}' : '\u{1F514}'}
                        </div>
                        <div style={styles.notifContent}>
                          <div style={styles.notifItemTitle}>{n.title}</div>
                          {n.body && <div style={styles.notifBody}>{n.body}</div>}
                          <div style={styles.notifTime}>{formatNotifTime(n.created_at)}</div>
                        </div>
                        {!n.is_read && <div style={styles.notifUnreadDot} />}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={styles.mainContent}>
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

// --- Nav Icons ---
function DashboardIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill={active ? '#a5b4fc' : '#6b7280'}>
      <rect x="2" y="2" width="7" height="7" rx="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ProjectsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M7 7h6M7 10h6M7 13h4" />
    </svg>
  );
}

function CalendarIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 8h14M7 2v4M13 2v4" />
    </svg>
  );
}

function ChannelsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M7 2l-2 16M15 2l-2 16M3 7h16M2 13h16" />
    </svg>
  );
}

function MessagesIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M4 4h12a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3V6a2 2 0 012-2z" />
    </svg>
  );
}

function ReviewsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="4" width="14" height="10" rx="2" />
      <path d="M8 17h4" />
      <path d="M8 9l2 1.5L12 8" />
    </svg>
  );
}

function IdeationIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M10 2a5 5 0 013 9v2a1 1 0 01-1 1H8a1 1 0 01-1-1v-2a5 5 0 013-9z" />
      <path d="M8 16h4M9 18h2" />
    </svg>
  );
}

function AnalyticsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M3 17V10M8 17V7M13 17V4M18 17V1" strokeLinecap="round" />
    </svg>
  );
}

function ResourcesIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M4 4h5l2 2h5a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" />
      <path d="M8 12h4M8 9.5h4" />
    </svg>
  );
}

function ResearchIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <circle cx="8" cy="8" r="5" />
      <path d="M12 12l5 5" />
      <path d="M6 5h4M6 8h3" />
    </svg>
  );
}

function AdminIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" />
    </svg>
  );
}

function formatNotifTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const styles = {
  layout: {
    display: 'flex',
    height: '100vh',
    background: '#0f0f1a',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    color: '#e2e8f0',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(15,15,30,0.95)',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    transition: 'width 0.2s ease',
    overflow: 'hidden',
    flexShrink: 0,
  },
  logoArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '20px 20px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  logoIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  logoText: {
    fontSize: '17px',
    fontWeight: 700,
    color: '#ffffff',
    letterSpacing: '-0.3px',
    lineHeight: 1.2,
  },
  logoTextSub: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: '0.5px',
  },
  nav: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '12px 10px',
    gap: '2px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    border: 'none',
    borderRadius: '10px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.55)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  },
  navItemActive: {
    background: 'rgba(99,102,241,0.12)',
    color: '#a5b4fc',
  },
  navBadge: {
    position: 'absolute',
    top: '4px',
    right: '8px',
    background: '#ef4444',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 700,
    minWidth: '18px',
    height: '18px',
    borderRadius: '9px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 5px',
    lineHeight: 1,
  },
  collapseBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 10px 8px',
    padding: '8px',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    transition: 'color 0.15s',
  },
  userArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 16px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  avatar: {
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
  },
  userInfo: {
    flex: 1,
    overflow: 'hidden',
  },
  userName: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userTitle: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.4)',
    whiteSpace: 'nowrap',
  },
  signOutBtn: {
    display: 'flex',
    padding: '6px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  main: {
    flex: 1,
    overflow: 'hidden',
    background: '#12121f',
    display: 'flex',
    flexDirection: 'column',
  },
  mainHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '12px 24px 0',
    flexShrink: 0,
  },
  mainContent: {
    flex: 1,
    overflow: 'auto',
  },
  bellBtn: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    border: 'none',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  bellBadge: {
    position: 'absolute',
    top: '-2px',
    right: '-2px',
    background: '#ef4444',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 700,
    minWidth: '18px',
    height: '18px',
    borderRadius: '9px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 4px',
    lineHeight: 1,
  },
  notifPanel: {
    position: 'absolute',
    top: '44px',
    right: 0,
    width: '400px',
    maxHeight: '500px',
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  notifHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
  notifTitle: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#e2e8f0',
  },
  markAllReadBtn: {
    padding: '4px 10px',
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: '6px',
    color: '#a5b4fc',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  notifList: {
    flex: 1,
    overflow: 'auto',
    padding: '4px',
  },
  notifEmpty: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: '14px',
    textAlign: 'center',
    padding: '32px 16px',
    margin: 0,
  },
  notifItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    width: '100%',
    padding: '10px 12px',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    transition: 'background 0.1s',
  },
  notifIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    flexShrink: 0,
  },
  notifContent: {
    flex: 1,
    minWidth: 0,
  },
  notifItemTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e2e8f0',
    lineHeight: 1.3,
  },
  notifBody: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.45)',
    marginTop: '2px',
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  notifTime: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.25)',
    marginTop: '3px',
  },
  notifUnreadDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#6366f1',
    flexShrink: 0,
    marginTop: '4px',
  },
};
