import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const initDone = useRef(false);
  const appState = useRef(AppState.currentState);

  // ── Nuke session ──
  const nukeSession = useCallback(async () => {
    setUser(null);
    setProfile(null);
    try { await supabase.auth.signOut({ scope: 'local' }); } catch {}
  }, []);

  // ── Fetch profile with retry ──
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
            const { data: refreshData } = await supabase.auth.refreshSession();
            if (refreshData?.session) continue;
          }
          throw error;
        }

        setProfile(data);
        return data;
      } catch (error) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        await nukeSession();
      }
    }
    return null;
  }, [nukeSession]);

  // ── Init auth ──
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    const timeout = setTimeout(async () => {
      await nukeSession();
      setLoading(false);
    }, 6000);

    async function initAuth() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          await nukeSession();
          setLoading(false);
          clearTimeout(timeout);
          return;
        }

        if (session?.user) {
          const expiresAt = session.expires_at;
          const now = Math.floor(Date.now() / 1000);

          if (expiresAt - now < 60) {
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError || !refreshData?.session) {
              await nukeSession();
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
        }
      } catch (err) {
        await nukeSession();
      } finally {
        setLoading(false);
        clearTimeout(timeout);
      }
    }

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          return;
        }
        if (session?.user) {
          if (event === 'SIGNED_IN') {
            setUser(session.user);
            const p = await fetchProfile(session.user.id);
            if (!p) { setUser(null); setProfile(null); }
          } else if (event === 'TOKEN_REFRESHED') {
            setUser(session.user);
          }
        }
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile, nukeSession]);

  // ── Presence heartbeat ──
  useEffect(() => {
    if (!user) return;

    const ping = () => {
      supabase.from('profiles')
        .update({ status: 'active', last_seen_at: new Date().toISOString() })
        .eq('id', user.id)
        .then(() => {});
    };
    ping();

    const interval = setInterval(ping, 60000);
    return () => clearInterval(interval);
  }, [user]);

  // ── App state changes (foreground/background) ──
  useEffect(() => {
    if (!user) return;

    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // App came to foreground — refresh token + reconnect realtime
        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session) {
            const expiresAt = data.session.expires_at;
            const now = Math.floor(Date.now() / 1000);
            if (expiresAt - now < 120) {
              await supabase.auth.refreshSession();
            }
            supabase.realtime.setAuth(data.session.access_token);
          }
        } catch (e) {
          console.warn('Foreground reconnect failed:', e);
        }
      } else if (nextAppState.match(/inactive|background/)) {
        // Going to background — mark offline
        supabase.from('profiles')
          .update({ status: 'offline', last_seen_at: new Date().toISOString() })
          .eq('id', user.id)
          .then(() => {});
      }
      appState.current = nextAppState;
    });

    return () => subscription.remove();
  }, [user]);

  // ── Notification counts ──
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [unreadMentionChannelIds, setUnreadMentionChannelIds] = useState([]);

  const fetchUnreadNotificationCount = useCallback(async () => {
    if (!user) return;
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      if (!error) setUnreadNotificationCount(count || 0);
    } catch {}
  }, [user]);

  const fetchUnreadMentions = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('channel_messages')
        .select('channel_id, created_at')
        .contains('mentions', [user.id]);
      if (error || !data?.length) { setUnreadMentionChannelIds([]); return; }

      const channelMap = {};
      data.forEach(msg => {
        if (!channelMap[msg.channel_id] || msg.created_at > channelMap[msg.channel_id]) {
          channelMap[msg.channel_id] = msg.created_at;
        }
      });
      const unread = [];
      for (const [chId, latestMention] of Object.entries(channelMap)) {
        const seen = await AsyncStorage.getItem(`channel_seen_${chId}`);
        if (latestMention > (seen || '1970-01-01T00:00:00.000Z')) {
          unread.push(chId);
        }
      }
      setUnreadMentionChannelIds(unread);
    } catch {}
  }, [user]);

  const refreshNotifications = useCallback(() => {
    fetchUnreadNotificationCount();
    fetchUnreadMentions();
  }, [fetchUnreadNotificationCount, fetchUnreadMentions]);

  const markChannelSeen = useCallback(async (channelId) => {
    await AsyncStorage.setItem(`channel_seen_${channelId}`, new Date().toISOString());
    setUnreadMentionChannelIds(prev => prev.filter(id => id !== channelId));
  }, []);

  // Fetch on user change + realtime
  useEffect(() => {
    if (!user) return;
    refreshNotifications();

    const channel = supabase.channel('mobile-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        fetchUnreadNotificationCount();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_messages' }, () => {
        fetchUnreadMentions();
      })
      .subscribe();

    const interval = setInterval(refreshNotifications, 300000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [user, refreshNotifications, fetchUnreadNotificationCount, fetchUnreadMentions]);

  // ── Auth actions ──
  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (user) {
      try {
        await supabase.from('profiles')
          .update({ status: 'offline', last_seen_at: new Date().toISOString() })
          .eq('id', user.id);
      } catch {}
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

  const value = {
    user,
    profile,
    loading,
    signIn,
    signOut,
    updateProfile,
    isAdmin: profile?.role === 'admin',
    isAssistant: profile?.role === 'assistant',
    unreadNotificationCount,
    unreadMentionChannelIds,
    markChannelSeen,
    refreshNotifications,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
