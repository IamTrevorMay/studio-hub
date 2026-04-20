import { useEffect, useRef } from 'react';

export default function useVisibilityRefresh(onRefresh) {
  const callbackRef = useRef(onRefresh);

  useEffect(() => {
    callbackRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        console.log('[useVisibilityRefresh] visibilitychange fired → calling refresh');
        callbackRef.current?.();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);
}
