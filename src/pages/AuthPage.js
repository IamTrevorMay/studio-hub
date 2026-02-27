import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';

export default function AuthPage() {
  const { signIn, isPasswordRecovery, clearRecovery } = useAuth();
  const [mode, setMode] = useState('login'); // login, setup, forgot, reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  // Check if user arrived via an invite magic link or password reset
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && (hash.includes('type=invite') || hash.includes('type=signup') || hash.includes('type=magiclink'))) {
      setMode('setup');
    }
    if (hash && hash.includes('type=recovery')) {
      setMode('reset');
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('reset');
      } else if (event === 'SIGNED_IN' && session?.user && !session.user.user_metadata?.full_name) {
        // Only go to setup if NOT in recovery mode
        if (!isPasswordRecovery) {
          setMode('setup');
          setEmail(session.user.email || '');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [isPasswordRecovery]);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!fullName.trim()) throw new Error('Please enter your full name.');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');

      // Update the user's password (they arrived via magic link)
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { full_name: fullName.trim() },
      });
      if (updateError) throw updateError;

      // Update their profile
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').upsert({
          id: user.id,
          email: user.email,
          full_name: fullName.trim(),
          role: 'member',
          updated_at: new Date().toISOString(),
        });

        // Mark invitation as accepted
        await supabase.from('invitations')
          .update({ accepted_at: new Date().toISOString() })
          .eq('email', user.email.toLowerCase());
      }

      setSuccess('Account set up! Redirecting...');
      // Force a page reload to pick up the new session + profile
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      if (!email.trim()) throw new Error('Please enter your email address.');
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setSuccess('Password reset email sent! Check your inbox.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess('Password updated! Redirecting to login...');
      // Sign out so they log in fresh with new password
      await supabase.auth.signOut();
      clearRecovery();
      setTimeout(() => {
        window.location.hash = '';
        window.location.reload();
      }, 1500);
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
          <h1 style={styles.title}>Mayday Media</h1>
          <p style={styles.titleSub}>Creative</p>
          <p style={styles.subtitle}>
            {mode === 'setup' ? 'Set up your account to get started'
              : mode === 'forgot' ? 'Enter your email to reset your password'
              : mode === 'reset' ? 'Choose a new password'
              : 'Sign in to your workspace'}
          </p>
        </div>

        {mode === 'login' && (
          <>
            <form onSubmit={handleLogin} style={styles.form}>
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
              <button type="submit" disabled={loading} style={styles.button}>
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
            <p style={styles.forgotLink} onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}>
              Forgot password?
            </p>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <form onSubmit={handleForgotPassword} style={styles.form}>
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
              {error && <div style={styles.error}>{error}</div>}
              {success && <div style={styles.success}>{success}</div>}
              <button type="submit" disabled={loading} style={styles.button}>
                {loading ? 'Sending...' : 'Send Reset Email'}
              </button>
            </form>
            <p style={styles.forgotLink} onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>
              ← Back to sign in
            </p>
          </>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleResetPassword} style={styles.form}>
            <div style={styles.setupBanner}>
              🔒 Choose your new password
            </div>
            <div style={styles.field}>
              <label style={styles.label}>New Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
                style={styles.input}
              />
            </div>
            {error && <div style={styles.error}>{error}</div>}
            {success && <div style={styles.success}>{success}</div>}
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}

        {mode === 'setup' && (
          <form onSubmit={handleSetup} style={styles.form}>
            <div style={styles.setupBanner}>
              🎉 You've been invited! Set up your account below.
            </div>
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
              <label style={styles.label}>Create Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
                style={styles.input}
              />
            </div>
            {error && <div style={styles.error}>{error}</div>}
            {success && <div style={styles.success}>{success}</div>}
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? 'Setting up...' : 'Complete Setup'}
            </button>
          </form>
        )}

        {mode === 'login' && (
          <p style={styles.note}>
            Need access? Ask your team admin for an invite.
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
    margin: '0',
    letterSpacing: '-0.5px',
    lineHeight: 1.2,
  },
  titleSub: {
    fontSize: '16px',
    fontWeight: 500,
    color: 'rgba(255,255,255,0.45)',
    margin: '0 0 8px 0',
    letterSpacing: '0.5px',
  },
  subtitle: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
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
  setupBanner: {
    padding: '12px 16px',
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: '10px',
    color: '#a5b4fc',
    fontSize: '14px',
    textAlign: 'center',
    fontWeight: 500,
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
  forgotLink: {
    textAlign: 'center',
    fontSize: '13px',
    color: '#a5b4fc',
    marginTop: '14px',
    cursor: 'pointer',
  },
};
