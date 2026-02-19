import React from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AuthPage from './pages/AuthPage';
import AppLayout from './pages/AppLayout';

function AppContent() {
  const { user, profile, loading, signOut } = useAuth();

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

  return user && profile ? <AppLayout /> : <AuthPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
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
`;
document.head.appendChild(styleSheet);
