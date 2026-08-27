import { createClient } from '@supabase/supabase-js';
import { readViewAsBoot, createReadOnlyFetch } from './lib/viewAs';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in your .env file.'
  );
}

// No-op lock: bypasses the native navigator.locks and the previous in-memory
// simpleLock. This is safe for a single-tab app — Supabase's own internal
// debouncing prevents redundant token refreshes, and the no-op eliminates the
// deadlock that occurred when onAuthStateChange's async callback tried to call
// supabase.from() while the auth lock was still held.
const noOpLock = async (_name, _acquireTimeout, fn) => fn();

const defaultStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

// ── "View as…" preview tabs ──────────────────────────────────────────────────
// A preview tab boots the whole app under someone else's minted token, so the
// singleton every page imports IS the impersonated client. See lib/viewAs.js.
const viewAsBoot = readViewAsBoot();

/** Public flag for the banner + any UI that should know it's a preview. */
export const VIEW_AS = {
  active: !!viewAsBoot,
  target: viewAsBoot?.target || null,
  expiresAt: viewAsBoot?.session?.expires_at || null,
};

// Session lives in memory only — never localStorage, so the preview cannot
// leak into another tab or outlive this one.
function memoryStorage(seedKey, seedValue) {
  const map = new Map([[seedKey, seedValue]]);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

const readOnlyFetch = createReadOnlyFetch();

export const supabase = viewAsBoot
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: 'implicit',
      lock: noOpLock,
      storageKey: defaultStorageKey,
      storage: memoryStorage(defaultStorageKey, JSON.stringify(viewAsBoot.session)),
      // No refresh token was minted, so there is nothing to refresh — the
      // preview simply expires with the token.
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: readOnlyFetch },
  })
  : createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: 'implicit',
      lock: noOpLock,
      storageKey: defaultStorageKey,
      storage: window.localStorage,
    },
  });

if (viewAsBoot) {
  // Realtime authorizes off its own token — point it at the preview identity.
  try { supabase.realtime.setAuth(viewAsBoot.session.access_token); } catch (e) { /* noop */ }
}

/**
 * Force-reconnect the Realtime WebSocket.
 *
 * Browsers suspend WebSockets when a tab is backgrounded. Supabase's built-in
 * heartbeat may not recover fast enough, leaving subscriptions silently dead.
 * Calling this tears down the old socket and opens a fresh one. Pair it with a
 * refreshKey bump so every useEffect that creates a channel re-runs its cleanup
 * (removeChannel on the old socket) and setup (new channel on the live socket).
 */
export async function reconnectRealtime(maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      supabase.realtime.disconnect();
      const delay = 200 * Math.pow(2, attempt); // 200ms, 400ms, 800ms, 1600ms
      await new Promise(r => setTimeout(r, delay));
      supabase.realtime.connect();
      return;
    } catch (e) {
      console.warn(`Realtime reconnect attempt ${attempt + 1} failed:`, e);
      if (attempt === maxRetries) {
        console.error('Realtime reconnect exhausted all retries');
      }
    }
  }
}
