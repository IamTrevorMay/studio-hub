import React, { Suspense } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PresenceProvider } from './contexts/PresenceContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { isMobileViewport, MOBILE_BREAKPOINT_PX } from './hooks/useIsMobile';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { ToastProvider } from './contexts/ToastContext';
import { useUsageTracking } from './hooks/useUsageTracking'; // TEMP: front-end usage study, remove after 2026-07-07
import { focusRing } from './lib/styleTokens';

// Pick the layout + auth chunks once at boot. Cross-breakpoint resize requires reload.
// Reload when the viewport crosses the mobile breakpoint after boot
const _initialMobile = isMobileViewport();
if (typeof window !== 'undefined') {
  const _mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
  const _handler = (e) => { if (e.matches !== _initialMobile) window.location.reload(); };
  if (_mq.addEventListener) _mq.addEventListener('change', _handler);
  else _mq.addListener(_handler);
}

const Layout = isMobileViewport()
  ? React.lazy(() => import('./pages/AppLayoutMobile'))
  : React.lazy(() => import('./pages/AppLayout'));
const AuthPage = isMobileViewport()
  ? React.lazy(() => import('./pages/AuthPageMobile'))
  : React.lazy(() => import('./pages/AuthPage'));

function AppContent() {
  const { user, profile, loading, signOut, isPasswordRecovery, isInviteSetup } = useAuth();

  useUsageTracking(user, profile); // TEMP: front-end usage study, no-op outside production

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.loadingInner}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Loading...</p>
        </div>
      </div>
    );
  }

  // User is logged in but profile failed to load — offer sign out
  if (user && !profile) {
    return (
      <div style={styles.loading}>
        <div style={styles.loadingInner}>
          <p style={styles.errorText}>Having trouble loading your profile.</p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button onClick={() => window.location.reload()} style={styles.retryBtn}>
              Retry
            </button>
            <button onClick={async () => { await signOut(); window.location.reload(); }} style={{ ...styles.retryBtn, background: 'rgba(255,255,255,0.1)' }}>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // During password recovery or invite setup, always show AuthPage
  if (isPasswordRecovery || isInviteSetup) {
    return (
      <Suspense fallback={<LayoutFallback />}>
        <AuthPage />
      </Suspense>
    );
  }

  if (!(user && profile)) {
    return (
      <Suspense fallback={<LayoutFallback />}>
        <AuthPage />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LayoutFallback />}>
      <Layout />
    </Suspense>
  );
}

function LayoutFallback() {
  return (
    <div style={styles.loading}>
      <div style={styles.loadingInner}>
        <div style={styles.spinner} />
      </div>
    </div>
  );
}

// Public careers board — served before the auth gate so visitors never log in.
const PublicCareers = React.lazy(() => import('./pages/public/PublicCareers'));
const PublicBrief = React.lazy(() => import('./pages/public/PublicBrief'));
const PublicDeliverables = React.lazy(() => import('./pages/public/PublicDeliverables'));
function isCareersPath() {
  return /^\/careers(\/|$)/.test(window.location.pathname);
}
function isBriefPath() {
  return /^\/brief\/[^/]+/.test(window.location.pathname);
}
function isDeliverablesPath() {
  return /^\/deliverables(\/|$)/.test(window.location.pathname);
}

export default function App() {
  if (isCareersPath()) {
    return (
      <Suspense fallback={<LayoutFallback />}>
        <PublicCareers />
      </Suspense>
    );
  }
  if (isBriefPath()) {
    return (
      <Suspense fallback={<LayoutFallback />}>
        <PublicBrief />
      </Suspense>
    );
  }
  if (isDeliverablesPath()) {
    return (
      <Suspense fallback={<LayoutFallback />}>
        <PublicDeliverables />
      </Suspense>
    );
  }
  return (
    <AuthProvider>
      <PresenceProvider>
        <NotificationProvider>
          <ConfirmProvider>
            <ToastProvider>
              <AppContent />
            </ToastProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </PresenceProvider>
    </AuthProvider>
  );
}

const styles = {
  loading: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f0f1a',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  loadingInner: {
    textAlign: 'center',
  },
  spinner: {
    width: '36px',
    height: '36px',
    border: '3px solid rgba(99,102,241,0.2)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto 16px',
  },
  loadingText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: '14px',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: '14px',
    marginBottom: '16px',
  },
  retryBtn: {
    padding: '10px 24px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
};

// Add spinner animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; background: #0f0f1a; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
  select option { background: #1a1a2e; color: #fff; }
  input::placeholder { color: rgba(255,255,255,0.25); }
  input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
  /* Keyboard focus visibility (a11y). !important overrides the many inline
     outline:'none' declarations. :focus-visible => keyboard nav only, so
     mouse clicks stay ring-free. */
  *:focus-visible { outline: ${focusRing.outline} !important; outline-offset: ${focusRing.offset} !important; }
  *:focus:not(:focus-visible) { outline: none; }
`;
document.head.appendChild(styleSheet);
