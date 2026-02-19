import { useCallback } from 'react';
import { supabase } from '../supabaseClient';

/**
 * Hook that provides a "safe fetch" wrapper around Supabase queries.
 * If a query fails due to an auth/JWT error, it automatically refreshes
 * the session and retries once.
 */
export function useSupabaseQuery() {
  const safeQuery = useCallback(async (queryFn) => {
    try {
      const result = await queryFn();

      // Check if the result has an auth-related error
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
            return result; // Return original error
          }

          // Retry the query with the fresh token
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
