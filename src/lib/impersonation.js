import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';

// Admin "View as…" TRUE impersonation.
//
// start(contractorId) calls the strict-admin-gated `impersonate-contractor`
// edge function, which mints a short-lived, scoped access token for that
// contractor. We build a second Supabase client that attaches the token as a
// bearer on every request — so reads run under the contractor's RLS exactly.
// No session is persisted and no refresh token is kept, so the token cannot be
// renewed and dies when we drop the client (or after the 10-min safety timeout).
//
// The admin's own global `supabase` session is never touched. Pages opt in via
// useEffectivePortalIdentity(), which — only while impersonating — swaps in the
// contractor's id + the scoped client and flags the view read-only. When not
// impersonating it returns today's values verbatim, so nothing changes for real
// contractors or staff.

const SAFETY_TIMEOUT_MS = 10 * 60 * 1000;

const ImpersonationContext = createContext({
  active: false,
  contractor: null,
  db: supabase,
  start: async () => {},
  stop: () => {},
});

export function ImpersonationProvider({ children }) {
  const [state, setState] = useState(null); // { db, contractor }

  const stop = useCallback(() => {
    setState((prev) => {
      try { prev?.db?.removeAllChannels?.(); } catch (e) { /* noop */ }
      return null;
    });
  }, []);

  const start = useCallback(async (contractorId) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const res = await fetch(
      `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/impersonate-contractor`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ contractor_id: contractorId }),
      }
    );
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to start preview');

    const db = createClient(
      process.env.REACT_APP_SUPABASE_URL,
      process.env.REACT_APP_SUPABASE_ANON_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'impersonation-noop' },
        global: { headers: { Authorization: `Bearer ${result.access_token}` } },
      }
    );
    // Authorize realtime as the contractor too (best-effort).
    try { db.realtime.setAuth(result.access_token); } catch (e) { /* noop */ }

    setState({ db, contractor: result.contractor });
  }, []);

  // Safety timeout — end the preview automatically.
  useEffect(() => {
    if (!state) return undefined;
    const t = setTimeout(stop, SAFETY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [state, stop]);

  const value = useMemo(() => ({
    active: !!state,
    contractor: state?.contractor || null,
    db: state?.db || supabase,
    start,
    stop,
  }), [state, start, stop]);

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}

// Portal pages call this with their real (admin) identity from useAuth. While
// impersonating it returns the contractor's id + the scoped read-only client;
// otherwise it returns the real identity + the global client unchanged.
export function useEffectivePortalIdentity(realProfile, realUser) {
  const { active, contractor, db } = useImpersonation();
  return useMemo(() => {
    if (active && contractor) {
      return {
        // role forced to 'contractor' so role-gated UI (e.g. Channels
        // contractor rules) treats the preview as the contractor, not the admin.
        profile: { ...(realProfile || {}), id: contractor.id, role: 'contractor' },
        user: { ...(realUser || {}), id: contractor.id },
        supabase: db,
        readOnly: true,
      };
    }
    return { profile: realProfile, user: realUser, supabase, readOnly: false };
  }, [active, contractor, db, realProfile, realUser]);
}
