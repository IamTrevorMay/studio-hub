import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import { colors } from '../lib/styleTokens';

export default function AuthPage() {
  const { signIn, isPasswordRecovery, clearRecovery, isInviteSetup } = useAuth();
  const [mode, setMode] = useState(() => {
    // Determine initial mode synchronously before Supabase clears the hash
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

  // If AuthContext flagged this as an invite setup, ensure we're in setup mode
  useEffect(() => {
    if (isInviteSetup && mode === 'login') {
      setMode('setup');
    }
  }, [isInviteSetup, mode]);

  // Listen for auth state changes (e.g. PASSWORD_RECOVERY event)
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
      if (!nickname.trim()) throw new Error('Please enter the nickname you go by.');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');

      // Update the user's password (they arrived via magic link)
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { full_name: fullName.trim(), nickname: nickname.trim() },
      });
      if (updateError) throw updateError;

      // Update their profile with the role from the invitation
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Look up the invitation — this is the only reliable source for the role.
        // Supabase wipes user_metadata when the invite link is confirmed.
        const { data: invitation } = await supabase.from('invitations')
          .select('role, title, payment_type, rate, contract_storage_path, contract_file_name, invited_by, assigned_drive_folder_id, assigned_drive_folder_name, retainer_enabled, retainer_min_hours, overtime_enabled, overtime_max_hours, overtime_multiplier')
          .eq('email', user.email.toLowerCase())
          .is('accepted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const assignedRole = invitation?.role || 'member';

        // Update the profile that was already created by the handle_new_user trigger.
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

        // If freelancer, create their contractor_profiles row with payment info
        if (assignedRole === 'contractor' || assignedRole === 'freelancer') {
          // Retainer/overtime come off the invitation. The
          // fl_profile_set_payment_from_invitation trigger re-asserts these
          // server-side on insert, so these client values can't be spoofed —
          // they're passed for admin-initiated inserts and older invitations.
          await supabase.from('contractor_profiles').upsert({
            id: user.id,
            payment_type: invitation?.payment_type || null,
            rate: invitation?.rate != null ? Number(invitation.rate) : null,
            retainer_enabled: invitation?.retainer_enabled ?? false,
            retainer_min_hours: invitation?.retainer_min_hours != null ? Number(invitation.retainer_min_hours) : null,
            overtime_enabled: invitation?.overtime_enabled ?? false,
            overtime_max_hours: invitation?.overtime_max_hours != null ? Number(invitation.overtime_max_hours) : null,
            overtime_multiplier: invitation?.overtime_multiplier != null ? Number(invitation.overtime_multiplier) : 1.5,
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
                // Create the document record
                await supabase.from('contractor_documents').insert({
                  contractor_id: user.id,
                  uploaded_by: invitation.invited_by,
                  title: 'Contract',
                  doc_type: 'signing',
                  storage_path: newPath,
                  file_name: invitation.contract_file_name,
                });
                // Clean up the pending file
                await supabase.storage
                  .from('freelancer-documents')
                  .remove([invitation.contract_storage_path]);
              }
            } catch (contractErr) {
              console.error('Failed to move contract:', contractErr);
            }
          }
        } else if (assignedRole === 'client') {
          // Create the client_profiles row (RLS lets clients insert their own),
          // then claim any invite-time contract server-side. Both non-fatal —
          // ClientProfile upserts the row lazily if this fails.
          try {
            const { error: cpErr } = await supabase.from('client_profiles')
              .upsert({ id: user.id });
            if (cpErr) console.error('client_profiles upsert failed:', cpErr);
            const { error: claimErr } = await supabase.rpc('claim_client_contract');
            if (claimErr) console.error('claim_client_contract failed:', claimErr);
          } catch (clientErr) {
            console.error('Client setup step failed:', clientErr);
          }
        }

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
            <img src="/logo.png" alt="Mayday Studio" width="36" height="36" />
          </div>
          <h1 style={styles.title}>Mayday Studio</h1>
          <p style={styles.titleSub}>by Mayday Media</p>
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
              <label style={styles.label}>Nickname</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="What should the team call you?"
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
    background: 'linear-gradient(135deg, #0f0f23 0%, #1b2331 50%, #0f0f23 100%)',
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
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
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
    background: colors.accentA10,
    border: '1px solid rgba(91, 143, 199,0.2)',
    borderRadius: '10px',
    color: colors.accentFg,
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
    color: colors.accentFg,
    marginTop: '14px',
    cursor: 'pointer',
  },
};
