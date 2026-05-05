import { useRef, useCallback, useEffect } from 'react';

export default function useTeleprompterScroll(speed, isPlaying) {
  const scrollRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

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
    const pxPerSec = speedRef.current * 20;
    const pxThisFrame = (pxPerSec * delta) / 1000;

    const el = scrollRef.current;
    el.scrollTop += pxThisFrame;

    rafRef.current = requestAnimationFrame(tick);
  }, []);

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

  // Arrow-key scrolling (up/down)
  useEffect(() => {
    const SCROLL_STEP = 60;
    const handleKeyDown = (e) => {
      if (!scrollRef.current) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        scrollRef.current.scrollTop += SCROLL_STEP;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        scrollRef.current.scrollTop -= SCROLL_STEP;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const resetScroll = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  return { scrollRef, resetScroll };
}
