import { useEffect, useRef } from 'react';

export default function useVisibilityRefresh(onRefresh) {
  const callbackRef = useRef(onRefresh);

  useEffect(() => {
    callbackRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    // pendingRefresh is set when the tab/window loses focus.
    // It gates the refresh so we only fire once per blur→focus cycle,
    // and never fire just because an element inside the page was clicked.
    let pendingRefresh = false;

    const fireRefresh = () => {
      if (!pendingRefresh) return;
      pendingRefresh = false;
      console.log('[useVisibilityRefresh] tab restored → calling refresh');
      callbackRef.current?.();
    };

    // visibilitychange: fires on tab switch (hidden ↔ visible)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        pendingRefresh = true;
      } else {
        fireRefresh();
      }
    };

    // window blur/focus: fires on browser-window switch (cmd+tab, clicking other window)
    // Does NOT fire when clicking elements inside the page, so no flooding.
    const onBlur = () => { pendingRefresh = true; };
    const onFocus = () => { fireRefresh(); };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
}
