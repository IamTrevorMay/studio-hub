import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT_PX = 640;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;

// Boot-time check (no React state). Use this for the lazy-load decision in App.js
// where reactivity to resize would defeat the bundle split.
export function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(QUERY).matches;
}

// Reactive hook for components that want to respond to width changes
// after the layout chunk is loaded.
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(isMobileViewport);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(QUERY);
    const handler = (e) => setIsMobile(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, []);

  return isMobile;
}
