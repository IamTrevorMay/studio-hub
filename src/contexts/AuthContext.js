import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, reconnectRealtime } from '../supabaseClient';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const initDone = useRef(false);
  const visibilityInFlight = useRef(false);

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
        // All retries exhausted — nuke session so user gets clean login screen
        console.warn('All profile fetch attempts failed, nuking session');
        await nukeSession();
      }
    }
    return null;
  }, [nukeSession]);

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

        // First, try to get the existing session
        let session, error;
        try {
          const result = await supabase.auth.getSession();
          session = result.data?.session;
          error = result.error;
        } catch (e) {
          // getSession itself threw (e.g., corrupt token, lock timeout)
          console.error('getSession threw:', e);
          await nukeSession();
          setLoading(false);
          clearTimeout(timeout);
          return;
        }

        if (error) {
          console.error('getSession error:', error);
          await nukeSession();
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
                await nukeSession();
                setLoading(false);
                clearTimeout(timeout);
                return;
              }
              setUser(refreshData.session.user);
              await fetchProfile(refreshData.session.user.id);
            } catch (e) {
              console.error('Token refresh threw:', e);
              await nukeSession();
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

        if (isPasswordRecovery) return;

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
  }, [fetchProfile, nukeSession]);

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

  // ── Presence heartbeat ──
  useEffect(() => {
    if (!user) return;

    // Set online + update last_seen_at immediately
    const ping = () => {
      supabase.from('profiles').update({ status: 'active', last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {});
    };
    ping();

    const interval = setInterval(ping, 60000); // every 60s

    const handleBeforeUnload = () => {
      // Best-effort offline on tab close
      supabase.from('profiles').update({ status: 'offline', last_seen_at: new Date().toISOString() }).eq('id', user.id);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user]);

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

  // ── Notification state ──
  const [unreadAnnouncementCount, setUnreadAnnouncementCount] = useState(0);
  const [newItineraryCount, setNewItineraryCount] = useState(0);
  const [unreadMentionChannelIds, setUnreadMentionChannelIds] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);

  const fetchUnreadAnnouncementCount = useCallback(async () => {
    if (!user) return;
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      // Get today's announcements
      const { data: announcements, error: aErr } = await supabase
        .from('announcements')
        .select('id')
        .eq('target_date', todayStr);
      if (aErr) throw aErr;
      if (!announcements || announcements.length === 0) {
        setUnreadAnnouncementCount(0);
        return;
      }
      // Get which ones the user has read
      const { data: reads, error: rErr } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('user_id', user.id);
      if (rErr) throw rErr;
      const readIds = new Set((reads || []).map(r => r.announcement_id));
      const unread = announcements.filter(a => !readIds.has(a.id)).length;
      setUnreadAnnouncementCount(unread);
    } catch (err) {
      console.error('Error fetching unread announcement count:', err);
    }
  }, [user]);

  const fetchNewItineraryCount = useCallback(async () => {
    if (!user || profile?.role !== 'admin') { setNewItineraryCount(0); return; }
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const lastSeen = localStorage.getItem('dashboard_last_seen') || '1970-01-01T00:00:00.000Z';
      const { data, error } = await supabase
        .from('daily_itinerary')
        .select('id')
        .eq('target_date', todayStr)
        .gt('updated_at', lastSeen);
      if (error) throw error;
      setNewItineraryCount(data?.length || 0);
    } catch (err) {
      console.error('Error fetching new itinerary count:', err);
    }
  }, [user, profile?.role]);

  const fetchUnreadMentions = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('channel_messages')
        .select('channel_id, created_at')
        .contains('mentions', [user.id]);
      if (error) throw error;
      if (!data || data.length === 0) { setUnreadMentionChannelIds([]); return; }
      // Group by channel and check against localStorage timestamps
      const channelMap = {};
      data.forEach(msg => {
        if (!channelMap[msg.channel_id] || msg.created_at > channelMap[msg.channel_id]) {
          channelMap[msg.channel_id] = msg.created_at;
        }
      });
      const unread = Object.entries(channelMap).filter(([chId, latestMention]) => {
        const seen = localStorage.getItem(`channel_seen_${chId}`) || '1970-01-01T00:00:00.000Z';
        return latestMention > seen;
      }).map(([chId]) => chId);
      setUnreadMentionChannelIds(unread);
    } catch (err) {
      console.error('Error fetching unread mentions:', err);
    }
  }, [user]);

  const fetchUnreadNotificationCount = useCallback(async () => {
    if (!user) return;
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      if (error) throw error;
      setUnreadNotificationCount(count || 0);
    } catch (err) {
      console.error('Error fetching unread notification count:', err);
    }
  }, [user]);

  const fetchPendingProposalCount = useCallback(async () => {
    if (!user) return;
    try {
      const { count, error } = await supabase
        .from('ad_read_proposals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) throw error;
      setPendingProposalCount(count || 0);
    } catch (err) {
      console.error('Error fetching pending proposal count:', err);
    }
  }, [user]);

  const markChannelSeen = useCallback((channelId) => {
    localStorage.setItem(`channel_seen_${channelId}`, new Date().toISOString());
    setUnreadMentionChannelIds(prev => prev.filter(id => id !== channelId));
  }, []);

  const markDashboardSeen = useCallback(() => {
    localStorage.setItem('dashboard_last_seen', new Date().toISOString());
    setNewItineraryCount(0);
  }, []);

  const refreshNotifications = useCallback(() => {
    fetchUnreadAnnouncementCount();
    fetchNewItineraryCount();
    fetchUnreadMentions();
    fetchUnreadNotificationCount();
    fetchPendingProposalCount();
  }, [fetchUnreadAnnouncementCount, fetchNewItineraryCount, fetchUnreadMentions, fetchUnreadNotificationCount, fetchPendingProposalCount]);

  // Initial fetch + real-time subscriptions + 5-min fallback poll
  useEffect(() => {
    if (!user) return;
    refreshNotifications();

    const channel = supabase.channel('notification-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => {
        fetchUnreadAnnouncementCount();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_reads' }, () => {
        fetchUnreadAnnouncementCount();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_itinerary' }, () => {
        fetchNewItineraryCount();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_messages' }, () => {
        fetchUnreadMentions();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        fetchUnreadNotificationCount();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ad_read_proposals' }, () => {
        fetchPendingProposalCount();
      })
      .subscribe();

    // 5-minute fallback poll as safety net for dropped connections
    const interval = setInterval(refreshNotifications, 300000);

    // Re-fetch notifications + re-ping presence when tab returns
    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        refreshNotifications();
        supabase.from('profiles').update({ status: 'active', last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [user, refreshNotifications, fetchUnreadAnnouncementCount, fetchNewItineraryCount, fetchUnreadMentions, fetchUnreadNotificationCount, fetchPendingProposalCount, refreshKey]);

  const value = {
    user,
    profile,
    loading,
    authError,
    isPasswordRecovery,
    clearRecovery,
    signIn,
    signUp,
    signOut,
    updateProfile,
    ensureSession,
    isAdmin: profile?.role === 'admin',
    isAssistant: profile?.role === 'assistant',
    isPartner: profile?.role === 'partner',
    isFreelancer: profile?.role === 'freelancer',
    canPost: profile?.role === 'admin' || profile?.posting_allowed === true,
    unreadAnnouncementCount,
    newItineraryCount,
    markDashboardSeen,
    unreadMentionChannelIds,
    markChannelSeen,
    refreshNotifications,
    unreadNotificationCount,
    pendingProposalCount,
    refreshKey,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
