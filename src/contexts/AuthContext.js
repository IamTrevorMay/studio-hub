import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const initDone = useRef(false);

  const fetchProfile = useCallback(async (userId, retries = 2) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (error) {
          // If it's an auth error, try refreshing the session
          if (error.code === 'PGRST301' || error.message?.includes('JWT') || error.code === '401') {
            console.warn('Auth error fetching profile, refreshing session...');
            const { data: refreshData } = await supabase.auth.refreshSession();
            if (refreshData?.session) {
              continue; // Retry with new token
            }
          }
          throw error;
        }

        setProfile(data);
        setAuthError(null);
        return data;
      } catch (error) {
        console.error(`Profile fetch attempt ${attempt + 1} failed:`, error);
        if (attempt === retries) {
          setAuthError('Failed to load profile. Try refreshing the page.');
        }
      }
    }
    return null;
  }, []);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    // Hard safety timeout
    const timeout = setTimeout(() => {
      console.warn('Auth init timed out, forcing load complete');
      setLoading(false);
    }, 4000);

    async function initAuth() {
      try {
        // First, try to get the existing session
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error('getSession error:', error);
          setUser(null);
          setProfile(null);
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
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError || !refreshData?.session) {
              console.error('Token refresh failed:', refreshError);
              // Clear the bad session
              await supabase.auth.signOut();
              setUser(null);
              setProfile(null);
              setLoading(false);
              clearTimeout(timeout);
              return;
            }
            setUser(refreshData.session.user);
            await fetchProfile(refreshData.session.user.id);
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
        setUser(null);
        setProfile(null);
      } finally {
        setLoading(false);
        clearTimeout(timeout);
      }
    }

    initAuth();

    // Listen for auth changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth event:', event);

        if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          return;
        }

        if (session?.user) {
          setUser(session.user);
          // Only re-fetch profile on sign-in or token refresh if profile is missing
          if (event === 'SIGNED_IN' || !profile) {
            await fetchProfile(session.user.id);
          }
        } else if (event !== 'TOKEN_REFRESHED') {
          // Don't clear user on TOKEN_REFRESHED without a session
          // as it might be a transient state
          setUser(null);
          setProfile(null);
        }
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }

  async function signUp(email, password, fullName, inviteToken) {
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
        data: { full_name: fullName },
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
    setUser(null);
    setProfile(null);
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Sign out error:', error);
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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const expiresAt = session.expires_at;
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt - now < 60) {
      const { data } = await supabase.auth.refreshSession();
      return data?.session || null;
    }
    return session;
  }

  const value = {
    user,
    profile,
    loading,
    authError,
    signIn,
    signUp,
    signOut,
    updateProfile,
    ensureSession,
    isAdmin: profile?.role === 'admin',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
