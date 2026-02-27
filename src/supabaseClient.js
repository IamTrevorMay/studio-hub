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
  // If lock is held, wait for it
  if (_locks[name]) {
    try {
      await _locks[name];
    } catch (e) {
      // ignore errors from previous holder
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
