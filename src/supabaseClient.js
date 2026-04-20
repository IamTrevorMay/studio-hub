import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in your .env file.'
  );
}

// Simple in-memory lock to replace Navigator LockManager
// Prevents concurrent token refresh race conditions without browser locks
const _locks = {};
async function simpleLock(name, acquireTimeout, fn) {
  // If lock is held, wait for it — but respect the timeout so callers don't
  // hang forever if the previous holder's network request never completes.
  if (_locks[name]) {
    const waitMs = typeof acquireTimeout === 'number' && acquireTimeout > 0 ? acquireTimeout : 5000;
    try {
      await Promise.race([
        _locks[name],
        new Promise((_, reject) => setTimeout(() => reject(new Error('lock timeout')), waitMs)),
      ]);
    } catch (e) {
      // ignore errors from previous holder or timeout
    }
  }
  // Acquire lock
  let resolve;
  _locks[name] = new Promise((r) => { resolve = r; });
  try {
    return await fn();
  } finally {
    delete _locks[name];
    resolve();
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'implicit',
    lock: simpleLock,
    storageKey: `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`,
    storage: window.localStorage,
  },
});

/**
 * Force-reconnect the Realtime WebSocket.
 *
 * Browsers suspend WebSockets when a tab is backgrounded. Supabase's built-in
 * heartbeat may not recover fast enough, leaving subscriptions silently dead.
 * Calling this tears down the old socket and opens a fresh one. Pair it with a
 * refreshKey bump so every useEffect that creates a channel re-runs its cleanup
 * (removeChannel on the old socket) and setup (new channel on the live socket).
 */
export async function reconnectRealtime() {
  try {
    // Tear down the existing WebSocket (no-ops if already disconnected)
    supabase.realtime.disconnect();

    // Small delay to let the disconnect settle before reconnecting
    await new Promise(r => setTimeout(r, 150));

    // Open a fresh WebSocket — channels will be re-created by React effects
    supabase.realtime.connect();
  } catch (e) {
    console.warn('Realtime reconnect error:', e);
  }
}
