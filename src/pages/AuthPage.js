import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password, fullName, inviteToken);
        setSuccess('Account created! Check your email to confirm, then sign in.');
        setIsLogin(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.bg} />
      <div style={styles.card}>
        <div style={styles.logoSection}>
          <div style={styles.logoIcon}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="2" y="6" width="12" height="8" rx="2" fill="#6366f1" />
              <rect x="18" y="6" width="12" height="8" rx="2" fill="#818cf8" />
              <rect x="2" y="18" width="12" height="8" rx="2" fill="#818cf8" />
              <rect x="18" y="18" width="12" height="8" rx="2" fill="#6366f1" />
            </svg>
          </div>
          <h1 style={styles.title}>Studio Hub</h1>
          <p style={styles.subtitle}>Your team's creative command center</p>
        </div>

        <div style={styles.tabRow}>
          <button
            onClick={() => { setIsLogin(true); setError(''); }}
            style={{
              ...styles.tab,
              ...(isLogin ? styles.tabActive : {}),
            }}
          >
            Sign In
          </button>
          <button
            onClick={() => { setIsLogin(false); setError(''); }}
            style={{
              ...styles.tab,
              ...(!isLogin ? styles.tabActive : {}),
            }}
          >
            Join Team
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {!isLogin && (
            <>
              <div style={styles.field}>
                <label style={styles.label}>Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Invite Token</label>
                <input
                  type="text"
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  placeholder="Paste your invitation token"
                  required
                  style={styles.input}
                />
              </div>
            </>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              style={styles.input}
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}
          {success && <div style={styles.success}>{success}</div>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {!isLogin && (
          <p style={styles.note}>
            You need an invitation from your team admin to join.
          </p>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  bg: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)',
    zIndex: 0,
  },
  card: {
    position: 'relative',
    zIndex: 1,
    background: 'rgba(255,255,255,0.03)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '20px',
    padding: '48px 40px',
    width: '100%',
    maxWidth: '420px',
    boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
  },
  logoSection: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  logoIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    borderRadius: '14px',
    background: 'rgba(99,102,241,0.15)',
    marginBottom: '16px',
  },
  title: {
    fontSize: '26px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 6px 0',
    letterSpacing: '-0.5px',
  },
  subtitle: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.45)',
    margin: 0,
  },
  tabRow: {
    display: 'flex',
    gap: '4px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '10px',
    padding: '4px',
    marginBottom: '28px',
  },
  tab: {
    flex: 1,
    padding: '10px',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  tabActive: {
    background: 'rgba(99,102,241,0.2)',
    color: '#a5b4fc',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    padding: '12px 14px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit',
  },
  button: {
    padding: '14px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '4px',
    transition: 'opacity 0.2s',
    fontFamily: 'inherit',
  },
  error: {
    padding: '10px 14px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: '8px',
    color: '#fca5a5',
    fontSize: '13px',
  },
  success: {
    padding: '10px 14px',
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.2)',
    borderRadius: '8px',
    color: '#86efac',
    fontSize: '13px',
  },
  note: {
    textAlign: 'center',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    marginTop: '16px',
  },
};
