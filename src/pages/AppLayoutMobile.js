import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { logUploadError } from '../lib/uploadErrors';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
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
import BusinessDev from './BusinessDevMobile';
import Invoicing from './InvoicingMobile';
import Production from './ProductionMobile';
import FreelancerDashboard from './FreelancerDashboardMobile';
import Deliverables from './DeliverablesMobile';
import Ideas from './IdeasMobile';
import Workflows from './WorkflowsMobile';
import Freelancers from './FreelancersMobile';
import Ops from './OpsMobile';
import Analytics from './AnalyticsMobile';
import Tracking from './TrackingMobile';
import AgencyPortal from './AgencyPortal';
// Goals page is sunset on desktop; mobile mirrors that — import + nav
// entry + route case removed. Re-add when goals comes back, if ever.

// Same NAV_ITEMS source-of-truth as desktop. Kept in sync intentionally — desktop
// AppLayout owns the canonical list; this is a slimmed mirror used to feed the
// drawer's resolved nav (which gets filtered by filterNavForMobile).
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'write', label: 'Write' },
  { key: 'production', label: 'Beat Sheet' },
  { key: 'teleprompter', label: 'Teleprompter' },
  { key: 'broadcast', label: 'Broadcast', external: { url: 'https://www.tritonapex.io/broadcast' } },
  { key: 'telestration', label: 'Telestrator' },
  { key: 'post_show', label: 'Clipping Tool' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'organize', label: 'Organize' },
  { key: 'projects', label: 'Projects' },
  { key: 'resources', label: 'Resources' },
  { key: 'analytics', label: 'Analytics', adminOnly: true },
  { key: 'tracking', label: 'Tracking', adminOnly: true },
  { key: 'workflows', label: 'Workflows', adminOnly: true },
  { key: 'freelancers', label: 'Contractors', adminOnly: true },
  { key: 'research', label: 'News' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'business_dev', label: 'Roadmap', adminOnly: true },
  { key: 'invoicing', label: 'Invoicing' },
  { key: 'ops', label: 'Ops', adminOnly: true },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'ideas', label: 'Ideas' },
  { key: 'channels', label: 'Channels' },
  { key: 'messages', label: 'Messages' },
];

const VALID_TAB_KEYS = new Set(NAV_ITEMS.map((i) => i.key).concat('admin', 'ops', 'fl_dashboard', 'fl_hours', 'fl_profile', 'fl_notifications', 'fl_assignments', 'fl_submit'));

// Admin Mode (mirrors desktop AppLayout pattern). Mode flips the drawer
// between an everyday "Work View" and an admin-focused list. Mobile
// only surfaces admin pages that have a *Mobile build today — the
// other desktop admin pages (payroll/accounting/jobs) get omitted
// entirely instead of stubbed.
//
// Keep this list in sync as new *Mobile pages ship.
const MOBILE_ADMIN_PAGE_KEYS = ['workflows', 'freelancers', 'ops', 'analytics', 'tracking', 'business_dev', 'invoicing'];
// Full desktop admin-only set so Work View can hide every key that's
// considered admin, even ones without a mobile build (so a non-mobile
// admin page never sneaks into the Work drawer via NAV_ITEMS).
const DESKTOP_ADMIN_PAGE_KEYS = new Set([
  'payroll', 'analytics', 'tracking', 'accounting', 'business_dev',
  'freelancers', 'workflows', 'jobs', 'invoicing', 'ops',
]);
const ADMIN_ESSENTIAL_KEYS = new Set(['dashboard', 'projects', 'calendar', 'deliverables']);
const ADMIN_ESSENTIAL_FOLDER_IDS = new Set(['pre_production']);

// Folders fully removed from the mobile left nav (both Work and Admin modes).
// Drops the folder header AND any items nested under it.
const MOBILE_EXCLUDED_FOLDER_IDS = new Set(['filming', 'post_production']);
function stripExcludedFolders(nav) {
  return nav.filter((entry) => {
    if (entry.type === 'folder') return !MOBILE_EXCLUDED_FOLDER_IDS.has(entry.id);
    if (entry.type === 'item' && entry.folderId) return !MOBILE_EXCLUDED_FOLDER_IDS.has(entry.folderId);
    return true;
  });
}

// Build the Admin View nav list from resolved nav + hardcoded admin pages.
// Essential items/folders pulled from resolvedNav, then admin pages appended.
function buildAdminModeNav(resolvedNav) {
  const top = [];
  for (const entry of resolvedNav) {
    if (entry.type === 'item' && ADMIN_ESSENTIAL_KEYS.has(entry.key)) {
      top.push(entry);
    } else if (entry.type === 'folder' && ADMIN_ESSENTIAL_FOLDER_IDS.has(entry.id)) {
      top.push(entry);
    } else if (entry.type === 'item' && entry.folderId && ADMIN_ESSENTIAL_FOLDER_IDS.has(entry.folderId)) {
      top.push(entry);
    }
  }
  for (const key of MOBILE_ADMIN_PAGE_KEYS) {
    // Skip desktop-only pages (they route to DesktopOnlyScreen) — no point
    // surfacing a tab whose only content is "use desktop instead".
    if (isExcludedOnMobile(key)) continue;
    const item = NAV_ITEMS.find((i) => i.key === key);
    if (item) top.push({ type: 'item', key: item.key, label: item.label });
  }
  top.push({ type: 'item', key: 'admin', label: 'Admin Settings' });
  return top;
}

function getAdminModeKeySet(resolvedNav) {
  const keys = new Set([
    ...ADMIN_ESSENTIAL_KEYS,
    ...MOBILE_ADMIN_PAGE_KEYS.filter((k) => !isExcludedOnMobile(k)),
    'admin',
  ]);
  for (const entry of resolvedNav) {
    if (entry.type === 'item' && entry.folderId && ADMIN_ESSENTIAL_FOLDER_IDS.has(entry.folderId)) {
      keys.add(entry.key);
    }
  }
  return keys;
}

function getTabFromPath() {
  const path = window.location.pathname.replace(/^\/+/, '').split('/')[0];
  if (path && VALID_TAB_KEYS.has(path)) return path;
  return null;
}

function getSubPathFromURL() {
  const segments = window.location.pathname.replace(/^\/+/, '').split('/');
  return segments[1] || null;
}

const TAB_LABELS = NAV_ITEMS.reduce((acc, item) => { acc[item.key] = item.label; return acc; }, {
  admin: 'Admin',
  fl_dashboard: 'Dashboard',
  fl_hours: 'Hours',
  fl_profile: 'Profile',
  fl_notifications: 'Notifications',
  fl_assignments: 'Assignments',
  fl_submit: 'Submit',
});

export default function AppLayoutMobile() {
  const { profile, signOut, isAdmin, isAssistant, isPartner, isAgency, isFreelancer, restrictedNavKeys } = useAuth();
  const { unreadNotificationCount, markDashboardSeen, refreshNotifications } = useNotifications();
  const { getResolvedNav } = useNavConfig();
  const [activeTab, setActiveTab] = useState(() => getTabFromPath() || localStorage.getItem('studio-hub-tab') || 'dashboard');
  // Mode mirrors desktop's localStorage key. Non-admins are pinned to
  // 'work' below (admins still see whichever mode they last used).
  const [mode, setMode] = useState(() => localStorage.getItem('studio-hub-mode') === 'admin' ? 'admin' : 'work');
  const [navTarget, setNavTarget] = useState(() => getSubPathFromURL());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const mainRef = React.useRef(null);

  // Persist active tab + URL, reset scroll on change
  useEffect(() => {
    localStorage.setItem('studio-hub-tab', activeTab);
    const segments = window.location.pathname.replace(/^\/+/, '').split('/');
    if (segments[0] !== activeTab) {
      window.history.pushState({}, '', '/' + activeTab);
    }
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [activeTab]);

  useEffect(() => {
    function handlePopState() {
      const tab = getTabFromPath();
      if (tab) setActiveTab(tab);
      setNavTarget(getSubPathFromURL());
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Freelancer redirect (mirror desktop AppLayout)
  useEffect(() => {
    if (isFreelancer && !activeTab.startsWith('fl_') && activeTab !== 'resources' && activeTab !== 'assets' && activeTab !== 'channels' && activeTab !== 'messages') {
      setActiveTab('fl_dashboard');
    }
  }, [isFreelancer]); // eslint-disable-line

  // Restricted-nav route guard (mirror desktop AppLayout). Without this, a role
  // whose nav keys are restricted (e.g. director_creative/director_comms, who are
  // admin-tier so isAdmin is true) could still open a restricted page directly.
  useEffect(() => {
    if (restrictedNavKeys?.has(activeTab)) {
      setActiveTab(isFreelancer ? 'fl_dashboard' : 'dashboard');
    }
    // eslint-disable-next-line
  }, [activeTab, restrictedNavKeys, isFreelancer]);

  // Pin non-admins to Work View; persist mode across reloads.
  useEffect(() => { if (!isAdmin && mode !== 'work') setMode('work'); }, [isAdmin, mode]);
  useEffect(() => { localStorage.setItem('studio-hub-mode', mode); }, [mode]);

  const resolvedNav = stripExcludedFolders(
    getResolvedNav(NAV_ITEMS, isAdmin, isPartner, isFreelancer, profile, restrictedNavKeys)
  );
  const adminModeKeySet = getAdminModeKeySet(resolvedNav);

  // When the user flips to a mode their current tab doesn't belong to,
  // bounce them somewhere sensible. Dashboard is the safe admin landing —
  // it has a mobile build and lives in every admin keyset.
  useEffect(() => {
    if (mode === 'admin' && isAdmin) {
      if (!adminModeKeySet.has(activeTab)) setActiveTab('dashboard');
    } else if (DESKTOP_ADMIN_PAGE_KEYS.has(activeTab)) {
      setActiveTab('dashboard');
    }
    // eslint-disable-next-line
  }, [mode, isAdmin]);

  // Work View strips every desktop-admin key so admin-only pages are
  // siloed into Admin View. Admin View builds its own short list.
  const baseNav = filterNavForMobile(resolvedNav);
  const mobileNav = (mode === 'admin' && isAdmin)
    ? buildAdminModeNav(resolvedNav)
    : baseNav.filter((e) => !(e.type === 'item' && DESKTOP_ADMIN_PAGE_KEYS.has(e.key)));

  function toggleMode() {
    // Keep the drawer open on mode flip — user is still navigating the nav.
    setMode((m) => (m === 'admin' ? 'work' : 'admin'));
  }

  function navigateTo(tab, target) {
    setNavTarget(target || null);
    setActiveTab(tab);
  }

  function handleSelectTab(key) {
    if (key === 'fl_assignments' && profile?.assigned_drive_folder_id) {
      window.open(`https://drive.google.com/drive/folders/${profile.assigned_drive_folder_id}`, '_blank', 'noopener');
      return;
    }
    if (key === 'fl_submit') {
      setShowSubmitModal(true);
      return;
    }
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

  // Agency accounts get the locked, chrome-free portal (mirror desktop).
  if (isAgency) {
    return <AgencyPortal />;
  }

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
        mode={mode}
        onToggleMode={toggleMode}
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

      {showSubmitModal && (
        <SubmitModalMobile onClose={() => setShowSubmitModal(false)} />
      )}
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

  // Role gating mirrors desktop AppLayout. adminOnly pages reachable via direct
  // URL / persisted tab must be gated here too, or a non-admin renders them.
  if (activeTab === 'admin' && !isAdmin) return null;
  if (activeTab === 'business_dev' && !(isAdmin || isPartner)) return null;
  if (activeTab === 'invoicing' && !isAdmin) return null;
  if (activeTab === 'workflows' && !isAdmin) return null;
  if (activeTab === 'freelancers' && !isAdmin) return null;
  if (activeTab === 'ops' && !isAdmin) return null;
  if (activeTab === 'analytics' && !isAdmin) return null;
  if (activeTab === 'tracking' && !isAdmin) return null;

  switch (activeTab) {
    case 'dashboard': return <Dashboard onNavigate={navigateTo} />;
    case 'projects': return <Projects onNavigate={navigateTo} />;
    case 'calendar': return <Calendar onNavigate={navigateTo} />;
    case 'production': return <Production initialSheetId={navTarget} onSheetOpened={() => setNavTarget(null)} />;
    case 'ideation': return <Ideation initialConceptId={navTarget} onConceptOpened={() => setNavTarget(null)} />;
    case 'resources': return <Resources />;
    case 'research': return <Research />;
    case 'business_dev': return <BusinessDev />;
    case 'invoicing': return <Invoicing />;
    case 'deliverables': return <Deliverables />;
    case 'ideas': return <Ideas />;
    case 'workflows': return <Workflows />;
    case 'freelancers': return <Freelancers />;
    case 'ops': return <Ops />;
    case 'analytics': return <Analytics />;
    case 'tracking': return <Tracking />;
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

// --- Submit Modal (mobile) ---
const SUBMISSIONS_FOLDER_ID = '1r1dENUCjNSs57MjidYbE2rWrbMKXpLM0';

function SubmitModalMobile({ onClose }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
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

  return (
    <div style={submitStyles.overlay} onClick={onClose}>
      <div style={submitStyles.modal} onClick={e => e.stopPropagation()}>
        <div style={submitStyles.header}>
          <span style={submitStyles.title}>Submit Deliverable</span>
          <button onClick={onClose} style={submitStyles.closeBtn}>&times;</button>
        </div>

        <div style={submitStyles.dropZone}>
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
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Select a file to upload</span>
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
    background: '#1a1a2e', borderRadius: 14, padding: 20, width: '90vw', maxWidth: 400,
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
    border: '2px dashed rgba(255,255,255,0.15)', borderRadius: 10, padding: '28px 16px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 100, background: 'rgba(255,255,255,0.02)',
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

const styles = {
  layout: {
    display: 'flex',
    flexDirection: 'column',
    // Fixed-height shell so <main> is the sole scroll container (sticky top
    // bar stays put, content scrolls beneath it). minHeight is a fallback for
    // browsers without dvh; the topbar is flex:0 so it always reserves its row.
    height: '100dvh',
    minHeight: '100vh',
    overflow: 'hidden',
    background: '#0f0f1a',
    color: '#e2e8f0',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: mobileTokens.font.base,
  },
  main: {
    flex: 1,
    minHeight: 0, // allow the flex child to shrink so it scrolls instead of the document
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
