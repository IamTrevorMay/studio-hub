import React, { createContext, useContext, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from './AuthContext';

const PresenceContext = createContext({});

export const usePresence = () => useContext(PresenceContext);

export function PresenceProvider({ children }) {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const ping = () => {
      supabase.from('profiles').update({ status: 'active', last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {});
    };
    ping();

    const interval = setInterval(ping, 60000);

    const handleBeforeUnload = () => {
      supabase.from('profiles').update({ status: 'offline', last_seen_at: new Date().toISOString() }).eq('id', user.id);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user]);

  return <PresenceContext.Provider value={{}}>{children}</PresenceContext.Provider>;
}
