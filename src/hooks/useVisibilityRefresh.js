import { useEffect, useRef } from 'react';

/**
 * Calls `onRefresh` whenever the user returns to the tab.
 *
 * Listens for the 'app-tab-restored' custom event dispatched by AuthContext
 * AFTER the auth token has been refreshed, so fetches use a valid session.
 *
 * Usage:
 *   useVisibilityRefresh(() => { fetchData(); fetchMore(); });
 */
export default function useVisibilityRefresh(onRefresh) {
  const callbackRef = useRef(onRefresh);

  // Always keep the latest callback without re-subscribing the listener
  useEffect(() => {
    callbackRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const handler = () => {
      callbackRef.current?.();
    };

    window.addEventListener('app-tab-restored', handler);
    return () => window.removeEventListener('app-tab-restored', handler);
  }, []);
}
