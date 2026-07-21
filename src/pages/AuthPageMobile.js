import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import { mobileTokens } from '../utils/mobileTokens';
import { colors } from '../lib/styleTokens';

export default function AuthPageMobile() {
  const { signIn, isPasswordRecovery, clearRecovery, isInviteSetup } = useAuth();
  const [mode, setMode] = useState(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('type=recovery')) return 'reset';
    if (hash && (hash.includes('type=invite') || hash.includes('type=signup') || hash.includes('type=magiclink'))) return 'setup';
    return 'login';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (isInviteSetup && mode === 'login') {
      setMode('setup');
    }
  }, [isInviteSetup, mode]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('reset');
      } else if (event === 'SIGNED_IN' && session?.user && !session.user.user_metadata?.full_name) {
        if (!isPasswordRecovery && !isInviteSetup) {
          setMode('setup');
          setEmail(session.user.email || '');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [isPasswordRecovery, isInviteSetup]);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleSetup(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!fullName.trim()) throw new Error('Please enter your full name.');
      if (!nickname.trim()) throw new Error('Please enter the nickname you go by.');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');

      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { full_name: fullName.trim(), nickname: nickname.trim() },
      });
      if (updateError) throw updateError;

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: invitation } = await supabase.from('invitations')
          .select('role, title, payment_type, rate, contract_storage_path, contract_file_name, invited_by, assigned_drive_folder_id, assigned_drive_folder_name')
          .eq('email', user.email.toLowerCase())
          .is('accepted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const assignedRole = invitation?.role || 'member';

        // Admin-controlled fields (role, title, drive folders) are set server-side
        // by handle_new_user from invite metadata — only set user-editable fields here.
        const { error: profileError } = await supabase.from('profiles')
          .update({
            full_name: fullName.trim(),
            nickname: nickname.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);
        if (profileError) throw profileError;

        if (assignedRole === 'freelancer') {
          await supabase.from('freelancer_profiles').upsert({
            id: user.id,
            payment_type: invitation?.payment_type || null,
            rate: invitation?.rate != null ? Number(invitation.rate) : null,
          });

          // If a contract was uploaded at invite time, move it to the user's folder
          if (invitation?.contract_storage_path && invitation?.contract_file_name) {
            try {
              const { data: fileData } = await supabase.storage
                .from('freelancer-documents')
                .download(invitation.contract_storage_path);
              if (fileData) {
                const newPath = `${user.id}/${invitation.contract_file_name}`;
                await supabase.storage
                  .from('freelancer-documents')
                  .upload(newPath, fileData, { upsert: true });
                await supabase.from('freelancer_documents').insert({
                  freelancer_id: user.id,
                  uploaded_by: invitation.invited_by,
                  title: 'Contract',
                  doc_type: 'signing',
                  storage_path: newPath,
                  file_name: invitation.contract_file_name,
                });
                await supabase.storage
                  .from('freelancer-documents')
                  .remove([invitation.contract_storage_path]);
              }
            } catch (contractErr) {
              console.error('Failed to move contract:', contractErr);
            }
          }
        }

        await supabase.from('invitations')
          .update({ accepted_at: new Date().toISOString() })
          .eq('email', user.email.toLowerCase());
      }

      setSuccess('Account set up! Redirecting...');
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);
    try {
      if (!email.trim()) throw new Error('Please enter your email address.');
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setSuccess('Password reset email sent! Check your inbox.');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);
    try {
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess('Password updated! Redirecting to login...');
      await supabase.auth.signOut();
      clearRecovery();
      setTimeout(() => { window.location.hash = ''; window.location.reload(); }, 1500);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  const subtitle =
    mode === 'setup' ? 'Set up your account to get started'
    : mode === 'forgot' ? 'Enter your email to reset your password'
    : mode === 'reset' ? 'Choose a new password'
    : 'Sign in to your workspace';

  return (
    <div style={styles.container}>
      <div style={styles.bg} />
      <div style={{ ...styles.scroll, paddingTop: `calc(${mobileTokens.space.xxl}px + ${mobileTokens.safeTop})`, paddingBottom: `calc(${mobileTokens.space.xxl}px + ${mobileTokens.safeBottom})` }}>
        <div style={styles.logoSection}>
          <div style={styles.logoIcon}>
            <img src="/logo.png" alt="Mayday Studio" width="36" height="36" />
          </div>
          <h1 style={styles.title}>Mayday Studio</h1>
          <p style={styles.titleSub}>by Mayday Media</p>
          <p style={styles.subtitle}>{subtitle}</p>
        </div>

        {mode === 'login' && (
          <>
            <form onSubmit={handleLogin} style={styles.form}>
              <Field label="Email">
                <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required style={styles.input} />
              </Field>
              <Field label="Password">
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} style={styles.input} />
              </Field>
              {error && <div style={styles.error}>{error}</div>}
              <button type="submit" disabled={loading} style={styles.button}>
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
            <button type="button" style={styles.linkBtn} onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}>
              Forgot password?
            </button>
            <p style={styles.note}>Need access? Ask your team admin for an invite.</p>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <form onSubmit={handleForgotPassword} style={styles.form}>
              <Field label="Email">
                <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required style={styles.input} />
              </Field>
              {error && <div style={styles.error}>{error}</div>}
              {success && <div style={styles.success}>{success}</div>}
              <button type="submit" disabled={loading} style={styles.button}>
                {loading ? 'Sending...' : 'Send Reset Email'}
              </button>
            </form>
            <button type="button" style={styles.linkBtn} onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>
              ← Back to sign in
            </button>
          </>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleResetPassword} style={styles.form}>
            <div style={styles.banner}>🔒 Choose your new password</div>
            <Field label="New password">
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" required minLength={6} style={styles.input} />
            </Field>
            {error && <div style={styles.error}>{error}</div>}
            {success && <div style={styles.success}>{success}</div>}
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}

        {mode === 'setup' && (
          <form onSubmit={handleSetup} style={styles.form}>
            <div style={styles.banner}>🎉 You've been invited! Set up your account below.</div>
            <Field label="Full name">
              <input type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Smith" required style={styles.input} />
            </Field>
            <Field label="Nickname">
              <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="What should the team call you?" required style={styles.input} />
            </Field>
            <Field label="Create password">
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" required minLength={6} style={styles.input} />
            </Field>
            {error && <div style={styles.error}>{error}</div>}
            {success && <div style={styles.success}>{success}</div>}
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? 'Setting up...' : 'Complete Setup'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  );
}

const INPUT_HEIGHT = mobileTokens.tap;

const styles = {
  container: {
    minHeight: '100vh',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    color: '#fff',
  },
  bg: {
    position: 'fixed',
    inset: 0,
    background: 'linear-gradient(180deg, #0f0f23 0%, #1b2331 60%, #0f0f23 100%)',
    zIndex: 0,
  },
  scroll: {
    position: 'relative',
    zIndex: 1,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: mobileTokens.space.xl,
    gap: mobileTokens.space.xl,
  },
  logoSection: {
    textAlign: 'center',
  },
  logoIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: mobileTokens.space.lg,
  },
  title: {
    fontSize: mobileTokens.font.title,
    fontWeight: 700,
    color: '#fff',
    margin: 0,
    letterSpacing: '-0.5px',
    lineHeight: 1.15,
  },
  titleSub: {
    fontSize: mobileTokens.font.base,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.5)',
    margin: '4px 0 8px',
    letterSpacing: '0.5px',
  },
  subtitle: {
    fontSize: mobileTokens.font.md,
    color: 'rgba(255,255,255,0.45)',
    margin: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.lg,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    height: INPUT_HEIGHT,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
  },
  button: {
    minHeight: mobileTokens.tap + 6,
    padding: `${mobileTokens.space.md}px`,
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: 4,
  },
  banner: {
    padding: mobileTokens.space.md,
    background: colors.accentA12,
    border: '1px solid rgba(91, 143, 199,0.25)',
    borderRadius: mobileTokens.radius.md,
    color: colors.accentFg,
    fontSize: mobileTokens.font.md,
    textAlign: 'center',
    fontWeight: 500,
  },
  error: {
    padding: mobileTokens.space.md,
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: mobileTokens.radius.sm,
    color: '#fca5a5',
    fontSize: mobileTokens.font.sm,
  },
  success: {
    padding: mobileTokens.space.md,
    background: 'rgba(34,197,94,0.12)',
    border: '1px solid rgba(34,197,94,0.25)',
    borderRadius: mobileTokens.radius.sm,
    color: '#86efac',
    fontSize: mobileTokens.font.sm,
  },
  linkBtn: {
    background: 'transparent',
    border: 'none',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    color: colors.accentFg,
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: mobileTokens.space.md,
  },
  note: {
    textAlign: 'center',
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
  },
};
