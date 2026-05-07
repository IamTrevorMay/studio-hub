import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useNavConfig from '../hooks/useNavConfig';
import { filterNavForMobile, isExcludedOnMobile } from '../config/mobileNavConfig';
import MobileTopBar from '../components/mobile/MobileTopBar';
import MobileDrawer from '../components/mobile/MobileDrawer';
import BottomSheet from '../components/mobile/BottomSheet';
import DesktopOnlyScreen from '../components/mobile/DesktopOnlyScreen';
import { mobileTokens } from '../utils/mobileTokens';

// Pages currently routable on mobile. Phase 2/3 will swap these for *Mobile variants
// as mobile components get built. Excluded pages are intentionally not imported so
// they don't end up in the mobile chunk.
import Dashboard from './DashboardMobile';
import Projects from './ProjectsMobile';
import Calendar from './CalendarMobile';
import Channels from './ChannelsMobile';
import Messages from './MessagesMobile';
import AdminPanel from './AdminPanelMobile';
import Ideation from './IdeationMobile';
import Resources from './ResourcesMobile';
import Research from './ResearchMobile';
import Goals from './GoalsMobile';
import BusinessDev from './BusinessDevMobile';
import Invoicing from './InvoicingMobile';
import Production from './ProductionMobile';
import FreelancerDashboard from './FreelancerDashboardMobile';

// Same NAV_ITEMS source-of-truth as desktop. Kept in sync intentionally — desktop
// AppLayout owns the canonical list; this is a slimmed mirror used to feed the
// drawer's resolved nav (which gets filtered by filterNavForMobile).
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'write', label: 'Write' },
  { key: 'production', label: 'Beat Sheet' },
  { key: 'scene_builder', label: 'Custom Visuals', external: { triton: '/design/scene-composer' } },
  { key: 'screenwriter', label: 'Screenwriter' },
  { key: 'teleprompter', label: 'Teleprompter' },
  { key: 'broadcast', label: 'Broadcast', external: { url: 'https://www.tritonapex.io/broadcast' } },
  { key: 'telestration', label: 'Telestrator' },
  { key: 'post_show', label: 'Clipping Tool' },
  { key: 'assets', label: 'Assets', external: { url: 'https://www.mayday.systems/' } },
  { key: 'reviews', label: 'Reviews' },
  { key: 'organize', label: 'Organize' },
  { key: 'projects', label: 'Projects' },
  { key: 'resources', label: 'Resources' },
  { key: 'analytics', label: 'Analytics', adminOnly: true },
  { key: 'research', label: 'Research' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'goals', label: 'Goals' },
  { key: 'business_dev', label: 'Business Dev', adminOnly: true },
  { key: 'invoicing', label: 'Invoicing' },
  { key: 'freelancers', label: 'Freelancers', adminOnly: true },
  { key: 'channels', label: 'Channels' },
  { key: 'messages', label: 'Messages' },
];

const VALID_TAB_KEYS = new Set(NAV_ITEMS.map((i) => i.key).concat('admin', 'fl_dashboard', 'fl_hours', 'fl_profile', 'fl_notifications'));

function getTabFromPath() {
  const path = window.location.pathname.replace(/^\/+/, '').split('/')[0];
  if (path && VALID_TAB_KEYS.has(path)) return path;
  return null;
}

const TAB_LABELS = NAV_ITEMS.reduce((acc, item) => { acc[item.key] = item.label; return acc; }, {
  admin: 'Admin',
  fl_dashboard: 'Dashboard',
  fl_hours: 'Hours',
  fl_profile: 'Profile',
  fl_notifications: 'Notifications',
});

export default function AppLayoutMobile() {
  const { profile, signOut, isAdmin, isAssistant, isPartner, isFreelancer, unreadNotificationCount, markDashboardSeen, refreshNotifications } = useAuth();
  const { getResolvedNav } = useNavConfig();
  const [activeTab, setActiveTab] = useState(() => getTabFromPath() || localStorage.getItem('studio-hub-tab') || 'dashboard');
  const [navTarget, setNavTarget] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const mainRef = React.useRef(null);

  // Persist active tab + URL, reset scroll on change
  useEffect(() => {
    localStorage.setItem('studio-hub-tab', activeTab);
    const expectedPath = '/' + activeTab;
    if (window.location.pathname !== expectedPath) {
      window.history.pushState({}, '', expectedPath);
    }
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [activeTab]);

  useEffect(() => {
    function handlePopState() {
      const tab = getTabFromPath();
      if (tab) setActiveTab(tab);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Freelancer redirect (mirror desktop AppLayout)
  useEffect(() => {
    if (isFreelancer && !activeTab.startsWith('fl_') && activeTab !== 'resources' && activeTab !== 'assets') {
      setActiveTab('fl_dashboard');
    }
  }, [isFreelancer]); // eslint-disable-line

  const resolvedNav = getResolvedNav(NAV_ITEMS, isAdmin, isPartner, isFreelancer);
  const mobileNav = filterNavForMobile(resolvedNav);

  function navigateTo(tab, target) {
    setNavTarget(target || null);
    setActiveTab(tab);
  }

  function handleSelectTab(key) {
    const item = NAV_ITEMS.find((i) => i.key === key);
    if (item?.external?.url) {
      window.open(item.external.url, '_blank', 'noopener');
      return;
    }
    if (item?.external?.triton) {
      // Triton SSO link not exposed on mobile yet — fall back to plain open
      window.open(`https://www.tritonapex.io${item.external.triton}`, '_blank', 'noopener');
      return;
    }
    if (key === 'dashboard' && isAdmin) markDashboardSeen();
    setActiveTab(key);
  }

  const fetchNotifications = useCallback(async () => {
    if (!profile?.id) return;
    setNotifLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setNotifLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    if (notifOpen && profile?.id) fetchNotifications();
  }, [notifOpen, profile?.id, fetchNotifications]);

  async function markNotificationRead(id) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    refreshNotifications();
  }

  async function markAllNotificationsRead() {
    if (!profile?.id) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', profile.id).eq('is_read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    refreshNotifications();
  }

  function handleNotificationClick(notif) {
    markNotificationRead(notif.id);
    if (notif.link_tab) navigateTo(notif.link_tab, notif.link_target);
    setNotifOpen(false);
  }

  const title = TAB_LABELS[activeTab] || 'Mayday Studio';

  return (
    <div style={styles.layout}>
      <MobileTopBar
        title={title}
        onMenuClick={() => setDrawerOpen(true)}
        onBellClick={() => setNotifOpen(true)}
        notificationCount={unreadNotificationCount}
      />

      <main ref={mainRef} style={styles.main}>
        {renderActiveTab({
          activeTab,
          isAdmin,
          isAssistant,
          isPartner,
          isFreelancer,
          navTarget,
          setNavTarget,
          navigateTo,
          setActiveTab,
        })}
      </main>

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resolvedNav={mobileNav}
        activeTab={activeTab}
        onSelect={handleSelectTab}
        profile={profile}
        onSignOut={signOut}
        isAdmin={isAdmin}
      />

      <BottomSheet
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        title="Notifications"
        maxHeight="80vh"
      >
        <NotificationsList
          loading={notifLoading}
          notifications={notifications}
          onItemClick={handleNotificationClick}
          onMarkAllRead={markAllNotificationsRead}
        />
      </BottomSheet>
    </div>
  );
}

function renderActiveTab({ activeTab, isAdmin, isAssistant, isPartner, isFreelancer, navTarget, setNavTarget, navigateTo, setActiveTab }) {
  // Excluded routes -> friendly screen
  if (isExcludedOnMobile(activeTab)) {
    return (
      <DesktopOnlyScreen
        pageLabel={TAB_LABELS[activeTab]}
        onBack={() => setActiveTab('dashboard')}
      />
    );
  }

  // Role gating mirrors desktop AppLayout
  if (activeTab === 'admin' && !isAdmin) return null;
  if (activeTab === 'business_dev' && !(isAdmin || isPartner)) return null;
  if (activeTab === 'invoicing' && !(isAdmin || isAssistant)) return null;

  switch (activeTab) {
    case 'dashboard': return <Dashboard onNavigate={navigateTo} />;
    case 'projects': return <Projects onNavigate={navigateTo} />;
    case 'calendar': return <Calendar onNavigate={navigateTo} />;
    case 'production': return <Production />;
    case 'ideation': return <Ideation initialConceptId={navTarget} onConceptOpened={() => setNavTarget(null)} />;
    case 'resources': return <Resources />;
    case 'research': return <Research />;
    case 'goals': return <Goals />;
    case 'business_dev': return <BusinessDev />;
    case 'invoicing': return <Invoicing />;
    case 'channels': return <Channels initialChannelName={navTarget} onChannelOpened={() => setNavTarget(null)} />;
    case 'messages': return <Messages onNavigate={navigateTo} />;
    case 'admin': return <AdminPanel />;
    case 'fl_dashboard': return isFreelancer ? <FreelancerDashboard onNavigate={navigateTo} /> : null;
    default: return <Dashboard onNavigate={navigateTo} />;
  }
}

function NotificationsList({ loading, notifications, onItemClick, onMarkAllRead }) {
  if (loading) return <p style={styles.notifEmpty}>Loading...</p>;
  if (notifications.length === 0) return <p style={styles.notifEmpty}>You're all caught up!</p>;
  return (
    <div>
      <div style={styles.notifHeader}>
        <button onClick={onMarkAllRead} style={styles.markAllBtn}>Mark all read</button>
      </div>
      <div style={styles.notifList}>
        {notifications.map((n) => (
          <button
            key={n.id}
            onClick={() => onItemClick(n)}
            style={{
              ...styles.notifItem,
              background: n.is_read ? 'transparent' : 'rgba(99,102,241,0.08)',
            }}
          >
            <div style={styles.notifIcon}>
              {n.type === 'assignment' ? '\u{1F464}'
                : n.type === 'mention' ? '@'
                : n.type === 'comment' ? '\u{1F4AC}'
                : n.type === 'status_change' ? '\u{1F504}'
                : n.type === 'announcement' ? '\u{1F4E2}'
                : '\u{1F514}'}
            </div>
            <div style={styles.notifContent}>
              <div style={styles.notifTitle}>{n.title}</div>
              {n.body && <div style={styles.notifBody}>{n.body}</div>}
              <div style={styles.notifTime}>{formatNotifTime(n.created_at)}</div>
            </div>
            {!n.is_read && <div style={styles.notifDot} />}
          </button>
        ))}
      </div>
    </div>
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
    flexDirection: 'column',
    minHeight: '100vh',
    background: '#0f0f1a',
    color: '#e2e8f0',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: mobileTokens.font.base,
  },
  main: {
    flex: 1,
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  notifEmpty: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: mobileTokens.font.md,
    textAlign: 'center',
    padding: `${mobileTokens.space.xxl}px ${mobileTokens.space.lg}px`,
    margin: 0,
  },
  notifHeader: {
    display: 'flex',
    justifyContent: 'flex-end',
    paddingBottom: mobileTokens.space.sm,
  },
  markAllBtn: {
    padding: '6px 12px',
    background: 'rgba(99,102,241,0.12)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: mobileTokens.radius.sm,
    color: '#a5b4fc',
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  notifList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  notifItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: mobileTokens.space.md,
    width: '100%',
    padding: mobileTokens.space.md,
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    color: '#e2e8f0',
  },
  notifIcon: {
    width: 36,
    height: 36,
    borderRadius: mobileTokens.radius.sm,
    background: 'rgba(255,255,255,0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: mobileTokens.font.md,
    flexShrink: 0,
  },
  notifContent: {
    flex: 1,
    minWidth: 0,
  },
  notifTitle: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#e2e8f0',
    lineHeight: 1.3,
  },
  notifBody: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
    lineHeight: 1.35,
  },
  notifTime: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 4,
  },
  notifDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#6366f1',
    flexShrink: 0,
    marginTop: 6,
  },
};
