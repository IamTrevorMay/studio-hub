import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useNavConfig from '../hooks/useNavConfig';
import SidebarEditMode from '../components/SidebarEditMode';
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
import Goals from './Goals';
import BusinessDev from './BusinessDev';
import Production from './Production';
import Write from './Write';
import Screenwriter from './Screenwriter';
import Teleprompter from './tools/Teleprompter';
import Organize from './tools/Organize';
import PostShow from './tools/PostShow';
import Telestration from './tools/Telestration';

import Morty from '../components/Morty';

// Sidebar catalog. Labels listed here are aliased internally — the user
// refers to Production as "Beat Sheet", Scene Builder as "Custom Visuals",
// Telestration as "Telestrator", and Post Show as "Clipping Tool". Route
// keys stay stable to keep existing deep links working.
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { key: 'write', label: 'Write', icon: ResourcesIcon },
  { key: 'production', label: 'Beat Sheet', icon: ProductionIcon },
  { key: 'scene_builder', label: 'Custom Visuals', icon: ToolsIcon, external: { triton: '/design/scene-composer' } },
  { key: 'screenwriter', label: 'Screenwriter', icon: IdeationIcon },
  { key: 'teleprompter', label: 'Teleprompter', icon: ToolsIcon },
  { key: 'broadcast', label: 'Broadcast', icon: ToolsIcon, external: { url: 'https://www.tritonapex.io/broadcast' } },
  { key: 'telestration', label: 'Telestrator', icon: ToolsIcon },
  { key: 'post_show', label: 'Clipping Tool', icon: ToolsIcon },
  { key: 'assets', label: 'Assets', icon: ResourcesIcon, external: { url: 'https://www.mayday.systems/' } },
  { key: 'reviews', label: 'Reviews', icon: ReviewsIcon },
  { key: 'organize', label: 'Organize', icon: ToolsIcon },
  { key: 'projects', label: 'Projects', icon: ProjectsIcon },
  { key: 'resources', label: 'Resources', icon: ResourcesIcon },
  { key: 'analytics', label: 'Analytics', icon: AnalyticsIcon, adminOnly: true },
  { key: 'research', label: 'Research', icon: ResearchIcon },
  { key: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { key: 'goals', label: 'Goals', icon: GoalsIcon },
  { key: 'business_dev', label: 'Business Dev', icon: BusinessDevIcon, adminOnly: true },
  { key: 'channels', label: 'Channels', icon: ChannelsIcon },
  { key: 'messages', label: 'Messages', icon: MessagesIcon },
];

const VALID_TAB_KEYS = new Set(NAV_ITEMS.map(item => item.key).concat('admin'));

function getTabFromPath() {
  const path = window.location.pathname.replace(/^\/+/, '').split('/')[0];
  if (path && VALID_TAB_KEYS.has(path)) return path;
  return null;
}

// Items marked { external: { triton: '/path' } } don't set an active tab —
// they open Triton Apex in a new tab via a short-lived SSO link.
const TRITON_BASE = 'https://www.tritonapex.io';
function openTritonTool(targetPath) {
  // Open tab synchronously so the browser doesn't block it as a popup
  const win = window.open('about:blank', '_blank');
  (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('triton-link', {
        body: { target: targetPath },
      });
      if (error || !data?.url) throw new Error(error?.message || 'No URL returned');
      if (win) win.location.href = data.url;
    } catch {
      const fallback = `${TRITON_BASE}${targetPath}`;
      if (win) win.location.href = fallback;
      else window.open(fallback, '_blank', 'noopener');
    }
  })();
}

const NAV_ICON_MAP = {
  dashboard: DashboardIcon,
  write: ResourcesIcon,
  production: ProductionIcon,
  scene_builder: ToolsIcon,
  screenwriter: IdeationIcon,
  teleprompter: ToolsIcon,
  broadcast: ToolsIcon,
  telestration: ToolsIcon,
  post_show: ToolsIcon,
  assets: ResourcesIcon,
  reviews: ReviewsIcon,
  organize: ToolsIcon,
  projects: ProjectsIcon,
  resources: ResourcesIcon,
  analytics: AnalyticsIcon,
  research: ResearchIcon,
  calendar: CalendarIcon,
  goals: GoalsIcon,
  business_dev: BusinessDevIcon,
  channels: ChannelsIcon,
  messages: MessagesIcon,
};

export default function AppLayout() {
  const { profile, signOut, isAdmin, isAssistant, unreadAnnouncementCount, newItineraryCount, markDashboardSeen, unreadMentionChannelIds, unreadNotificationCount, pendingProposalCount, refreshNotifications } = useAuth();
  const { getResolvedNav, saveConfig, saving } = useNavConfig();
  const [activeTab, setActiveTab] = useState(() => getTabFromPath() || localStorage.getItem('studio-hub-tab') || 'dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navTarget, setNavTarget] = useState(null);
  const [adminInitialTab, setAdminInitialTab] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const notifPanelRef = React.useRef(null);
  const mainContentRef = React.useRef(null);
  const [editMode, setEditMode] = useState(false);
  const [folderCollapseState, setFolderCollapseState] = useState(() =>
    JSON.parse(localStorage.getItem('nav-folder-state') || '{}')
  );

  // Persist folder collapse state
  useEffect(() => {
    localStorage.setItem('nav-folder-state', JSON.stringify(folderCollapseState));
  }, [folderCollapseState]);

  const resolvedNav = getResolvedNav(NAV_ITEMS, isAdmin);

  function toggleFolder(folderId) {
    setFolderCollapseState(prev => ({ ...prev, [folderId]: !prev[folderId] }));
  }

  // Persist active tab to localStorage and URL, reset scroll
  useEffect(() => {
    localStorage.setItem('studio-hub-tab', activeTab);
    const expectedPath = '/' + activeTab;
    if (window.location.pathname !== expectedPath) {
      window.history.pushState({}, '', expectedPath);
    }
    if (mainContentRef.current) mainContentRef.current.scrollTop = 0;
  }, [activeTab]);

  // Handle browser back/forward
  useEffect(() => {
    function handlePopState() {
      const tab = getTabFromPath();
      if (tab) setActiveTab(tab);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
    const item = NAV_ITEMS.find(i => i.key === key);
    if (item?.external?.url) {
      window.open(item.external.url, '_blank', 'noopener');
      return;
    }
    if (item?.external?.triton) {
      openTritonTool(item.external.triton);
      return;
    }
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
            <img src="/logo.png" alt="Mayday Studio" width="28" height="28" />
          </div>
          {!sidebarCollapsed && <span style={styles.logoText}>Mayday Studio</span>}
        </div>

        {/* Navigation */}
        <nav style={styles.nav}>
          {editMode && isAdmin && !sidebarCollapsed ? (
            <SidebarEditMode
              resolvedNav={resolvedNav}
              navIconMap={NAV_ICON_MAP}
              onSave={async (items) => {
                await saveConfig({ version: 1, items }, profile?.id);
                setEditMode(false);
              }}
              onReset={async () => {
                await saveConfig({}, profile?.id);
                setEditMode(false);
              }}
              onCancel={() => setEditMode(false)}
              saving={saving}
            />
          ) : (
            <>
              {(() => {
                // Build folder structure for rendering
                const folders = {};
                resolvedNav.filter(e => e.type === 'folder').forEach(f => {
                  folders[f.id] = { ...f, children: [] };
                });
                const topLevel = [];
                resolvedNav.forEach(entry => {
                  if (entry.type === 'folder') {
                    topLevel.push({ ...entry, children: folders[entry.id].children });
                  } else if (entry.folderId && folders[entry.folderId]) {
                    folders[entry.folderId].children.push(entry);
                  } else {
                    topLevel.push(entry);
                  }
                });

                return topLevel.map(entry => {
                  if (entry.type === 'folder') {
                    // When sidebar collapsed, render children as top-level icons
                    if (sidebarCollapsed) {
                      return entry.children.map(child => {
                        const Icon = NAV_ICON_MAP[child.key];
                        return (
                          <button
                            key={child.key}
                            onClick={() => handleNavClick(child.key)}
                            style={{
                              ...styles.navItem,
                              ...(activeTab === child.key ? styles.navItemActive : {}),
                              justifyContent: 'center',
                              position: 'relative',
                            }}
                            title={child.label}
                          >
                            {Icon && <Icon active={activeTab === child.key} />}
                            {child.key === 'dashboard' && dashboardNotifCount > 0 && (
                              <span style={styles.navBadge}>{dashboardNotifCount}</span>
                            )}
                            {child.key === 'channels' && unreadMentionChannelIds.length > 0 && (
                              <span style={styles.navBadge}>{unreadMentionChannelIds.length}</span>
                            )}
                            {child.key === 'projects' && pendingProposalCount > 0 && (
                              <span style={styles.navBadge}>{pendingProposalCount}</span>
                            )}
                          </button>
                        );
                      });
                    }
                    const isCollapsed = folderCollapseState[entry.id] ?? entry.collapsed;
                    const FolderIcon = FOLDER_ICON_MAP[entry.id];
                    return (
                      <React.Fragment key={entry.id}>
                        <button
                          onClick={() => toggleFolder(entry.id)}
                          style={{
                            ...styles.navItem,
                            justifyContent: 'flex-start',
                          }}
                          title={entry.label}
                        >
                          {FolderIcon && <FolderIcon active={false} />}
                          <span>{entry.label}</span>
                        </button>
                        {!isCollapsed && entry.children.map(child => {
                          const Icon = NAV_ICON_MAP[child.key];
                          return (
                            <button
                              key={child.key}
                              onClick={() => handleNavClick(child.key)}
                              style={{
                                ...styles.navItem,
                                ...(activeTab === child.key ? styles.navItemActive : {}),
                                justifyContent: 'flex-start',
                                paddingLeft: '32px',
                                position: 'relative',
                              }}
                              title={child.label}
                            >
                              {Icon && <Icon active={activeTab === child.key} />}
                              <span>{child.label}</span>
                              {child.key === 'dashboard' && dashboardNotifCount > 0 && (
                                <span style={styles.navBadge}>{dashboardNotifCount}</span>
                              )}
                              {child.key === 'channels' && unreadMentionChannelIds.length > 0 && (
                                <span style={styles.navBadge}>{unreadMentionChannelIds.length}</span>
                              )}
                              {child.key === 'projects' && pendingProposalCount > 0 && (
                                <span style={styles.navBadge}>{pendingProposalCount}</span>
                              )}
                            </button>
                          );
                        })}
                      </React.Fragment>
                    );
                  }

                  // Regular top-level item
                  const Icon = NAV_ICON_MAP[entry.key];
                  return (
                    <button
                      key={entry.key}
                      onClick={() => handleNavClick(entry.key)}
                      style={{
                        ...styles.navItem,
                        ...(activeTab === entry.key ? styles.navItemActive : {}),
                        justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        position: 'relative',
                      }}
                      title={sidebarCollapsed ? entry.label : undefined}
                    >
                      {Icon && <Icon active={activeTab === entry.key} />}
                      {!sidebarCollapsed && <span>{entry.label}</span>}
                      {entry.key === 'dashboard' && dashboardNotifCount > 0 && (
                        <span style={styles.navBadge}>{dashboardNotifCount}</span>
                      )}
                      {entry.key === 'channels' && unreadMentionChannelIds.length > 0 && (
                        <span style={styles.navBadge}>{unreadMentionChannelIds.length}</span>
                      )}
                      {entry.key === 'projects' && pendingProposalCount > 0 && (
                        <span style={styles.navBadge}>{pendingProposalCount}</span>
                      )}
                    </button>
                  );
                });
              })()}
            </>
          )}

          {/* Admin button - always last */}
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

          {/* Edit mode toggle - admin only, expanded sidebar only */}
          {isAdmin && !sidebarCollapsed && !editMode && (
            <button
              onClick={() => setEditMode(true)}
              style={{
                ...styles.navItem,
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.25)',
                fontSize: '11px',
                marginTop: '4px',
                padding: '6px 12px',
              }}
              title="Customize navigation"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M10 1.5l2.5 2.5L4.5 12H2v-2.5L10 1.5z" />
              </svg>
              <span>Edit nav</span>
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
        <div ref={mainContentRef} style={styles.mainContent}>
          {activeTab === 'dashboard' && <Dashboard onNavigate={navigateTo} />}
          {activeTab === 'projects' && <Projects onNavigate={navigateTo} />}
          {activeTab === 'calendar' && <Calendar onNavigate={navigateTo} />}
          {activeTab === 'production' && <Production />}
          {activeTab === 'ideation' && <Ideation initialConceptId={navTarget} onConceptOpened={() => setNavTarget(null)} />}
          {activeTab === 'resources' && <Resources />}
          {activeTab === 'write' && <Write />}
          {activeTab === 'screenwriter' && <Screenwriter initialScriptId={navTarget} onScriptOpened={() => setNavTarget(null)} />}
          {activeTab === 'teleprompter' && <Teleprompter onBack={() => setActiveTab('dashboard')} />}
          {activeTab === 'telestration' && <Telestration onBack={() => setActiveTab('dashboard')} />}
          {activeTab === 'post_show' && <PostShow onBack={() => setActiveTab('dashboard')} />}
          {activeTab === 'organize' && <Organize onBack={() => setActiveTab('dashboard')} />}
          {isAdmin && activeTab === 'analytics' && <Analytics />}
          {activeTab === 'research' && <Research />}
          {activeTab === 'reviews' && <Reviews />}
          {activeTab === 'goals' && <Goals />}
          {isAdmin && activeTab === 'business_dev' && <BusinessDev />}

          {activeTab === 'channels' && <Channels initialChannelName={navTarget} onChannelOpened={() => setNavTarget(null)} />}
          {activeTab === 'messages' && <Messages onNavigate={navigateTo} />}
          {isAdmin && activeTab === 'admin' && <AdminPanel initialTab={adminInitialTab} />}
        </div>
      </main>
      {profile?.mascot_enabled !== false && <Morty />}
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

function ProductionIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="2" y="7" width="16" height="10" rx="1.5" />
      <path d="M2 7l3-4h10l3 4" />
      <path d="M7 3l2 4M13 3l-2 4" />
    </svg>
  );
}

function GoalsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="4" />
      <circle cx="10" cy="10" r="1" fill={active ? '#a5b4fc' : '#6b7280'} />
    </svg>
  );
}

function BusinessDevIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M3 17V11M8 17V8M13 17V5M18 17V3" strokeLinecap="round" />
      <path d="M2 18h17" strokeLinecap="round" />
      <circle cx="13" cy="5" r="1.4" fill={active ? '#a5b4fc' : '#6b7280'} />
    </svg>
  );
}

function ToolsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M14.5 3.5a2.5 2.5 0 00-3.54 0L9.5 5l5 5 1.46-1.46a2.5 2.5 0 000-3.54l-1.46-1.5z" />
      <path d="M9.5 5L3 11.5V15h3.5L13 8.5" />
      <path d="M7.5 12.5L5 15" />
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

function PreProductionIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M4 3h9l3 3v11a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <path d="M13 3v3h3" />
      <path d="M6.5 10h7M6.5 13h5" strokeLinecap="round" />
    </svg>
  );
}

function FilmingIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="2" y="6" width="12" height="8" rx="1.5" />
      <path d="M14 9l4-2.5v7L14 11" />
    </svg>
  );
}

function PostProductionIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="2" y="4" width="16" height="12" rx="1.5" />
      <path d="M2 8h16M2 12h16" />
      <path d="M6 4v12M14 4v12" />
    </svg>
  );
}

function CoreTeamIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <circle cx="7" cy="8" r="3" />
      <circle cx="14" cy="8" r="2.4" />
      <path d="M2 17c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" strokeLinecap="round" />
      <path d="M12.5 17c0-2 1.5-3.5 3.5-3.5S19.5 15 19.5 17" strokeLinecap="round" />
    </svg>
  );
}

const FOLDER_ICON_MAP = {
  pre_production: PreProductionIcon,
  filming: FilmingIcon,
  post_production: PostProductionIcon,
  core_team: CoreTeamIcon,
};

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
