import { useEffect, useRef } from 'react';

/**
 * Calls `onRefresh` whenever the user returns to the tab.
 *
 * Listens directly to visibilitychange + window focus so there is no
 * dependency on AuthContext's custom event dispatch timing.  A 2-second
 * debounce prevents double-firing when both events arrive together.
 *
 * Usage:
 *   useVisibilityRefresh(() => { fetchData(); fetchMore(); });
 */
export default function useVisibilityRefresh(onRefresh) {
  const callbackRef = useRef(onRefresh);

  // Always keep the latest callback without re-subscribing the listeners
  useEffect(() => {
    callbackRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let lastFiredAt = 0;
    const DEBOUNCE_MS = 2000;

    const fire = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastFiredAt < DEBOUNCE_MS) return;
      lastFiredAt = now;
      callbackRef.current?.();
    };

    const onVisChange = () => {
      if (document.visibilityState === 'visible') fire();
    };

    // focus fires when user alt-tabs / cmd-tabs back to the browser window
    const onFocus = () => fire();

    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
}
