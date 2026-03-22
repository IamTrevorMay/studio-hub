import { useEffect, useRef } from 'react';

/**
 * Calls `onRefresh` whenever the browser tab becomes visible again
 * after being hidden for at least `minAwayMs` (default 5 seconds).
 *
 * Usage:
 *   useVisibilityRefresh(() => { fetchData(); fetchMore(); });
 */
export default function useVisibilityRefresh(onRefresh, minAwayMs = 5000) {
  const hiddenAtRef = useRef(null);
  const callbackRef = useRef(onRefresh);

  // Always keep the latest callback without re-subscribing the listener
  useEffect(() => {
    callbackRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === 'visible') {
        const away = hiddenAtRef.current
          ? Date.now() - hiddenAtRef.current
          : Infinity;
        hiddenAtRef.current = null;
        if (away >= minAwayMs) {
          callbackRef.current?.();
        }
      }
    };

    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [minAwayMs]);
}
