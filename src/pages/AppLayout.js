import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import useNavConfig from '../hooks/useNavConfig';
import { getDisplayName, getDisplayInitial } from '../lib/displayName';
import { canAccessBroadcast, canManageClients } from '../lib/rolePermissions';
import { useImpersonation } from '../lib/impersonation';
import { startViewAs } from '../lib/viewAs';
import SettingsModal from '../components/SettingsModal';
import { logUploadError } from '../lib/uploadErrors';
import backdropDismiss from '../lib/backdropDismiss';
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
import WhiteboardTool from './tools/Whiteboard';
import PitchVideos from './tools/PitchVideos';
import Timeline from './tools/Timeline';
import Broadcast from './tools/Broadcast';
import Mailer from './tools/Mailer';
import Graphics from './tools/Graphics';

import ContractorDashboard from './ContractorDashboard';
import ContractorHours from './ContractorHours';
import ContractorProfile from './ContractorProfile';
import ContractorNotifications from './ContractorNotifications';
import ContractorDocuments from './ContractorDocuments';
import ContractorReviews from './ContractorReviews';
import Contractors from './Contractors';
import Clients from './Clients';
import ClientDashboard from './ClientDashboard';
import ClientCalendar from './ClientCalendar';
import ClientReview from './ClientReview';
import ClientDocuments from './ClientDocuments';
import ClientProfile from './ClientProfile';
import Ideas from './Ideas';

import Jobs from './Jobs';
import Workflows from './Workflows';
import Ops from './Ops';
import Morty from '../components/Morty';
import MortyChat from '../components/MortyChat';
import ContractorTour from '../components/ContractorTour';
import PageErrorBoundary from '../components/PageErrorBoundary';
import SuiteLauncher from './SuiteLauncher';
import SuiteComingSoon from './SuiteComingSoon';
import HarborApp from './harbor/HarborApp';
import { getSuiteViewFromPath, rememberBridge } from '../lib/suite';
import { getSuiteAppForSegment } from '../lib/suiteApps';
import { colors, fontSizes, fontWeights } from '../lib/styleTokens';

// Sidebar catalog. Labels listed here are aliased internally — the user
// refers to Production as "Beat Sheet", Scene Builder as "Custom Visuals",
// Telestration as "Telestrator", and Post Show as "Video Tools". Route
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
  { key: 'whiteboard', label: 'Whiteboard', icon: WhiteboardIcon },
  { key: 'pitch_videos', label: 'Asset Search', icon: CameraIcon },
  { key: 'post_show', label: 'Video Tools', icon: ToolsIcon },
  { key: 'timeline', label: 'Timeline', icon: ToolsIcon, adminOnly: true },
  { key: 'mailer', label: 'Mailer', icon: MailerIcon, adminOnly: true },
  { key: 'graphics', label: 'Graphics', icon: GraphicsIcon },
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
  { key: 'freelancers', label: 'Contractors', icon: ContractorsIcon, adminOnly: true },
  { key: 'workflows', label: 'Workflows', icon: WorkflowsIcon, adminOnly: true },
  { key: 'jobs', label: 'Jobs', icon: JobsIcon, adminOnly: true },
  { key: 'channels', label: 'Channels', icon: ChannelsIcon },
  { key: 'messages', label: 'Messages', icon: MessagesIcon },
];

const VALID_TAB_KEYS = new Set(NAV_ITEMS.map(item => item.key).concat('admin', 'ops', 'fl_dashboard', 'fl_hours', 'fl_profile', 'fl_notifications', 'fl_documents', 'fl_assignments', 'fl_submit', 'fl_reviews', 'ideas', 'ct_assignments', 'ct_hours', 'ct_documents', 'ct_team', 'clients', 'cl_dashboard', 'cl_calendar', 'cl_review', 'cl_documents', 'cl_profile', 'cl_notifications'));

// ─── Modes ──────────────────────────────────────────────────
// Beta pages: still under refinement. Grouped in a "Beta" folder at the bottom
// of Admin Mode and visible only to the owner account below — no other role
// (or admin) sees them anywhere in the nav.
const BETA_OWNER_EMAIL = 'trevormayofficial@gmail.com';
const BETA_PAGE_KEYS = ['broadcast', 'timeline', 'mailer'];
const BETA_PAGE_NAV = [
  { type: 'folder', id: 'beta', label: 'Beta', collapsed: true },
  { type: 'item', key: 'broadcast', label: 'Broadcast', folderId: 'beta' },
  { type: 'item', key: 'timeline', label: 'Timeline', folderId: 'beta' },
  { type: 'item', key: 'mailer', label: 'Mailer', folderId: 'beta' },
];
// Admin-only pages that live in Admin Mode and are hidden from the Work View.
const ADMIN_PAGE_KEYS = ['payroll', 'analytics', 'tracking', 'accounting', 'business_dev', 'freelancers', 'clients', 'workflows', 'jobs', 'invoicing', 'ops', ...BETA_PAGE_KEYS];
// Production folders: everything nested under these lives in Production Mode
// (below the divider) instead of the everyday/general list.
const PRODUCTION_FOLDER_IDS = new Set(['pre_production', 'filming', 'post_production']);
// Admin-only page entries appended after a divider.
const ADMIN_PAGE_NAV = [
  { type: 'item', key: 'workflows', label: 'Workflows' },
  { type: 'item', key: 'tracking', label: 'Tracking' },
  { type: 'item', key: 'analytics', label: 'Analytics' },
  { type: 'item', key: 'accounting', label: 'Accounting' },
  { type: 'item', key: 'payroll', label: 'Payroll' },
  { type: 'item', key: 'business_dev', label: 'Roadmap' },
  { type: 'item', key: 'clients', label: 'Clients' },
  { type: 'item', key: 'ops', label: 'Ops' },
  { type: 'folder', id: 'admin_tools', label: 'Tools', collapsed: true },
  { type: 'item', key: 'invoicing', label: 'Invoicing', folderId: 'admin_tools' },
  { type: 'item', key: 'jobs', label: 'Jobs', folderId: 'admin_tools' },
  { type: 'item', key: 'admin', label: 'Admin Settings' },
];
// Contractor Mode: the Contractors management page split into sidebar submenu
// items (admin-only; contractors keep their own locked portal). Each key
// renders the Contractors component pinned to the matching tab.
const CONTRACTOR_MODE_KEYS = ['ct_assignments', 'ct_hours', 'ct_documents', 'ct_team'];
const CONTRACTOR_TAB_FOR_KEY = { ct_assignments: 'Assignments', ct_hours: 'Hours', ct_documents: 'Documents', ct_team: 'Team' };
const CONTRACTOR_MODE_NAV = [
  { type: 'item', key: 'ct_assignments', label: 'Assignments' },
  { type: 'item', key: 'ct_hours', label: 'Hours' },
  { type: 'item', key: 'ct_documents', label: 'Documents' },
  { type: 'item', key: 'ct_team', label: 'Team' },
];
// General everyday nav — shared by the TOP of every mode (Work, Production,
// Admin, Contractor). Strips the admin-only pages (they live below the divider
// in Admin Mode) and the production folders (they live in Production Mode),
// retires the "Core Team" folder by promoting any survivors to top level, and
// drops folders left empty.
function buildGeneralNav(nav) {
  let items = nav.filter(e =>
    !(e.type === 'item' && ADMIN_PAGE_KEYS.includes(e.key))
    && !(e.type === 'folder' && PRODUCTION_FOLDER_IDS.has(e.id))
    && !(e.type === 'item' && e.folderId && PRODUCTION_FOLDER_IDS.has(e.folderId)),
  );
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

// Pull the production folders (and their children) out of the resolved nav,
// preserving order — the section shown below the divider in Production Mode.
function buildProductionSection(resolvedNav) {
  const out = [];
  for (const entry of resolvedNav) {
    if (entry.type === 'folder' && PRODUCTION_FOLDER_IDS.has(entry.id)) out.push(entry);
    else if (entry.type === 'item' && entry.folderId && PRODUCTION_FOLDER_IDS.has(entry.folderId)) out.push(entry);
  }
  return out;
}

// Item keys present in a built nav array (folders excluded).
function navItemKeys(navArray) {
  const keys = new Set();
  for (const e of navArray) if (e.type === 'item') keys.add(e.key);
  return keys;
}

// Admin Mode: general list, divider, admin pages, then the Beta folder for the
// beta owner only.
function buildAdminNav(resolvedNav, isBetaOwner) {
  return [...buildGeneralNav(resolvedNav), { type: 'divider' }, ...ADMIN_PAGE_NAV, ...(isBetaOwner ? BETA_PAGE_NAV : [])];
}

// Production Mode: general list, divider, then the production folders.
function buildProductionNav(resolvedNav) {
  const section = buildProductionSection(resolvedNav);
  const general = buildGeneralNav(resolvedNav);
  return section.length ? [...general, { type: 'divider' }, ...section] : general;
}

// Contractor Mode: general list, divider, then the contractor management pages.
function buildContractorModeNav(resolvedNav) {
  return [...buildGeneralNav(resolvedNav), { type: 'divider' }, ...CONTRACTOR_MODE_NAV];
}

// Valid tab keys for Admin Mode: general list + production (viewable, just not
// shown in the admin sidebar) + admin pages + Admin Settings.
function getAdminModeKeys(resolvedNav, isBetaOwner) {
  const keys = new Set([
    ...ADMIN_PAGE_KEYS, 'admin',
    ...navItemKeys(buildGeneralNav(resolvedNav)),
    ...navItemKeys(buildProductionSection(resolvedNav)),
  ]);
  if (!isBetaOwner) BETA_PAGE_KEYS.forEach(k => keys.delete(k));
  return keys;
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
  whiteboard: WhiteboardIcon,
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
  freelancers: ContractorsIcon,
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
  fl_reviews: ReviewsIcon,
  ideas: IdeationIcon,
  clients: ContractorsIcon,
  cl_dashboard: DashboardIcon,
  cl_calendar: CalendarIcon,
  cl_review: ReviewsIcon,
  cl_documents: DocumentsIcon,
  cl_profile: ProfileIcon,
  cl_notifications: NotificationsIcon,
  ct_assignments: ResourcesIcon,
  ct_hours: HoursIcon,
  ct_documents: DocumentsIcon,
  ct_team: ContractorsIcon,
};

// The four sidebar views, surfaced through a single mode dropdown. Availability
// is role-gated where the dropdown is built (Work: all staff; Production: all
// staff; Admin/Contractor: admins only).
const MODE_META = {
  work: { label: 'Work View', icon: WorkModeIcon },
  production: { label: 'Production Mode', icon: ProductionModeIcon },
  admin: { label: 'Admin Mode', icon: AdminIcon },
  contractor: { label: 'Contractor Mode', icon: ContractorModeIcon },
};

export default function AppLayout() {
  const { profile, signOut, isAdmin, isStrictAdmin, isAssistant, isPartner, isContractor, isClient, restrictedNavKeys } = useAuth();
  // Suite gating: the app launcher + Bridge branding + Harbor are ADMIN-ONLY
  // for now (Trevor's call at merge time, 2026-07-24). This single flag gates
  // the launcher landing, the suite URL deep-links (/launcher, /harbor,
  // /anchor, /radar), the Bridge brand mark, and the Apps button. Non-admins
  // — including non-admin staff and the freelancer/partner portal roles —
  // keep the classic "Mayday Studio" tab app exactly as it was pre-suite:
  // bare '/' resolves to Bridge (see src/lib/suite.js) so they land on their
  // usual page, never in the launcher. Widen this back to
  // `!isContractor && !isPartner` to reopen the suite to all staff.
  const isSuiteUser = isAdmin;
  const { unreadAnnouncementCount, markDashboardSeen, unreadMentionChannelIds, unreadNotificationCount, pendingProposalCount, unsignedDocCount, newAssignmentCount, myTaskCount, stuckCommentCount, flCommentCount, unreadMessageCount, newApplicationCount, refreshNotifications } = useNotifications();
  const { getResolvedNav } = useNavConfig();
  const [activeTab, setActiveTab] = useState(() => {
    const fromPath = getTabFromPath();
    if (fromPath === 'my_tasks') return 'dashboard';
    if (fromPath) return fromPath;
    const stored = localStorage.getItem('studio-hub-tab');
    if (stored === 'my_tasks') return 'dashboard';
    if (stored && VALID_TAB_KEYS.has(stored)) return stored;
    return 'dashboard';
  });
  const [mode, setMode] = useState(() => {
    const m = localStorage.getItem('studio-hub-mode');
    return (m === 'admin' || m === 'contractor' || m === 'production') ? m : 'work';
  });
  // Suite surface: 'launcher' | 'harbor' | null (null = Bridge, the classic
  // tab world). Resolved from the URL before tab resolution; bare '/' goes to
  // the last-used app or the launcher on first login (see src/lib/suite.js).
  const [suiteView, setSuiteView] = useState(() => (isSuiteUser ? getSuiteViewFromPath() : null));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navTarget, setNavTarget] = useState(() => getSubPathFromURL());
  const [adminInitialTab, setAdminInitialTab] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const notifPanelRef = React.useRef(null);
  const mainContentRef = React.useRef(null);
  const [folderCollapseState, setFolderCollapseState] = useState(() =>
    JSON.parse(localStorage.getItem('nav-folder-state') || '{}')
  );
  const [showTour, setShowTour] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  // Admin "View as…" — true-impersonation preview of a contractor's portal.
  const { active: impersonating, contractor: impersonatedContractor, start: startImpersonation, stop: stopImpersonation } = useImpersonation();
  const [viewAsMenuOpen, setViewAsMenuOpen] = useState(false);
  // Settings moved out of the Dashboard so every role can reach it — the
  // contractor and client portals never render that page.
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [viewAsContractors, setViewAsContractors] = useState([]);
  // "View as… staff" opens a separate tab running under that member's own
  // session — a real read of their data, not the chrome-only portal preview.
  const [viewAsStaff, setViewAsStaff] = useState([]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = React.useRef(null);
  // Simulated Client Portal preview (chrome-only): renders the locked client
  // nav + cl_* pages as the admin's own identity, so every query comes back
  // empty. No impersonation edge fn — there's no client-side of it yet.
  const [previewingClientSim, setPreviewingClientSim] = useState(false);

  // Persist folder collapse state
  useEffect(() => {
    localStorage.setItem('nav-folder-state', JSON.stringify(folderCollapseState));
  }, [folderCollapseState]);

  // Production Mode is open to all staff (admins, directors, members);
  // contractors/clients get their own locked portals. Admin & Contractor Mode
  // stay admin-only — bounce a non-admin out of those back to Work View.
  const canUseProductionMode = !isContractor && !isClient;
  useEffect(() => {
    if (!isAdmin && mode !== 'work' && !(mode === 'production' && canUseProductionMode)) setMode('work');
  }, [isAdmin, mode, canUseProductionMode]);

  useEffect(() => {
    localStorage.setItem('studio-hub-mode', mode);
  }, [mode]);

  const isBetaOwner = isAdmin && profile?.email === BETA_OWNER_EMAIL;
  // Beta pages never surface through the regular nav (or the nav editor) —
  // they exist only inside the Beta folder appended for the beta owner.
  const resolvedNav = getResolvedNav(NAV_ITEMS, isAdmin, isPartner, isContractor, profile, restrictedNavKeys, isClient)
    .filter(e => !(e.type === 'item' && BETA_PAGE_KEYS.includes(e.key)));
  const adminModeKeys = getAdminModeKeys(resolvedNav, isBetaOwner);

  // On load (and when mode flips), keep the open page consistent with the mode.
  // Production pages stay viewable in every mode (they're only *shown* in the
  // Production sidebar), so only the mode-exclusive pages bounce.
  useEffect(() => {
    if (mode === 'admin' && isAdmin) {
      if (!adminModeKeys.has(activeTab)) setActiveTab('workflows');
    } else if (mode === 'contractor' && isAdmin) {
      // Contractor Mode shows the general list too; only admin-exclusive pages are invalid.
      if (ADMIN_PAGE_KEYS.includes(activeTab)) setActiveTab('ct_assignments');
    } else if (ADMIN_PAGE_KEYS.includes(activeTab) || CONTRACTOR_MODE_KEYS.includes(activeTab)) {
      // Work / Production: bounce off admin- and contractor-exclusive pages.
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
      setActiveTab(isContractor ? 'fl_dashboard' : isClient ? 'cl_dashboard' : 'dashboard');
    }
    // Clients page is admin + Creative Director only (UI gate; DB passes is_admin).
    if (activeTab === 'clients' && !canManageClients(profile?.role, profile?.sub_role)) {
      setActiveTab('dashboard');
    }
    // eslint-disable-next-line
  }, [activeTab, restrictedNavKeys, isAdmin, isPartner, isContractor, isClient, profile]);

  // Mode-filtered nav. Admin-only pages live in Admin Mode and disappear from
  // the default Work View; flipping the bottom button swaps the sidebar.
  const adminNav = buildAdminNav(resolvedNav, isBetaOwner).filter(
    (e) => e.type !== 'item'
      || (!restrictedNavKeys?.has(e.key)
        && !(e.key === 'clients' && !canManageClients(profile?.role, profile?.sub_role))),
  );
  // "View as…" contractor portal preview (admin only). When active, the layout
  // renders the locked contractor sidebar + fl_* pages as a contractor would
  // see them. Data is the admin's own (empty), so it's a chrome/layout preview.
  const previewingContractor = isAdmin && impersonating;
  const asContractor = isContractor || previewingContractor;
  const previewingClient = isAdmin && previewingClientSim;
  const asClient = isClient || previewingClient;
  const contractorNav = previewingContractor
    ? getResolvedNav(NAV_ITEMS, false, false, true, profile, new Set())
    : null;
  const clientSimNav = previewingClient
    ? getResolvedNav(NAV_ITEMS, false, false, false, profile, new Set(), true)
    : null;

  const displayNav = (
    previewingContractor ? contractorNav
      : previewingClient ? clientSimNav
        : (mode === 'admin' && isAdmin) ? adminNav
          : (mode === 'contractor' && isAdmin) ? buildContractorModeNav(resolvedNav)
            : (mode === 'production' && canUseProductionMode) ? buildProductionNav(resolvedNav)
              : buildGeneralNav(resolvedNav)
  ).filter(e => !e.hidden);

  async function openViewAsMenu() {
    const next = !viewAsMenuOpen;
    setViewAsMenuOpen(next);
    if (next && viewAsContractors.length === 0) {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, sub_role, title')
        .in('role', ['contractor', 'freelancer'])
        .order('full_name');
      setViewAsContractors(data || []);
    }
    // Members only — the edge function refuses admin-tier targets (escalation
    // path) and clients (no client-side preview exists).
    if (next && isStrictAdmin && viewAsStaff.length === 0) {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, title')
        .eq('role', 'member')
        .neq('id', profile?.id)
        .order('full_name');
      setViewAsStaff(data || []);
    }
  }
  async function viewAsStaffMember(userId) {
    setViewAsMenuOpen(false);
    try {
      await startViewAs(supabase, userId);
    } catch (e) {
      window.alert(`Could not start preview: ${e.message}`);
    }
  }
  async function viewAsContractor(contractorId) {
    setViewAsMenuOpen(false);
    try {
      await startImpersonation(contractorId);
      setActiveTab('fl_dashboard');
    } catch (e) {
      window.alert(`Could not start preview: ${e.message}`);
    }
  }
  function exitViewAs() {
    stopImpersonation();
    setActiveTab('dashboard');
  }
  function viewAsClientSim() {
    setViewAsMenuOpen(false);
    setPreviewingClientSim(true);
    setActiveTab('cl_dashboard');
  }
  function exitClientSim() {
    setPreviewingClientSim(false);
    setActiveTab('dashboard');
  }

  // Leaving admin/contractor mode: bounce off any mode-only page.
  function resetTabToWork() {
    if (ADMIN_PAGE_KEYS.includes(activeTab) || CONTRACTOR_MODE_KEYS.includes(activeTab)) setActiveTab('dashboard');
  }
  // Unified mode switch behind the sidebar dropdown. Keeps the current page
  // wherever it's valid in the target mode; otherwise lands somewhere sensible.
  function selectMode(next) {
    setModeMenuOpen(false);
    if (next === mode) return;
    setMode(next);
    if (next === 'admin') {
      if (!adminModeKeys.has(activeTab)) setActiveTab('workflows');
    } else if (next === 'contractor') {
      // Contractor Mode carries the general list; only admin-exclusive pages bounce.
      if (ADMIN_PAGE_KEYS.includes(activeTab)) setActiveTab('ct_assignments');
    } else {
      // Work / Production carry the general list; bounce off mode-exclusive pages.
      resetTabToWork();
    }
  }

  function toggleFolder(folderId) {
    setFolderCollapseState(prev => ({ ...prev, [folderId]: !prev[folderId] }));
  }

  // Persist active tab to localStorage and URL, reset scroll. While a suite
  // page (launcher / harbor / a coming-soon teaser) is showing, it owns the
  // URL instead.
  useEffect(() => {
    if (suiteView) {
      const seg = window.location.pathname.replace(/^\/+/, '').split('/')[0];
      if (seg !== suiteView) window.history.pushState({}, '', '/' + suiteView);
      return;
    }
    localStorage.setItem('studio-hub-tab', activeTab);
    const tabPath = TAB_KEY_TO_PATH[activeTab] || activeTab;
    const segments = window.location.pathname.replace(/^\/+/, '').split('/');
    if (segments[0] !== tabPath && segments[0] !== activeTab) {
      window.history.pushState({}, '', '/' + tabPath);
    }
    if (mainContentRef.current) mainContentRef.current.scrollTop = 0;
  }, [activeTab, suiteView]);

  // Entering Bridge (rendering its chrome) records it as the last-used suite
  // app. The launcher and Harbor deliberately never write this key.
  useEffect(() => {
    if (isSuiteUser && !suiteView) rememberBridge();
  }, [isSuiteUser, suiteView]);

  // Browser-tab title per suite surface ("Harbor · Mayday Studio",
  // "Anchor · Mayday Studio", …). Auth pages keep the index.html default;
  // portal roles stay plain "Mayday Studio".
  useEffect(() => {
    const suiteApp = suiteView ? getSuiteAppForSegment(suiteView) : null;
    document.title = !isSuiteUser ? 'Mayday Studio'
      : suiteApp ? `${suiteApp.name} · Mayday Studio`
      : suiteView === 'launcher' ? 'Mayday Studio'
      : 'Bridge · Mayday Studio';
  }, [isSuiteUser, suiteView]);

  // Handle browser back/forward. Suite segments ('launcher' / 'harbor' /
  // 'anchor' / 'radar' / bare '/') resolve before tab resolution so history
  // works across launcher ↔ Bridge ↔ Harbor ↔ teasers.
  useEffect(() => {
    function handlePopState() {
      if (isSuiteUser) {
        const view = getSuiteViewFromPath();
        setSuiteView(view);
        if (view) return; // suite page owns the URL; leave tab state alone
      }
      const tab = getTabFromPath();
      if (tab) setActiveTab(tab);
      setNavTarget(getSubPathFromURL());
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isSuiteUser]);

  // Handle Google Calendar OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gcal_connected') === 'true' || params.get('gcal_error')) {
      setAdminInitialTab('google');
      setSuiteView(null); // OAuth returns to bare '/' — land in Bridge, not the launcher
      setActiveTab('admin');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Redirect freelancers to their dashboard if landing on a non-freelancer tab
  useEffect(() => {
    if (isContractor && !activeTab.startsWith('fl_') && activeTab !== 'pitch_videos' && activeTab !== 'channels' && activeTab !== 'messages' && activeTab !== 'fl_assignments' && activeTab !== 'fl_submit') {
      setActiveTab('fl_dashboard');
    }
    // activeTab in deps so back/forward (popstate) to a disallowed tab re-redirects
  }, [isContractor, activeTab]); // eslint-disable-line

  // Clients are pinned to their locked portal tabs (+ Messages).
  useEffect(() => {
    if (isClient && !activeTab.startsWith('cl_') && activeTab !== 'messages') {
      setActiveTab('cl_dashboard');
    }
  }, [isClient, activeTab]); // eslint-disable-line

  // Check whether freelancer has completed the onboarding tour
  useEffect(() => {
    if (!isContractor || !profile?.id) return;
    supabase.from('contractor_profiles').select('tour_completed_at').eq('id', profile.id).single()
      .then(async ({ data, error }) => {
        if (error || !data) {
          // Row missing — create it so the tour can run
          await supabase.from('contractor_profiles').upsert({ id: profile.id });
          setShowTour(true);
        } else if (!data.tour_completed_at) {
          setShowTour(true);
        }
      });
  }, [isContractor, profile?.id]);

  async function handleTourComplete() {
    setShowTour(false);
    await supabase.from('contractor_profiles')
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

  // Toast notifications (DMs / mentions) ask us to switch tabs on click.
  React.useEffect(() => {
    function onNavigate(e) {
      const { tab, target } = e.detail || {};
      if (tab) navigateTo(tab, target);
    }
    window.addEventListener('mayday:navigate', onNavigate);
    return () => window.removeEventListener('mayday:navigate', onNavigate);
  }, []);

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

  React.useEffect(() => {
    if (!modeMenuOpen) return;
    function handleClickOutside(e) {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target)) {
        setModeMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modeMenuOpen]);


  // ── Mayday Studio suite pages (staff only; full-screen, no sidebar) ──
  // Rendered after all hooks. Portal roles never reach these (isSuiteUser),
  // so their locked-portal behavior keeps precedence over /launcher,
  // /harbor, /anchor, /radar. Only Bridge writes suite_last_app (via
  // rememberBridge here + the render effect above); Harbor and the
  // coming-soon teasers never do. External apps (Cast/Drift/Fathom) are
  // plain links on the launcher cards — they never set suiteView.
  if (isSuiteUser && suiteView === 'launcher') {
    return (
      <SuiteLauncher
        isStrictAdmin={isStrictAdmin}
        onOpenApp={(app) => {
          if (app.key === 'bridge') { rememberBridge(); setSuiteView(null); }
          else if (app.segment) setSuiteView(app.segment);
        }}
      />
    );
  }
  if (isSuiteUser && suiteView === 'harbor') {
    return <HarborApp onBackToLauncher={() => setSuiteView('launcher')} />;
  }
  const comingSoonApp = isSuiteUser && suiteView ? getSuiteAppForSegment(suiteView) : null;
  if (comingSoonApp && comingSoonApp.kind === 'coming-soon') {
    return <SuiteComingSoon app={comingSoonApp} onBackToLauncher={() => setSuiteView('launcher')} />;
  }

  return (
    <div style={styles.layout}>
      {/* Sidebar */}
      <aside style={{
        ...styles.sidebar,
        width: sidebarCollapsed ? '72px' : '240px',
      }}>
        {/* Logo — staff see the Bridge app brand with the suite mark under it */}
        <div style={styles.logoArea}>
          <div style={styles.logoIcon}>
            <img src="/logo.png" alt="Mayday Studio" width="28" height="28" />
          </div>
          {!sidebarCollapsed && (isSuiteUser ? (
            <div style={styles.logoStack}>
              <span style={styles.logoText}>Bridge</span>
              <span style={styles.logoSuiteMark}>Mayday Studio</span>
            </div>
          ) : (
            <span style={styles.logoText}>Mayday Studio</span>
          ))}
        </div>

        {/* Navigation */}
        <nav style={styles.nav}>
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
                            {child.key === 'jobs' && newApplicationCount > 0 && (
                              <span style={styles.navBadge}>{newApplicationCount > 99 ? '99+' : newApplicationCount}</span>
                            )}
                            {child.key === 'deliverables' && pendingProposalCount > 0 && (
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
                              {child.key === 'jobs' && newApplicationCount > 0 && (
                                <span style={styles.navBadge}>{newApplicationCount > 99 ? '99+' : newApplicationCount}</span>
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
                      {entry.key === 'jobs' && newApplicationCount > 0 && (
                        <span style={styles.navBadge}>{newApplicationCount > 99 ? '99+' : newApplicationCount}</span>
                      )}
                      {entry.key === 'deliverables' && pendingProposalCount > 0 && (
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

        {/* View switcher — a single dropdown consolidating Work / Production /
            Admin / Contractor. Work + Production for all staff; Admin +
            Contractor for admins only. */}
        {canUseProductionMode && !previewingContractor && !previewingClient && (() => {
          const modeOptions = [
            'work',
            ...(canUseProductionMode ? ['production'] : []),
            ...(isAdmin ? ['admin', 'contractor'] : []),
          ];
          if (modeOptions.length < 2) return null;
          const current = MODE_META[mode] || MODE_META.work;
          const CurrentIcon = current.icon;
          return (
            <div ref={modeMenuRef} style={{ position: 'relative', marginTop: '8px' }}>
              <button
                onClick={() => setModeMenuOpen((o) => !o)}
                style={{
                  ...styles.navItem,
                  ...(mode !== 'work' ? styles.navItemActive : {}),
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  width: '100%',
                }}
                title={sidebarCollapsed ? current.label : undefined}
              >
                <CurrentIcon active={mode !== 'work'} />
                {!sidebarCollapsed && <span style={{ flex: 1, textAlign: 'left' }}>{current.label}</span>}
                {!sidebarCollapsed && <ChevronToggleIcon open={modeMenuOpen} />}
              </button>
              {modeMenuOpen && (
                <div style={styles.viewAsMenu}>
                  <div style={styles.viewAsMenuHeader}>Switch view</div>
                  {modeOptions.map((m) => {
                    const meta = MODE_META[m];
                    const OptIcon = meta.icon;
                    const isCurrent = mode === m;
                    return (
                      <button
                        key={m}
                        onClick={() => selectMode(m)}
                        style={{
                          ...styles.viewAsMenuItem,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          ...(isCurrent ? { color: '#a5b4fc' } : {}),
                        }}
                      >
                        <OptIcon active={isCurrent} />
                        <span style={{ flex: 1 }}>{meta.label}</span>
                        {isCurrent && <span aria-hidden>✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* App switcher — Mayday Studio suite launcher (admin-only). Sits just
            above the user area (where Gerald used to be); Gerald now lives as a
            card on the Apps launcher itself. */}
        {isAdmin && !previewingContractor && !previewingClient && (
          <button
            onClick={() => setSuiteView('launcher')}
            style={{
              ...styles.navItem,
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              marginTop: '8px',
            }}
            title={sidebarCollapsed ? 'Apps — Mayday Studio suite' : 'Open the app launcher'}
          >
            <AppsIcon active={false} />
            {!sidebarCollapsed && <span>Apps</span>}
          </button>
        )}

        {/* "View as…" — preview the contractor portal by sub-role (admin only). */}
        {isAdmin && !previewingContractor && !previewingClient && (
          <div style={{ position: 'relative', marginTop: '8px' }}>
            <button
              onClick={openViewAsMenu}
              style={{
                ...styles.navItem,
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                width: '100%',
              }}
              title={sidebarCollapsed ? 'View as… (contractor portal preview)' : 'Preview a contractor portal'}
            >
              <ViewAsIcon active={false} />
              {!sidebarCollapsed && <span>View as…</span>}
            </button>
            {viewAsMenuOpen && (
              <div style={styles.viewAsMenu}>
                <div style={styles.viewAsMenuHeader}>Preview a portal</div>
                <button style={{ ...styles.viewAsMenuItem, color: '#a5b4fc' }} onClick={viewAsClientSim}>
                  Client Portal · simulated
                </button>
                {isStrictAdmin && (
                  <>
                    <div style={styles.viewAsMenuHeader}>As staff · opens a new tab</div>
                    {viewAsStaff.length === 0 ? (
                      <div style={{ ...styles.viewAsMenuItem, color: 'rgba(255,255,255,0.4)', cursor: 'default' }}>No members</div>
                    ) : viewAsStaff.map(m => (
                      <button key={m.id} style={styles.viewAsMenuItem} onClick={() => viewAsStaffMember(m.id)}>
                        {m.full_name || 'Unnamed'}{m.title ? ` · ${m.title}` : ''}
                      </button>
                    ))}
                  </>
                )}
                <div style={styles.viewAsMenuHeader}>As contractor</div>
                {viewAsContractors.length === 0 ? (
                  <div style={{ ...styles.viewAsMenuItem, color: 'rgba(255,255,255,0.4)', cursor: 'default' }}>No contractors</div>
                ) : viewAsContractors.map(c => (
                  <button key={c.id} style={styles.viewAsMenuItem} onClick={() => viewAsContractor(c.id)}>
                    {c.full_name || 'Unnamed'}{(c.sub_role || c.title) ? ` · ${c.sub_role || c.title}` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings — sits directly above the user block, for every role. */}
        <button
          onClick={() => setShowSettingsModal(true)}
          style={{
            ...styles.settingsBtn,
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          }}
          title="Settings"
        >
          <span style={styles.settingsBtnIcon}>&#9881;</span>
          {!sidebarCollapsed && <span>Settings</span>}
        </button>

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
                          background: n.is_read ? 'transparent' : 'rgba(91, 143, 199,0.06)',
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
          {previewingContractor && (
            <div style={styles.viewAsBanner}>
              <span style={{ fontSize: 13, color: '#f9a8d4', fontWeight: 600 }}>
                👁 Previewing portal as <strong style={{ color: '#fff' }}>{impersonatedContractor?.full_name || 'contractor'}</strong>
                {impersonatedContractor?.sub_role ? ` · ${impersonatedContractor.sub_role}` : ''} · read-only
              </span>
              <button onClick={exitViewAs} style={styles.viewAsExitBtn}>Exit preview</button>
            </div>
          )}
          {previewingClient && (
            <div style={styles.viewAsBanner}>
              <span style={{ fontSize: 13, color: '#a5b4fc', fontWeight: 600 }}>
                👁 Previewing the <strong style={{ color: '#fff' }}>Client Portal</strong> · simulated — no client data, pages show their empty states
              </span>
              <button onClick={exitClientSim} style={styles.viewAsExitBtn}>Exit preview</button>
            </div>
          )}
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
          {activeTab === 'whiteboard' && <PageErrorBoundary key="whiteboard"><WhiteboardTool onBack={() => setActiveTab('dashboard')} /></PageErrorBoundary>}
          {activeTab === 'pitch_videos' && <PageErrorBoundary key="pitch_videos"><PitchVideos onBack={() => setActiveTab(asContractor ? 'fl_dashboard' : 'dashboard')} /></PageErrorBoundary>}
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
          {activeTab === 'reviews' && <PageErrorBoundary key="reviews"><Reviews initialReviewId={navTarget} onOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {(isAdmin || isPartner) && activeTab === 'business_dev' && <PageErrorBoundary key="business_dev"><BusinessDev /></PageErrorBoundary>}
          {isAdmin && activeTab === 'payroll' && <PageErrorBoundary key="payroll"><Payroll /></PageErrorBoundary>}
          {isAdmin && activeTab === 'invoicing' && <PageErrorBoundary key="invoicing"><Invoicing /></PageErrorBoundary>}

          {activeTab === 'channels' && <PageErrorBoundary key="channels"><Channels initialChannelName={navTarget} onChannelOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {activeTab === 'messages' && <PageErrorBoundary key="messages"><Messages onNavigate={navigateTo} simulateClient={previewingClient} initialConversationId={navTarget} onConversationOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {isAdmin && activeTab === 'admin' && <PageErrorBoundary key="admin"><AdminPanel initialTab={adminInitialTab} /></PageErrorBoundary>}
          {isAdmin && activeTab === 'freelancers' && <PageErrorBoundary key="freelancers"><Contractors initialAssignmentId={navTarget} onAssignmentOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {isAdmin && CONTRACTOR_MODE_KEYS.includes(activeTab) && <PageErrorBoundary key="contractor-mode"><Contractors chromeless activeTabKey={CONTRACTOR_TAB_FOR_KEY[activeTab]} initialAssignmentId={navTarget} onAssignmentOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {isAdmin && activeTab === 'workflows' && <PageErrorBoundary key="workflows"><Workflows /></PageErrorBoundary>}
          {isAdmin && activeTab === 'ops' && <PageErrorBoundary key="ops"><Ops /></PageErrorBoundary>}
          {isAdmin && activeTab === 'jobs' && <PageErrorBoundary key="jobs"><Jobs initialApplicationId={navTarget} onApplicationOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {asContractor && activeTab === 'fl_dashboard' && <PageErrorBoundary key="fl_dashboard"><ContractorDashboard onNavigate={navigateTo} /></PageErrorBoundary>}
          {asContractor && activeTab === 'fl_hours' && <PageErrorBoundary key="fl_hours"><ContractorHours /></PageErrorBoundary>}
          {asContractor && activeTab === 'fl_profile' && <PageErrorBoundary key="fl_profile"><ContractorProfile /></PageErrorBoundary>}
          {asContractor && activeTab === 'fl_notifications' && <PageErrorBoundary key="fl_notifications"><ContractorNotifications onNavigate={navigateTo} /></PageErrorBoundary>}
          {asContractor && activeTab === 'fl_documents' && <PageErrorBoundary key="fl_documents"><ContractorDocuments /></PageErrorBoundary>}
          {asContractor && activeTab === 'fl_reviews' && <PageErrorBoundary key="fl_reviews"><ContractorReviews initialReviewId={navTarget} onOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {isAdmin && canManageClients(profile?.role, profile?.sub_role) && activeTab === 'clients' && <PageErrorBoundary key="clients"><Clients /></PageErrorBoundary>}
          {asClient && activeTab === 'cl_dashboard' && <PageErrorBoundary key="cl_dashboard"><ClientDashboard onNavigate={navigateTo} initialAssignmentId={navTarget} onAssignmentOpened={() => setNavTarget(null)} /></PageErrorBoundary>}
          {asClient && activeTab === 'cl_calendar' && <PageErrorBoundary key="cl_calendar"><ClientCalendar onNavigate={navigateTo} demo={previewingClient} /></PageErrorBoundary>}
          {asClient && activeTab === 'cl_review' && <PageErrorBoundary key="cl_review"><ClientReview initialReviewId={navTarget} onOpened={() => setNavTarget(null)} demo={previewingClient} /></PageErrorBoundary>}
          {asClient && activeTab === 'cl_documents' && <PageErrorBoundary key="cl_documents"><ClientDocuments /></PageErrorBoundary>}
          {asClient && activeTab === 'cl_profile' && <PageErrorBoundary key="cl_profile"><ClientProfile /></PageErrorBoundary>}
          {asClient && activeTab === 'cl_notifications' && <PageErrorBoundary key="cl_notifications"><ContractorNotifications onNavigate={navigateTo} /></PageErrorBoundary>}
        </div>
      </main>
      {profile?.mascot_enabled !== false && <Morty />}
      {!asContractor && !isPartner && !asClient && profile?.assistant_enabled !== false && <MortyChat />}
      {showTour && (
        <ContractorTour
          onComplete={handleTourComplete}
          onNavigate={(key) => setActiveTab(key)}
        />
      )}
      {showSubmitModal && (
        <SubmitModal onClose={() => setShowSubmitModal(false)} />
      )}
      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
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

// --- Nav Icons ---
function DashboardIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill={active ? '#8fb4d8' : '#6b7280'}>
      <rect x="2" y="2" width="7" height="7" rx="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ProjectsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M7 7h6M7 10h6M7 13h4" />
    </svg>
  );
}

function CalendarIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 8h14M7 2v4M13 2v4" />
    </svg>
  );
}

function ChannelsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M7 2l-2 16M15 2l-2 16M3 7h16M2 13h16" />
    </svg>
  );
}

function MessagesIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M4 4h12a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3V6a2 2 0 012-2z" />
    </svg>
  );
}

function ReviewsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="4" width="14" height="10" rx="2" />
      <path d="M8 17h4" />
      <path d="M8 9l2 1.5L12 8" />
    </svg>
  );
}

function IdeationIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M10 2a5 5 0 013 9v2a1 1 0 01-1 1H8a1 1 0 01-1-1v-2a5 5 0 013-9z" />
      <path d="M8 16h4M9 18h2" />
    </svg>
  );
}

function AnalyticsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M3 17V10M8 17V7M13 17V4M18 17V1" strokeLinecap="round" />
    </svg>
  );
}

function ResourcesIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M4 4h5l2 2h5a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" />
      <path d="M8 12h4M8 9.5h4" />
    </svg>
  );
}

function ResearchIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <circle cx="8" cy="8" r="5" />
      <path d="M12 12l5 5" />
      <path d="M6 5h4M6 8h3" />
    </svg>
  );
}

function ProductionIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="2" y="7" width="16" height="10" rx="1.5" />
      <path d="M2 7l3-4h10l3 4" />
      <path d="M7 3l2 4M13 3l-2 4" />
    </svg>
  );
}

function MyTasksIcon({ active }) {
  const c = active ? '#8fb4d8' : '#6b7280';
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10.5l4.5 4.5L16 5.5" />
    </svg>
  );
}


function BusinessDevIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M3 17V11M8 17V8M13 17V5M18 17V3" strokeLinecap="round" />
      <path d="M2 18h17" strokeLinecap="round" />
      <circle cx="13" cy="5" r="1.4" fill={active ? '#8fb4d8' : '#6b7280'} />
    </svg>
  );
}

function DeliverablesIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M2 10c2-2 3.5-3 5-3s2.5 1.5 3 3c.5-1.5 1.5-3 3-3s3 1 5 3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 10c0 2 1 3.5 2.5 4M18 10c0 2-1 3.5-2.5 4" strokeLinecap="round" />
      <circle cx="7" cy="7" r="1" fill={active ? '#8fb4d8' : '#6b7280'} stroke="none" />
      <circle cx="13" cy="7" r="1" fill={active ? '#8fb4d8' : '#6b7280'} stroke="none" />
    </svg>
  );
}

function InvoicingIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="4" y="2" width="12" height="16" rx="2" />
      <path d="M7 6h6M7 9h6M7 12h4" strokeLinecap="round" />
      <path d="M4 15h12" />
    </svg>
  );
}

function PayrollIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M3 8h14" />
      <circle cx="10" cy="13" r="2" />
      <path d="M10 11v0.5M10 14.5v0.5" strokeLinecap="round" />
    </svg>
  );
}

function ExpensesIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M3 6h14l-1 11H4z" />
      <path d="M7 6V4a3 3 0 0 1 6 0v2" />
      <path d="M8 11h4" strokeLinecap="round" />
    </svg>
  );
}

function ContractorsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <circle cx="7" cy="6" r="2.5" />
      <path d="M2 16c0-2.5 2-4.5 5-4.5s5 2 5 4.5" strokeLinecap="round" />
      <circle cx="14" cy="7" r="2" />
      <path d="M18 16c0-2 -1.5-3.5-4-3.5" strokeLinecap="round" />
    </svg>
  );
}

function ToolsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M14.5 3.5a2.5 2.5 0 00-3.54 0L9.5 5l5 5 1.46-1.46a2.5 2.5 0 000-3.54l-1.46-1.5z" />
      <path d="M9.5 5L3 11.5V15h3.5L13 8.5" />
      <path d="M7.5 12.5L5 15" />
    </svg>
  );
}

function CameraIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="2" y="5.5" width="11" height="9" rx="2" />
      <path d="M13 9.5l5-2.5v6l-5-2.5" strokeLinejoin="round" />
    </svg>
  );
}

function GraphicsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M12 2l6 6-10 10H2v-6L12 2z" strokeLinejoin="round" />
      <path d="M10 4l6 6" />
      <path d="M2 18l4-4" strokeLinecap="round" />
    </svg>
  );
}

function MailerIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="2" y="4" width="16" height="12" rx="2" />
      <path d="M2 6l8 5 8-5" strokeLinejoin="round" />
    </svg>
  );
}

function WorkflowsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
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
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="6" width="14" height="10" rx="2" />
      <path d="M7 6V4.5a1 1 0 011-1h4a1 1 0 011 1V6" strokeLinecap="round" />
      <path d="M3 10h14" strokeLinecap="round" />
    </svg>
  );
}

function AdminIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" />
    </svg>
  );
}

function AppsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function ContractorModeIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M3 16v-1a4 4 0 014-4h2a4 4 0 014 4v1" strokeLinecap="round" />
      <circle cx="8" cy="6" r="2.5" />
      <path d="M14.5 8.5l1.2 1.2 2.3-2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ViewAsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10z" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

function ProductionModeIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="2.5" y="7" width="15" height="10" rx="1.5" />
      <path d="M2.8 7l2.4-3.2 3.2 2.4M8 6.2l3.2-2.9 3 2.6M13.8 5.9l3-2.7" strokeLinejoin="round" />
    </svg>
  );
}

function WorkModeIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="3" y="6.5" width="14" height="9.5" rx="1.5" />
      <path d="M7.5 6.5V5.5a1.5 1.5 0 011.5-1.5h2a1.5 1.5 0 011.5 1.5v1M3 10.5h14" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronToggleIcon({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#6b7280" strokeWidth="1.5"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PreProductionIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M4 3h9l3 3v11a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <path d="M13 3v3h3" />
      <path d="M6.5 10h7M6.5 13h5" strokeLinecap="round" />
    </svg>
  );
}

function FilmingIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="2" y="6" width="12" height="8" rx="1.5" />
      <path d="M14 9l4-2.5v7L14 11" />
    </svg>
  );
}

function WhiteboardIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M10 13.5v3M7.5 16.5h5" strokeLinecap="round" />
      <path d="M5.5 10.5l2-3 2 2 1.5-2 2.5 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PostProductionIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <rect x="2" y="4" width="16" height="12" rx="1.5" />
      <path d="M2 8h16M2 12h16" />
      <path d="M6 4v12M14 4v12" />
    </svg>
  );
}

function CoreTeamIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <circle cx="7" cy="8" r="3" />
      <circle cx="14" cy="8" r="2.4" />
      <path d="M2 17c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" strokeLinecap="round" />
      <path d="M12.5 17c0-2 1.5-3.5 3.5-3.5S19.5 15 19.5 17" strokeLinecap="round" />
    </svg>
  );
}

function HoursIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProfileIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.5 17c0-3 2.9-5.5 6.5-5.5s6.5 2.5 6.5 5.5" strokeLinecap="round" />
    </svg>
  );
}

function NotificationsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M15 8a5 5 0 00-10 0c0 5.5-2.5 7.5-2.5 7.5h15S15 13.5 15 8z" strokeLinejoin="round" />
      <path d="M11.5 18a1.7 1.7 0 01-3 0" strokeLinecap="round" />
    </svg>
  );
}

function DocumentsIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M6 2h5l5 5v9a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" strokeLinejoin="round" />
      <path d="M11 2v5h5" strokeLinejoin="round" />
      <path d="M7 12h6M7 15h4" strokeLinecap="round" />
    </svg>
  );
}

function ToolsFolderIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
      <path d="M12.7 5.3a3.5 3.5 0 014.6-.9l-2.5 2.5.8 1.5 1.5.8 2.5-2.5a3.5 3.5 0 01-5.2 4.3l-6.6 6.6a1.6 1.6 0 01-2.3-2.3l6.6-6.6a3.5 3.5 0 01.6-3.4z" strokeLinejoin="round" transform="scale(0.82) translate(1.5 1.5)" />
    </svg>
  );
}

function BetaFolderIcon({ active }) {
  // Lab flask — marks the Beta folder of pages still under refinement.
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={active ? '#8fb4d8' : '#6b7280'} strokeWidth="1.5">
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
    background: colors.bg,
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
  logoStack: {
    display: 'flex',
    flexDirection: 'column',
  },
  logoSuiteMark: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    color: colors.textDim,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    lineHeight: 1.4,
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
    background: colors.accentA12,
    color: colors.accentFg,
  },
  viewAsMenu: {
    position: 'absolute',
    bottom: 'calc(100% + 6px)',
    left: 0,
    minWidth: 200,
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
    padding: 6,
    zIndex: 50,
  },
  viewAsMenuHeader: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
    padding: '6px 10px 4px',
  },
  viewAsMenuItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: 6,
    padding: '8px 10px',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontFamily: 'DM Sans, sans-serif',
    cursor: 'pointer',
  },
  viewAsBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 16px',
    marginBottom: 16,
    background: 'rgba(236,72,153,0.12)',
    border: '1px solid rgba(236,72,153,0.3)',
    borderRadius: 8,
  },
  viewAsExitBtn: {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 6,
    padding: '6px 14px',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    flexShrink: 0,
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
  settingsBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: 'calc(100% - 24px)',
    margin: '0 12px 4px',
    padding: '10px 12px',
    border: 'none',
    borderRadius: '10px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.55)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  settingsBtnIcon: {
    fontSize: '16px',
    lineHeight: 1,
    width: '18px',
    textAlign: 'center',
    flexShrink: 0,
  },
  avatar: {
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
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
    background: colors.bg,
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
    background: colors.bgHover,
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
    background: colors.accentA10,
    border: '1px solid rgba(91, 143, 199,0.25)',
    borderRadius: '6px',
    color: colors.accentFg,
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
    background: colors.accent,
    flexShrink: 0,
    marginTop: '4px',
  },
};
