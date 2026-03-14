import { useCallback } from 'react';
import { supabase } from '../services/supabase';

/**
 * Safe query wrapper — auto-refreshes session on auth errors and retries once.
 * Mirrors the web app's useSupabaseQuery hook.
 */
export function useSupabaseQuery() {
  const safeQuery = useCallback(async (queryFn) => {
    try {
      const result = await queryFn();

      if (result.error) {
        const errMsg = result.error.message || '';
        const errCode = result.error.code || '';

        if (
          errMsg.includes('JWT') ||
          errMsg.includes('token') ||
          errCode === 'PGRST301' ||
          errCode === '401' ||
          errCode === '403'
        ) {
          console.warn('Auth error on query, refreshing session and retrying...');
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

          if (refreshError || !refreshData?.session) {
            console.error('Session refresh failed:', refreshError);
            return result;
          }

          return await queryFn();
        }
      }

      return result;
    } catch (err) {
      console.error('Query execution error:', err);
      return { data: null, error: err };
    }
  }, []);

  return { safeQuery };
}
