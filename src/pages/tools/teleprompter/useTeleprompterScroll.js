import { useRef, useCallback, useEffect } from 'react';

export default function useTeleprompterScroll(speed, isPlaying) {
  const scrollRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);

  const tick = useCallback((timestamp) => {
    if (!scrollRef.current) return;
    if (lastTimeRef.current === null) {
      lastTimeRef.current = timestamp;
    }
    const rawDelta = timestamp - lastTimeRef.current;
    lastTimeRef.current = timestamp;
    // Cap delta so background tabs don't cause a massive scroll jump on return
    const delta = Math.min(rawDelta, 100);

    // speed 1-10 → pixels per second (20-200)
    const pxPerSec = speed * 20;
    const pxThisFrame = (pxPerSec * delta) / 1000;

    const el = scrollRef.current;
    el.scrollTop += pxThisFrame;

    rafRef.current = requestAnimationFrame(tick);
  }, [speed]);

  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = null;
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, tick]);

  const resetScroll = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  return { scrollRef, resetScroll };
}
