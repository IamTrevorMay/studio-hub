import { createClient } from '@supabase/supabase-js';

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'implicit',
    lock: noOpLock,
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
