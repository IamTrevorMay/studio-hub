import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, reconnectRealtime } from '../supabaseClient';
import { isAdminTier, getRestrictedNavKeys } from '../lib/rolePermissions';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [isInviteSetup, setIsInviteSetup] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const initDone = useRef(false);
  const visibilityInFlight = useRef(false);
  const inviteSetupRef = useRef(false); // ref for closure access in listener
  // Mirror isPasswordRecovery into a ref so the once-registered onAuthStateChange
  // listener reads the current value, not the stale render-0 `false` it closed
  // over (which let a SIGNED_IN during recovery auto-log-in / fetch profile).
  const isPasswordRecoveryRef = useRef(false);
  const authFailureCount = useRef(0);

  useEffect(() => { isPasswordRecoveryRef.current = isPasswordRecovery; }, [isPasswordRecovery]);

  // Nuclear option: wipe all auth state from the browser
  const nukeSession = useCallback(async () => {
    console.warn('Nuking auth session — clearing all local state');
    setUser(null);
    setProfile(null);
    setAuthError(null);
    setIsPasswordRecovery(false);
    // Clear Supabase's localStorage entries directly
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith('sb-') && (key.includes('auth-token') || key.includes('code-verifier'))) {
          localStorage.removeItem(key);
        }
      });
    } catch (e) {
      // localStorage might not be available
    }
    // Also tell Supabase to sign out (ignore errors)
    try { await supabase.auth.signOut({ scope: 'local' }); } catch (e) {}
  }, []);

  // Staged degradation: attempt silent recovery before nuking
  const handleAuthFailure = useCallback(async (context, error) => {
    authFailureCount.current += 1;
    console.warn(`Auth failure #${authFailureCount.current} (${context}):`, error?.message || error);

    if (authFailureCount.current >= 3) {
      console.error('3+ consecutive auth failures — nuking session');
      await nukeSession();
      return 'nuked';
    }

    // Attempt silent recovery
    try {
      const { data, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !data?.session) {
        console.warn('Silent recovery failed, will nuke on next failure');
        return 'degraded';
      }
      // Recovery succeeded — reset counter
      authFailureCount.current = 0;
      setUser(data.session.user);
      return 'recovered';
    } catch (e) {
      console.warn('Silent recovery threw:', e);
      return 'degraded';
    }
  }, [nukeSession]);

  const fetchProfile = useCallback(async (userId, retries = 3) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (error) {
          if (error.code === 'PGRST301' || error.message?.includes('JWT') || error.code === '401') {
            console.warn('Auth error fetching profile, refreshing session...');
            const { data: refreshData } = await supabase.auth.refreshSession();
            if (refreshData?.session) {
              continue;
            }
          }
          throw error;
        }

        setProfile(data);
        setAuthError(null);
        return data;
      } catch (error) {
        console.error(`Profile fetch attempt ${attempt + 1} failed:`, error);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        // All retries exhausted — attempt staged degradation before full nuke
        const result = await handleAuthFailure('profile_fetch_exhausted', error);
        if (result === 'recovered') {
          // Try one more time with the refreshed session
          try {
            const { data: retryData } = await supabase.from('profiles').select('*').eq('id', userId).single();
            if (retryData) { setProfile(retryData); setAuthError(null); return retryData; }
          } catch (e) { /* fall through */ }
        }
        if (result !== 'nuked') await nukeSession();
      }
    }
    return null;
  }, [nukeSession, handleAuthFailure]);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    // Hard safety timeout — if init hangs, nuke and show login
    const timeout = setTimeout(async () => {
      console.warn('Auth init timed out after 4s — nuking stale session');
      await nukeSession();
      setLoading(false);
    }, 4000);

    async function initAuth() {
      try {
        // Check if this is a password recovery flow BEFORE processing session
        const hash = window.location.hash;
        if (hash && hash.includes('type=recovery')) {
          setIsPasswordRecovery(true);
          setLoading(false);
          clearTimeout(timeout);
          return; // Don't auto-login, let AuthPage handle recovery
        }

        // Check if this is an invite setup flow — let AuthPage handle password creation
        if (hash && (hash.includes('type=invite') || hash.includes('type=signup') || hash.includes('type=magiclink'))) {
          inviteSetupRef.current = true;
          setIsInviteSetup(true);
          setLoading(false);
          clearTimeout(timeout);
          return; // Don't auto-login, let AuthPage handle setup
        }

        // First, try to get the existing session
        let session, error;
        try {
          const result = await supabase.auth.getSession();
          session = result.data?.session;
          error = result.error;
        } catch (e) {
          // getSession itself threw (e.g., corrupt token, lock timeout)
          console.error('getSession threw:', e);
          const result = await handleAuthFailure('getSession_threw', e);
          if (result !== 'recovered') await nukeSession();
          setLoading(false);
          clearTimeout(timeout);
          return;
        }

        if (error) {
          console.error('getSession error:', error);
          const result = await handleAuthFailure('getSession_error', error);
          if (result !== 'recovered') await nukeSession();
          setLoading(false);
          clearTimeout(timeout);
          return;
        }

        if (session?.user) {
          // Check if the token is close to expiring and refresh if needed
          const expiresAt = session.expires_at;
          const now = Math.floor(Date.now() / 1000);
          const timeLeft = expiresAt - now;

          if (timeLeft < 60) {
            // Token is about to expire or already expired, refresh it
            console.log('Token expiring soon, refreshing...');
            try {
              const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
              if (refreshError || !refreshData?.session) {
                console.error('Token refresh failed:', refreshError);
                const result = await handleAuthFailure('token_refresh_failed', refreshError);
                if (result !== 'recovered') await nukeSession();
                setLoading(false);
                clearTimeout(timeout);
                return;
              }
              authFailureCount.current = 0; // successful refresh
              setUser(refreshData.session.user);
              await fetchProfile(refreshData.session.user.id);
            } catch (e) {
              console.error('Token refresh threw:', e);
              const result = await handleAuthFailure('token_refresh_threw', e);
              if (result !== 'recovered') await nukeSession();
              setLoading(false);
              clearTimeout(timeout);
              return;
            }
          } else {
            setUser(session.user);
            await fetchProfile(session.user.id);
          }
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (err) {
        console.error('Auth init error:', err);
        await nukeSession();
      } finally {
        setLoading(false);
        clearTimeout(timeout);
      }
    }

    initAuth();

    // Listen for auth changes (sign in, sign out, token refresh).
    // IMPORTANT: this callback must NOT be async and must NOT call any
    // supabase.* functions directly. The Supabase auth lock is still held
    // for the duration of this callback — any awaited Supabase call inside it
    // will queue behind the lock and deadlock the entire client, making the
    // UI appear frozen after a tab switch or token refresh.
    // Any async work must be deferred via setTimeout so it runs after the lock
    // is released. See: https://github.com/supabase/auth-js/issues/762
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth event:', event);

        if (event === 'PASSWORD_RECOVERY') {
          setIsPasswordRecovery(true);
          setLoading(false);
          return;
        }

        if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          setIsPasswordRecovery(false);
          return;
        }

        if (isPasswordRecoveryRef.current || inviteSetupRef.current) return;

        if (session?.user) {
          if (event === 'SIGNED_IN') {
            setUser(session.user);
            // Defer fetchProfile outside the auth lock window
            setTimeout(() => {
              fetchProfile(session.user.id).then(p => {
                if (!p) {
                  setUser(null);
                  setProfile(null);
                }
              });
            }, 0);
          } else if (event === 'TOKEN_REFRESHED') {
            // Token refreshed — update user object only, profile hasn't changed
            setUser(session.user);
          }
        } else if (event !== 'TOKEN_REFRESHED') {
          setUser(null);
          setProfile(null);
        }
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile, nukeSession, handleAuthFailure]);

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }

  async function signUp(email, password, fullName, inviteToken, nickname) {
    // Verify invite token first
    const { data: invite, error: inviteError } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', inviteToken)
      .eq('email', email)
      .is('accepted_at', null)
      .single();

    if (inviteError || !invite) {
      throw new Error('Invalid or expired invitation. Please contact your admin.');
    }

    if (new Date(invite.expires_at) < new Date()) {
      throw new Error('This invitation has expired. Please request a new one.');
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          nickname: nickname || null,
          role: invite.role || 'member',
        },
      },
    });

    if (error) throw error;

    await supabase
      .from('invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    return data;
  }

  async function signOut() {
    if (user) {
      try { await supabase.from('profiles').update({ status: 'offline', last_seen_at: new Date().toISOString() }).eq('id', user.id); } catch (e) {}
    }
    await nukeSession();
  }

  async function updateProfile(updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw error;
    setProfile(data);
    return data;
  }

  // Helper for child components to ensure they have a fresh session
  async function ensureSession() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const expiresAt = session.expires_at;
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt - now < 60) {
        const { data } = await supabase.auth.refreshSession();
        return data?.session || null;
      }
      return session;
    } catch (e) {
      console.error('ensureSession failed:', e);
      return null;
    }
  }

  // Call after password reset completes to allow normal login flow
  function clearRecovery() {
    setIsPasswordRecovery(false);
    window.location.hash = '';
  }

  // Call after invite setup completes to allow normal login flow
  function clearInviteSetup() {
    inviteSetupRef.current = false;
    setIsInviteSetup(false);
    window.location.hash = '';
  }

  // ── Reconnect WebSocket when tab returns after a long absence ──
  // Data re-fetching is handled directly by useVisibilityRefresh in each page
  // (visibilitychange + focus listeners) — no custom event needed here.
  // This effect only handles the WebSocket reconnect + refreshKey bump, which
  // only matters after long absences where the socket may have gone dead.
  const RECONNECT_THRESHOLD_MS = 30_000;

  useEffect(() => {
    if (!user) return;
    let hiddenAt = null;

    const handleVisibility = async () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (document.visibilityState !== 'visible') return;

      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;

      // Brief tab switches don't need WebSocket reconnection
      if (away < RECONNECT_THRESHOLD_MS) return;

      // Prevent double-execution if visibilitychange fires twice rapidly (Chrome bug)
      if (visibilityInFlight.current) return;
      visibilityInFlight.current = true;

      try {
        // Refresh auth token and update the realtime socket auth
        const { data: refreshData } = await supabase.auth.refreshSession();
        const session = refreshData?.session;
        if (session) {
          supabase.realtime.setAuth(session.access_token);
        }

        // Force-reconnect the WebSocket (kills dead socket, opens fresh one)
        await reconnectRealtime();

        // Re-ping presence so status goes back to active immediately
        supabase.from('profiles').update({ status: 'active', last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {});
      } catch (e) {
        console.warn('Visibility reconnect failed:', e);
      } finally {
        visibilityInFlight.current = false;
      }

      // Bump refreshKey AFTER the socket is live so channels re-subscribe on the
      // fresh connection (only needed after long absences where socket may be dead)
      setRefreshKey(k => k + 1);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user]);

  const value = {
    user,
    profile,
    loading,
    authError,
    isPasswordRecovery,
    clearRecovery,
    isInviteSetup,
    clearInviteSetup,
    signIn,
    signUp,
    signOut,
    updateProfile,
    ensureSession,
    isAdmin: isAdminTier(profile?.role),
    isStrictAdmin: profile?.role === 'admin',
    isAssistant: profile?.role === 'assistant',
    isPartner: profile?.role === 'partner',
    isFreelancer: profile?.role === 'freelancer',
    isProducer: profile?.role === 'producer',
    canPost: profile?.role === 'admin' || profile?.posting_allowed === true,
    restrictedNavKeys: getRestrictedNavKeys(profile?.role),
    refreshKey,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
