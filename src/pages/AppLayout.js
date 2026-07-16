import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import useNavConfig from '../hooks/useNavConfig';
import { getDisplayName, getDisplayInitial } from '../lib/displayName';
import { canAccessBroadcast } from '../lib/rolePermissions';
import { logUploadError } from '../lib/uploadErrors';
import backdropDismiss from '../lib/backdropDismiss';
import SidebarEditMode from '../components/SidebarEditMode';
import AgencyPortal from './AgencyPortal';
import Dashboard from './Dashboard';
import Projects from './Projects';
import Deliverables from './Deliverables';
import Calendar from './Calendar';
import Channels from './Channels';
import Messages from './Messages';
import AdminPanel from './AdminPanel';
import Ideation from './Ideation';
import Reviews from './Reviews';
import Resources from './Resources';
import Analytics from './analytics/Analytics';
import Tracking from './Tracking';
import Accounting from './Accounting';
import Research from './Research';
import ResearchDocs from './ResearchDocs';
import BusinessDev from './BusinessDev';
import Invoicing from './Invoicing';
import Payroll from './Payroll';
import Production from './Production';
import Screenwriter from './Screenwriter';
import Teleprompter from './tools/Teleprompter';
import Organize from './tools/Organize';
import PostShow from './tools/PostShow';
import Telestration from './tools/Telestration';
import PitchVideos from './tools/PitchVideos';
import Timeline from './tools/Timeline';
import Broadcast from './tools/Broadcast';
import Mailer from './tools/Mailer';
import Graphics from './tools/Graphics';

import FreelancerDashboard from './FreelancerDashboard';
import FreelancerHours from './FreelancerHours';
import FreelancerProfile from './FreelancerProfile';
import FreelancerNotifications from './FreelancerNotifications';
import FreelancerDocuments from './FreelancerDocuments';
import Freelancers from './Freelancers';
import Ideas from './Ideas';

import Jobs from './Jobs';
import Workflows from './Workflows';
import Ops from './Ops';
import Morty from '../components/Morty';
import FreelancerTour from '../components/FreelancerTour';
import PageErrorBoundary from '../components/PageErrorBoundary';

// Sidebar catalog. Labels listed here are aliased internally — the user
// refers to Production as "Beat Sheet", Scene Builder as "Custom Visuals",
// Telestration as "Telestrator", and Post Show as "Clipping Tool". Route
// keys stay stable to keep existing deep links working.
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: DashboardIcon },

  { key: 'projects', label: 'Projects', icon: ProjectsIcon },
  { key: 'ideas', label: 'Ideas', icon: ResourcesIcon },
  { key: 'production', label: 'Beat Sheet', icon: ProductionIcon },
  { key: 'research_docs', label: 'Research', icon: ResourcesIcon },
  { key: 'screenwriter', label: 'Screenwriter', icon: IdeationIcon },
  { key: 'teleprompter', label: 'Teleprompter', icon: ToolsIcon },
  { key: 'broadcast', label: 'Broadcast', icon: ToolsIcon, adminOnly: true },
  { key: 'telestration', label: 'Telestrator', icon: ToolsIcon },
  { key: 'pitch_videos', label: 'Asset Search', icon: CameraIcon },
  { key: 'post_show', label: 'Clipping Tool', icon: ToolsIcon },
  { key: 'timeline', label: 'Timeline', icon: ToolsIcon, adminOnly: true },
  { key: 'mailer', label: 'Mailer', icon: MailerIcon, adminOnly: true },
  { key: 'graphics', label: 'Graphics', icon: GraphicsIcon, adminOnly: true },
  { key: 'reviews', label: 'Reviews', icon: ReviewsIcon },
  { key: 'organize', label: 'Organize', icon: ToolsIcon },
  { key: 'deliverables', label: 'Deliverables', icon: DeliverablesIcon },
  { key: 'resources', label: 'Resources', icon: ResourcesIcon },
  { key: 'analytics', label: 'Analytics', icon: AnalyticsIcon, adminOnly: true },
  { key: 'tracking', label: 'Tracking', icon: AnalyticsIcon, adminOnly: true },
  { key: 'accounting', label: 'Accounting', icon: ExpensesIcon, adminOnly: true },
  { key: 'research', label: 'News', icon: ResearchIcon },
  { key: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { key: 'business_dev', label: 'Roadmap', icon: BusinessDevIcon, adminOnly: true },
  { key: 'payroll', label: 'Payroll', icon: PayrollIcon, adminOnly: true },
  { key: 'invoicing', label: 'Invoicing', icon: InvoicingIcon, adminOnly: true },
  { key: 'freelancers', label: 'Contractors', icon: FreelancersIcon, adminOnly: true },
  { key: 'workflows', label: 'Workflows', icon: WorkflowsIcon, adminOnly: true },
  { key: 'jobs', label: 'Jobs', icon: JobsIcon, adminOnly: true },
  { key: 'channels', label: 'Channels', icon: ChannelsIcon },
  { key: 'messages', label: 'Messages', icon: MessagesIcon },
];

const VALID_TAB_KEYS = new Set(NAV_ITEMS.map(item => item.key).concat('admin', 'ops', 'fl_dashboard', 'fl_hours', 'fl_profile', 'fl_notifications', 'fl_documents', 'fl_assignments', 'fl_submit', 'ideas'));

// ─── Modes ──────────────────────────────────────────────────
// Beta pages: still under refinement. Grouped in a "Beta" folder at the bottom
// of Admin Mode and visible only to the owner account below — no other role
// (or admin) sees them anywhere in the nav.
const BETA_OWNER_EMAIL = 'trevormayofficial@gmail.com';
const BETA_PAGE_KEYS = ['broadcast', 'timeline', 'graphics', 'mailer'];
const BETA_PAGE_NAV = [
  { type: 'folder', id: 'beta', label: 'Beta', collapsed: true },
  { type: 'item', key: 'broadcast', label: 'Broadcast', folderId: 'beta' },
  { type: 'item', key: 'timeline', label: 'Timeline', folderId: 'beta' },
  { type: 'item', key: 'graphics', label: 'Graphics', folderId: 'beta' },
  { type: 'item', key: 'mailer', label: 'Mailer', folderId: 'beta' },
];
// Admin-only pages that live in Admin Mode and are hidden from the Work View.
const ADMIN_PAGE_KEYS = ['payroll', 'analytics', 'tracking', 'accounting', 'business_dev', 'freelancers', 'workflows', 'jobs', 'invoicing', 'ops', ...BETA_PAGE_KEYS];
// Everyday anchors kept at the top of the Admin Mode sidebar (items + folders).
const ADMIN_ESSENTIAL_KEYS = ['dashboard', 'projects', 'calendar', 'deliverables', 'channels', 'messages'];
const ADMIN_ESSENTIAL_FOLDER_IDS = new Set(['pre_production', 'filming', 'post_production']);
// Admin-only page entries appended after a divider.
const ADMIN_PAGE_NAV = [
  { type: 'item', key: 'workflows', label: 'Workflows' },
  { type: 'item', key: 'tracking', label: 'Tracking' },
  { type: 'item', key: 'analytics', label: 'Analytics' },
  { type: 'item', key: 'accounting', label: 'Accounting' },
  { type: 'item', key: 'payroll', label: 'Payroll' },
  { type: 'item', key: 'business_dev', label: 'Roadmap' },
  { type: 'item', key: 'ops', label: 'Ops' },
  { type: 'folder', id: 'admin_tools', label: 'Tools', collapsed: true },
  { type: 'item', key: 'invoicing', label: 'Invoicing', folderId: 'admin_tools' },
  { type: 'item', key: 'freelancers', label: 'Contractors', folderId: 'admin_tools' },
  { type: 'item', key: 'jobs', label: 'Jobs', folderId: 'admin_tools' },
  { type: 'item', key: 'admin', label: 'Admin Settings' },
];
// Build Admin Mode sidebar: essential items/folders from resolved nav, divider,
// admin pages, then the Beta folder for the beta owner only.
function buildAdminNav(resolvedNav, isBetaOwner) {
  const essentialKeySet = new Set(ADMIN_ESSENTIAL_KEYS);
  const top = [];
  // Pull essential items and folders (with their children) from resolved nav
  for (const entry of resolvedNav) {
    if (entry.type === 'item' && essentialKeySet.has(entry.key)) {
      top.push(entry);
    } else if (entry.type === 'folder' && ADMIN_ESSENTIAL_FOLDER_IDS.has(entry.id)) {
      top.push(entry);
    } else if (entry.type === 'item' && entry.folderId && ADMIN_ESSENTIAL_FOLDER_IDS.has(entry.folderId)) {
      top.push(entry);
    }
  }
  return [...top, { type: 'divider' }, ...ADMIN_PAGE_NAV, ...(isBetaOwner ? BETA_PAGE_NAV : [])];
}
// Collect all valid tab keys for admin mode (essential items + folder children + admin pages).
function getAdminModeKeys(resolvedNav, isBetaOwner) {
  const keys = new Set([...ADMIN_ESSENTIAL_KEYS, ...ADMIN_PAGE_KEYS, 'admin']);
  if (!isBetaOwner) BETA_PAGE_KEYS.forEach(k => keys.delete(k));
  for (const entry of resolvedNav) {
    if (entry.type === 'item' && entry.folderId && ADMIN_ESSENTIAL_FOLDER_IDS.has(entry.folderId)) {
      keys.add(entry.key);
    }
  }
  return keys;
}

// Work View nav: strip the admin pages, retire the (now-empty) "Core Team"
// folder by promoting its remaining items to top level, and drop empty folders.
function buildWorkNav(nav) {
  let items = nav.filter(e => !(e.type === 'item' && ADMIN_PAGE_KEYS.includes(e.key)));
  const coreTeamIds = new Set(
    items.filter(e => e.type === 'folder' && /core team/i.test(e.label || '')).map(e => e.id),
  );
  items = items
    .filter(e => !(e.type === 'folder' && coreTeamIds.has(e.id)))
    .map(e => (e.type === 'item' && e.folderId && coreTeamIds.has(e.folderId)) ? { ...e, folderId: null } : e);
  const childCount = {};
  items.forEach(e => { if (e.type === 'item' && e.folderId) childCount[e.folderId] = (childCount[e.folderId] || 0) + 1; });
  return items.filter(e => !(e.type === 'folder' && !childCount[e.id]));
}

// Public URL aliases — the page is presented as "Roadmap" but keeps its
// internal business_dev key (nav config, permissions, bd_* tables).
const TAB_KEY_ALIASES = { roadmap: 'business_dev' };
const TAB_KEY_TO_PATH = { business_dev: 'roadmap' };

function getTabFromPath() {
  let path = window.location.pathname.replace(/^\/+/, '').split('/')[0];
  path = TAB_KEY_ALIASES[path] || path;
  if (path && VALID_TAB_KEYS.has(path)) return path;
  return null;
}

function getSubPathFromURL() {
  const segments = window.location.pathname.replace(/^\/+/, '').split('/');
  return segments[1] || null;
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
  research_docs: ResourcesIcon,
  screenwriter: IdeationIcon,
  teleprompter: ToolsIcon,
  broadcast: ToolsIcon,
  telestration: ToolsIcon,
  pitch_videos: CameraIcon,
  post_show: ToolsIcon,
  timeline: ToolsIcon,
  mailer: MailerIcon,
  graphics: GraphicsIcon,
  reviews: ReviewsIcon,
  organize: ToolsIcon,
  projects: ProjectsIcon,
  deliverables: DeliverablesIcon,
  resources: ResourcesIcon,
  analytics: AnalyticsIcon,
  tracking: AnalyticsIcon,
  accounting: ExpensesIcon,
  research: ResearchIcon,
  calendar: CalendarIcon,
  business_dev: BusinessDevIcon,
  payroll: PayrollIcon,
  invoicing: InvoicingIcon,
  freelancers: FreelancersIcon,
  workflows: WorkflowsIcon,
  ops: AnalyticsIcon,
  jobs: JobsIcon,
  channels: ChannelsIcon,
  messages: MessagesIcon,
  admin: AdminIcon,
  fl_dashboard: DashboardIcon,
  fl_hours: HoursIcon,
  fl_profile: ProfileIcon,
  fl_notifications: NotificationsIcon,
  fl_documents: DocumentsIcon,
  fl_assignments: ResourcesIcon,
  fl_submit: ResourcesIcon,
  ideas: IdeationIcon,
};

export default function AppLayout() {
  const { profile, signOut, isAdmin, isStrictAdmin, isAssistant, isPartner, isAgency, isFreelancer, restrictedNavKeys } = useAuth();
  const { unreadAnnouncementCount, markDashboardSeen, unreadMentionChannelIds, unreadNotificationCount, pendingProposalCount, agencyUnresolvedCount, unsignedDocCount, newAssignmentCount, myTaskCount, stuckCommentCount, flCommentCount, unreadMessageCount, refreshNotifications } = useNotifications();
  const { getResolvedNav, saveConfig, saving } = useNavConfig();
  const [activeTab, setActiveTab] = useState(() => {
    const fromPath = getTabFromPath();
    if (fromPath === 'my_tasks') return 'dashboard';
    if (fromPath) return fromPath;
    const stored = localStorage.getItem('studio-hub-tab');
    if (stored === 'my_tasks') return 'dashboard';
    if (stored && VALID_TAB_KEYS.has(stored)) return stored;
    return 'dashboard';
  });
  const [mode, setMode] = useState(() => localStorage.getItem('studio-hub-mode') === 'admin' ? 'admin' : 'work');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navTarget, setNavTarget] = useState(() => getSubPathFromURL());
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
  const [showTour, setShowTour] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  // Persist folder collapse state
  useEffect(() => {
    localStorage.setItem('nav-folder-state', JSON.stringify(folderCollapseState));
  }, [folderCollapseState]);

  // Non-admins can never be in Admin Mode; keep them pinned to Work View.
  useEffect(() => {
    if (!isAdmin && mode !== 'work') setMode('work');
  }, [isAdmin, mode]);

  useEffect(() => {
    localStorage.setItem('studio-hub-mode', mode);
  }, [mode]);

  const isBetaOwner = isAdmin && profile?.email === BETA_OWNER_EMAIL;
  // Beta pages never surface through the regular nav (or the nav editor) —
  // they exist only inside the Beta folder appended for the beta owner.
  const resolvedNav = getResolvedNav(NAV_ITEMS, isAdmin, isPartner, isFreelancer, profile, restrictedNavKeys)
    .filter(e => !(e.type === 'item' && BETA_PAGE_KEYS.includes(e.key)));
  const adminModeKeys = getAdminModeKeys(resolvedNav, isBetaOwner);

  // On load (and when mode flips), keep the open page consistent with the mode.
  useEffect(() => {
    if (mode === 'admin' && isAdmin) {
      if (!adminModeKeys.has(activeTab)) setActiveTab('workflows');
    } else if (ADMIN_PAGE_KEYS.includes(activeTab)) {
      setActiveTab('dashboard');
    }
    // eslint-disable-next-line
  }, [mode, isAdmin]);

  // Role-based route guard: if the role doesn't have access to the current tab
  // (e.g. a member reaching an adminOnly page like /payroll or /mailer via a
  // direct URL or browser back/forward), bounce them off it. Mirrors the render
  // gates: adminOnly pages need isAdmin, except broadcast (broadcast tier) and
  // business_dev (partners).
  useEffect(() => {
    const navItem = NAV_ITEMS.find(i => i.key === activeTab);
    const adminOnlyBlocked = navItem?.adminOnly
      && !isAdmin
      && !(activeTab === 'broadcast' && canAccessBroadcast(profile?.role))
      && !(activeTab === 'business_dev' && isPartner);
    if (restrictedNavKeys?.has(activeTab) || adminOnlyBlocked) {
      setActiveTab(isFreelancer ? 'fl_dashboard' : 'dashboard');
    }
    // eslint-disable-next-line
  }, [activeTab, restrictedNavKeys, isAdmin, isPartner, isFreelancer, profile]);

  // Mode-filtered nav. Admin-only pages live in Admin Mode and disappear from
  // the default Work View; flipping the bottom button swaps the sidebar.
  const adminNav = buildAdminNav(resolvedNav, isBetaOwner).filter(
    (e) => e.type !== 'item' || !restrictedNavKeys?.has(e.key),
  );
  const displayNav = ((mode === 'admin' && isAdmin) ? adminNav : buildWorkNav(resolvedNav))
    .filter(e => !e.hidden);

  function toggleMode() {
    if (mode === 'work') {
      setMode('admin');
      if (!adminModeKeys.has(activeTab)) setActiveTab('workflows');
    } else {
      setMode('work');
      if (ADMIN_PAGE_KEYS.includes(activeTab)) setActiveTab('dashboard');
    }
  }

  function toggleFolder(folderId) {
    setFolderCollapseState(prev => ({ ...prev, [folderId]: !prev[folderId] }));
  }

  // Persist active tab to localStorage and URL, reset scroll
  useEffect(() => {
    localStorage.setItem('studio-hub-tab', activeTab);
    const tabPath = TAB_KEY_TO_PATH[activeTab] || activeTab;
    const segments = window.location.pathname.replace(/^\/+/, '').split('/');
    if (segments[0] !== tabPath && segments[0] !== activeTab) {
      window.history.pushState({}, '', '/' + tabPath);
    }
    if (mainContentRef.current) mainContentRef.current.scrollTop = 0;
  }, [activeTab]);

  // Handle browser back/forward
  useEffect(() => {
    function handlePopState() {
      const tab = getTabFromPath();
      if (tab) setActiveTab(tab);
      setNavTarget(getSubPathFromURL());
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

  // Redirect freelancers to their dashboard if landing on a non-freelancer tab
  useEffect(() => {
    if (isFreelancer && !activeTab.startsWith('fl_') && activeTab !== 'resources' && activeTab !== 'pitch_videos' && activeTab !== 'channels' && activeTab !== 'messages' && activeTab !== 'fl_assignments' && activeTab !== 'fl_submit') {
      setActiveTab('fl_dashboard');
    }
    // activeTab in deps so back/forward (popstate) to a disallowed tab re-redirects
  }, [isFreelancer, activeTab]); // eslint-disable-line

  // Check whether freelancer has completed the onboarding tour
  useEffect(() => {
    if (!isFreelancer || !profile?.id) return;
    supabase.from('freelancer_profiles').select('tour_completed_at').eq('id', profile.id).single()
      .then(async ({ data, error }) => {
        if (error || !data) {
          // Row missing — create it so the tour can run
          await supabase.from('freelancer_profiles').upsert({ id: profile.id });
          setShowTour(true);
        } else if (!data.tour_completed_at) {
          setShowTour(true);
        }
      });
  }, [isFreelancer, profile?.id]);

  async function handleTourComplete() {
    setShowTour(false);
    await supabase.from('freelancer_profiles')
      .update({ tour_completed_at: new Date().toISOString() })
      .eq('id', profile.id);
  }

  const dashboardNotifCount = unreadAnnouncementCount + (isAdmin ? flCommentCount : 0) + myTaskCount;

  function handleNavClick(key) {
    if (key === 'fl_assignments' && profile?.assigned_drive_folder_id) {
      window.open(`https://drive.google.com/drive/folders/${profile.assigned_drive_folder_id}`, '_blank', 'noopener');
      return;
    }
    if (key === 'fl_submit') {
      setShowSubmitModal(true);
      return;
    }
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
    const resolved = tab === 'my_tasks' ? 'dashboard' : tab;
    setNavTarget(target || null);
    setActiveTab(resolved);
  }

  const fetchNotifications = useCallback(async () => {
    if (!profile?.id) return;
    setNotificationsLoading(true);
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
      setNotificationsLoading(false);
    }
  }, [profile?.id]);

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
  }, [showNotifications, profile?.id, fetchNotifications]);

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


  // Agency accounts get a locked, sidebar-free portal — nothing else in the
  // app is reachable (RLS enforces the same on the API side).
  if (isAgency) {
    return <AgencyPortal />;
  }

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
                displayNav.filter(e => e.type === 'folder').forEach(f => {
                  folders[f.id] = { ...f, children: [] };
                });
                const topLevel = [];
                displayNav.forEach(entry => {
                  if (entry.type === 'folder') {
                    topLevel.push({ ...entry, children: folders[entry.id].children });
                  } else if (entry.folderId && folders[entry.folderId]) {
                    folders[entry.folderId].children.push(entry);
                  } else {
                    topLevel.push(entry);
                  }
                });

                return topLevel.map((entry, entryIdx) => {
                  if (entry.type === 'divider') {
                    return sidebarCollapsed
                      ? <div key={`div-${entryIdx}`} style={styles.navDividerCollapsed} />
                      : <div key={`div-${entryIdx}`} style={styles.navDivider}>Admin</div>;
                  }
                  if (entry.type === 'folder') {
                    // When sidebar collapsed, render children as top-level icons
                    if (sidebarCollapsed) {
                      return entry.children.map(child => {
                        const Icon = NAV_ICON_MAP[child.key];
                        return (
                          <button
                            key={child.key}
                            data-nav-key={child.key}
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
                            {child.key === 'messages' && unreadMessageCount > 0 && (
                              <span style={styles.navBadge}>{unreadMessageCount > 99 ? '99+' : unreadMessageCount}</span>
                            )}
                            {child.key === 'deliverables' && agencyUnresolvedCount > 0 && (
                              <span style={styles.navBadge}>{agencyUnresolvedCount}</span>
                            )}
                            {child.key === 'deliverables' && agencyUnresolvedCount === 0 && pendingProposalCount > 0 && (
                              <span style={styles.navDot} />
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
                              data-nav-key={child.key}
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
                              {child.key === 'messages' && unreadMessageCount > 0 && (
                                <span style={styles.navBadge}>{unreadMessageCount > 99 ? '99+' : unreadMessageCount}</span>
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
                      data-nav-key={entry.key}
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
                      {entry.key === 'messages' && unreadMessageCount > 0 && (
                        <span style={styles.navBadge}>{unreadMessageCount > 99 ? '99+' : unreadMessageCount}</span>
                      )}
                      {entry.key === 'deliverables' && agencyUnresolvedCount > 0 && (
                        <span style={styles.navBadge}>{agencyUnresolvedCount}</span>
                      )}
                      {entry.key === 'deliverables' && agencyUnresolvedCount === 0 && pendingProposalCount > 0 && (
                        <span style={styles.navDot} />
                      )}
                      {entry.key === 'fl_documents' && unsignedDocCount > 0 && (
                        <span style={styles.navBadge}>{unsignedDocCount}</span>
                      )}
                      {entry.key === 'fl_dashboard' && newAssignmentCount > 0 && (
                        <span style={styles.navDot} />
                      )}
                      {entry.key === 'freelancers' && stuckCommentCount > 0 && (
                        <span style={styles.navBadge}>{stuckCommentCount}</span>
                      )}
                    </button>
                  );
                });
              })()}
            </>
          )}

          {/* Edit mode toggle - admin only, Work View, expanded sidebar only */}
          {isAdmin && mode === 'work' && !sidebarCollapsed && !editMode && (
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

        {/* Admin Mode toggle - between collapse toggle and user area */}
        {isAdmin && (
          <button
            onClick={toggleMode}
            style={{
              ...styles.navItem,
              ...(mode === 'admin' ? styles.navItemActive : {}),
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              marginTop: '8px',
            }}
            title={sidebarCollapsed ? (mode === 'admin' ? 'Exit Admin Mode' : 'Admin Mode') : undefined}
          >
            <AdminIcon active={mode === 'admin'} />
            {!sidebarCollapsed && <span>{mode === 'admin' ? 'Exit Admin Mode' : 'Admin Mode'}</span>}
          </button>
        )}

        {/* Gerald (Mayday Assistant) - strict admin only, opens in new tab */}
        {isStrictAdmin && (
          <button
            onClick={() => window.open('https://assist.mmcreate.io', '_blank', 'noopener,noreferrer')}
            style={{
              ...styles.navItem,
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            }}
            title={sidebarCollapsed ? 'Gerald — Mayday Assistant' : 'Opens Gerald in a new tab'}
          >
            <GeraldIcon active={false} />
            {!sidebarCollapsed && <span>Gerald</span>}
          </button>
        )}

        {/* User area */}
        <div style={{
          ...styles.userArea,
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
        }}>
          <div style={styles.avatar}>
            {getDisplayInitial(profile)}
          </div>
          {!sidebarCollapsed && (
            <div style={styles.userInfo}>
              <div style={styles.userName}>{getDisplayName(profile)}</div>
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
          {activeTab === 'dashboard' && <PageErrorBoundary key="dashboard"><Dashboard onNavigate={navigateTo} /></PageErrorBoundary>}

          {activeTab === 'projects' && <PageErrorBoundary key="projects"><Projects onNavigate={navigateTo} /></PageErrorBoundary>}
          {activeTab === 'deliverables' && <PageErrorBoundary key="deliverables"><Deliverables initialCampaignId={navTarget} onCampaignOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {activeTab === 'calendar' && <PageErrorBoundary key="calendar"><Calendar onNavigate={navigateTo} /></PageErrorBoundary>}
          {activeTab === 'production' && <PageErrorBoundary key="production"><Production initialSheetId={navTarget} onSheetOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {activeTab === 'ideation' && <PageErrorBoundary key="ideation"><Ideation initialConceptId={navTarget} onConceptOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {activeTab === 'resources' && <PageErrorBoundary key="resources"><Resources /></PageErrorBoundary>}
          {activeTab === 'ideas' && <PageErrorBoundary key="ideas"><Ideas /></PageErrorBoundary>}
          {activeTab === 'screenwriter' && <PageErrorBoundary key="screenwriter"><Screenwriter initialScriptId={navTarget} onScriptOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {activeTab === 'teleprompter' && <PageErrorBoundary key="teleprompter"><Teleprompter onBack={() => setActiveTab('dashboard')} /></PageErrorBoundary>}
          {activeTab === 'telestration' && <PageErrorBoundary key="telestration"><Telestration onBack={() => setActiveTab('dashboard')} /></PageErrorBoundary>}
          {activeTab === 'pitch_videos' && <PageErrorBoundary key="pitch_videos"><PitchVideos onBack={() => setActiveTab(isFreelancer ? 'fl_dashboard' : 'dashboard')} /></PageErrorBoundary>}
          {activeTab === 'post_show' && <PageErrorBoundary key="post_show"><PostShow onBack={() => setActiveTab('dashboard')} /></PageErrorBoundary>}
          {activeTab === 'timeline' && <PageErrorBoundary key="timeline"><Timeline /></PageErrorBoundary>}
          {activeTab === 'organize' && <PageErrorBoundary key="organize"><Organize onBack={() => setActiveTab('dashboard')} /></PageErrorBoundary>}
          {canAccessBroadcast(profile?.role) && activeTab === 'broadcast' && <PageErrorBoundary key="broadcast"><Broadcast onBack={() => setActiveTab('dashboard')} /></PageErrorBoundary>}
          {isAdmin && activeTab === 'mailer' && <PageErrorBoundary key="mailer"><Mailer onBack={() => setActiveTab('dashboard')} /></PageErrorBoundary>}
          {activeTab === 'graphics' && <PageErrorBoundary key="graphics"><Graphics onBack={() => setActiveTab('dashboard')} /></PageErrorBoundary>}
          {isAdmin && activeTab === 'analytics' && <PageErrorBoundary key="analytics"><Analytics /></PageErrorBoundary>}
          {isAdmin && activeTab === 'tracking' && <PageErrorBoundary key="tracking"><Tracking /></PageErrorBoundary>}
          {isAdmin && activeTab === 'accounting' && <PageErrorBoundary key="accounting"><Accounting initialTab={navTarget} onTabOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {activeTab === 'research' && <PageErrorBoundary key="research"><Research /></PageErrorBoundary>}
          {activeTab === 'research_docs' && <PageErrorBoundary key="research_docs"><ResearchDocs /></PageErrorBoundary>}
          {activeTab === 'reviews' && <PageErrorBoundary key="reviews"><Reviews /></PageErrorBoundary>}
          {(isAdmin || isPartner) && activeTab === 'business_dev' && <PageErrorBoundary key="business_dev"><BusinessDev /></PageErrorBoundary>}
          {isAdmin && activeTab === 'payroll' && <PageErrorBoundary key="payroll"><Payroll /></PageErrorBoundary>}
          {isAdmin && activeTab === 'invoicing' && <PageErrorBoundary key="invoicing"><Invoicing /></PageErrorBoundary>}

          {activeTab === 'channels' && <PageErrorBoundary key="channels"><Channels initialChannelName={navTarget} onChannelOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {activeTab === 'messages' && <PageErrorBoundary key="messages"><Messages onNavigate={navigateTo} /></PageErrorBoundary>}
          {isAdmin && activeTab === 'admin' && <PageErrorBoundary key="admin"><AdminPanel initialTab={adminInitialTab} /></PageErrorBoundary>}
          {isAdmin && activeTab === 'freelancers' && <PageErrorBoundary key="freelancers"><Freelancers initialAssignmentId={navTarget} onAssignmentOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {isAdmin && activeTab === 'workflows' && <PageErrorBoundary key="workflows"><Workflows /></PageErrorBoundary>}
          {isAdmin && activeTab === 'ops' && <PageErrorBoundary key="ops"><Ops /></PageErrorBoundary>}
          {isAdmin && activeTab === 'jobs' && <PageErrorBoundary key="jobs"><Jobs initialApplicationId={navTarget} onApplicationOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {isFreelancer && activeTab === 'fl_dashboard' && <PageErrorBoundary key="fl_dashboard"><FreelancerDashboard onNavigate={navigateTo} /></PageErrorBoundary>}
          {isFreelancer && activeTab === 'fl_hours' && <PageErrorBoundary key="fl_hours"><FreelancerHours /></PageErrorBoundary>}
          {isFreelancer && activeTab === 'fl_profile' && <PageErrorBoundary key="fl_profile"><FreelancerProfile /></PageErrorBoundary>}
          {isFreelancer && activeTab === 'fl_notifications' && <PageErrorBoundary key="fl_notifications"><FreelancerNotifications onNavigate={navigateTo} /></PageErrorBoundary>}
          {isFreelancer && activeTab === 'fl_documents' && <PageErrorBoundary key="fl_documents"><FreelancerDocuments /></PageErrorBoundary>}
        </div>
      </main>
      {profile?.mascot_enabled !== false && <Morty />}
      {showTour && (
        <FreelancerTour
          onComplete={handleTourComplete}
          onNavigate={(key) => setActiveTab(key)}
        />
      )}
      {showSubmitModal && (
        <SubmitModal onClose={() => setShowSubmitModal(false)} />
      )}
    </div>
  );
}

// --- Submit Modal ---
const SUBMISSIONS_FOLDER_ID = '1r1dENUCjNSs57MjidYbE2rWrbMKXpLM0';

function SubmitModal({ onClose }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null); // { type: 'success'|'error', text }
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = React.useRef(null);

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
          parentFolderId: SUBMISSIONS_FOLDER_ID,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });
      statusCode = initRes.status;
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(initJson.error || 'Failed to init upload');

      // Upload file bytes directly to Drive via XHR for progress tracking
      phase = 'put';
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', initJson.uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else { statusCode = xhr.status; reject(new Error(`Upload failed (${xhr.status})`)); }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(file);
      });

      setResult({ type: 'success', text: `"${file.name}" uploaded successfully!` });
      setFile(null);
    } catch (err) {
      setResult({ type: 'error', text: err.message });
      logUploadError({ phase, file, statusCode, error: err, context: { folder_id: SUBMISSIONS_FOLDER_ID } });
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
          <span style={submitStyles.title}>Submit Deliverable</span>
          <button onClick={onClose} style={submitStyles.closeBtn}>&times;</button>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            ...submitStyles.dropZone,
            borderColor: dragOver ? '#6366f1' : 'rgba(255,255,255,0.15)',
            background: dragOver ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
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
    background: '#1a1a2e', borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw',
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
    height: '100%', borderRadius: 3, background: '#6366f1', transition: 'width 0.2s ease',
  },
  uploadBtn: {
    padding: '8px 20px', borderRadius: 8, border: 'none', background: '#6366f1',
    color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'DM Sans, sans-serif',
  },
  cancelBtn: {
    padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
    background: 'transparent', color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
    fontSize: 14, fontFamily: 'DM Sans, sans-serif',
  },
};

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

function MyTasksIcon({ active }) {
  const c = active ? '#a5b4fc' : '#6b7280';
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10.5l4.5 4.5L16 5.5" />
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

function DeliverablesIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M2 10c2-2 3.5-3 5-3s2.5 1.5 3 3c.5-1.5 1.5-3 3-3s3 1 5 3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 10c0 2 1 3.5 2.5 4M18 10c0 2-1 3.5-2.5 4" strokeLinecap="round" />
      <circle cx="7" cy="7" r="1" fill={active ? '#a5b4fc' : '#6b7280'} stroke="none" />
      <circle cx="13" cy="7" r="1" fill={active ? '#a5b4fc' : '#6b7280'} stroke="none" />
    </svg>
  );
}

function InvoicingIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="4" y="2" width="12" height="16" rx="2" />
      <path d="M7 6h6M7 9h6M7 12h4" strokeLinecap="round" />
      <path d="M4 15h12" />
    </svg>
  );
}

function PayrollIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M3 8h14" />
      <circle cx="10" cy="13" r="2" />
      <path d="M10 11v0.5M10 14.5v0.5" strokeLinecap="round" />
    </svg>
  );
}

function ExpensesIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M3 6h14l-1 11H4z" />
      <path d="M7 6V4a3 3 0 0 1 6 0v2" />
      <path d="M8 11h4" strokeLinecap="round" />
    </svg>
  );
}

function FreelancersIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <circle cx="7" cy="6" r="2.5" />
      <path d="M2 16c0-2.5 2-4.5 5-4.5s5 2 5 4.5" strokeLinecap="round" />
      <circle cx="14" cy="7" r="2" />
      <path d="M18 16c0-2 -1.5-3.5-4-3.5" strokeLinecap="round" />
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

function CameraIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="2" y="5.5" width="11" height="9" rx="2" />
      <path d="M13 9.5l5-2.5v6l-5-2.5" strokeLinejoin="round" />
    </svg>
  );
}

function GraphicsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M12 2l6 6-10 10H2v-6L12 2z" strokeLinejoin="round" />
      <path d="M10 4l6 6" />
      <path d="M2 18l4-4" strokeLinecap="round" />
    </svg>
  );
}

function MailerIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="2" y="4" width="16" height="12" rx="2" />
      <path d="M2 6l8 5 8-5" strokeLinejoin="round" />
    </svg>
  );
}

function WorkflowsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <circle cx="10" cy="3" r="2" />
      <circle cx="5" cy="10" r="2" />
      <circle cx="15" cy="10" r="2" />
      <circle cx="10" cy="17" r="2" />
      <path d="M10 5v3M8 9l-1.5-1M12 9l1.5-1M7 11l1.5 4.5M13 11l-1.5 4.5" strokeLinecap="round" />
    </svg>
  );
}

function JobsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="6" width="14" height="10" rx="2" />
      <path d="M7 6V4.5a1 1 0 011-1h4a1 1 0 011 1V6" strokeLinecap="round" />
      <path d="M3 10h14" strokeLinecap="round" />
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

function GeraldIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M10 2l1.8 4.5L16.5 8l-4.7 1.5L10 14l-1.8-4.5L3.5 8l4.7-1.5L10 2z" strokeLinejoin="round" />
      <path d="M16 13l.9 2.1L19 16l-2.1.9L16 19l-.9-2.1L13 16l2.1-.9L16 13z" strokeLinejoin="round" />
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

function HoursIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProfileIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.5 17c0-3 2.9-5.5 6.5-5.5s6.5 2.5 6.5 5.5" strokeLinecap="round" />
    </svg>
  );
}

function NotificationsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M15 8a5 5 0 00-10 0c0 5.5-2.5 7.5-2.5 7.5h15S15 13.5 15 8z" strokeLinejoin="round" />
      <path d="M11.5 18a1.7 1.7 0 01-3 0" strokeLinecap="round" />
    </svg>
  );
}

function DocumentsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M6 2h5l5 5v9a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" strokeLinejoin="round" />
      <path d="M11 2v5h5" strokeLinejoin="round" />
      <path d="M7 12h6M7 15h4" strokeLinecap="round" />
    </svg>
  );
}

function ToolsFolderIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M12.7 5.3a3.5 3.5 0 014.6-.9l-2.5 2.5.8 1.5 1.5.8 2.5-2.5a3.5 3.5 0 01-5.2 4.3l-6.6 6.6a1.6 1.6 0 01-2.3-2.3l6.6-6.6a3.5 3.5 0 01.6-3.4z" strokeLinejoin="round" transform="scale(0.82) translate(1.5 1.5)" />
    </svg>
  );
}

function BetaFolderIcon({ active }) {
  // Lab flask — marks the Beta folder of pages still under refinement.
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#a5b4fc' : '#6b7280'} strokeWidth="1.5">
      <path d="M8 2.5h4M9 2.5v5L4.5 15a2 2 0 001.7 3h7.6a2 2 0 001.7-3L11 7.5v-5" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M6.5 12.5h7" strokeLinecap="round" />
    </svg>
  );
}

const FOLDER_ICON_MAP = {
  pre_production: PreProductionIcon,
  filming: FilmingIcon,
  post_production: PostProductionIcon,
  core_team: CoreTeamIcon,
  admin_tools: ToolsFolderIcon,
  beta: BetaFolderIcon,
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
    minHeight: 0,
    overflowY: 'auto',
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
  navDivider: {
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.3)',
    padding: '12px 12px 4px',
    borderTop: '1px solid rgba(255,255,255,0.07)',
    marginTop: '6px',
  },
  navDividerCollapsed: {
    height: '1px',
    background: 'rgba(255,255,255,0.07)',
    margin: '8px 8px',
  },
  navBadge: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
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
  navDot: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    right: '10px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#ef4444',
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
