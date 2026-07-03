import { useRef, useCallback, useEffect } from 'react';

// Scroll speed in px/sec while a pedal is held
const SCROLL_PX_PER_SEC = 150;

export default function usePedalScroll(scrollRef) {
  const directionRef = useRef(0); // -1 = up, 1 = down, 0 = stopped
  const lastTimeRef = useRef(null);
  const rafRef = useRef(null);

  const scrollLoop = useCallback((timestamp) => {
    if (directionRef.current === 0) {
      lastTimeRef.current = null;
      rafRef.current = null;
      return;
    }
    if (lastTimeRef.current === null) lastTimeRef.current = timestamp;
    const delta = Math.min(timestamp - lastTimeRef.current, 100);
    lastTimeRef.current = timestamp;
    if (scrollRef.current) {
      scrollRef.current.scrollTop += directionRef.current * (SCROLL_PX_PER_SEC * delta) / 1000;
    }
    rafRef.current = requestAnimationFrame(scrollLoop);
  }, [scrollRef]);

  useEffect(() => {
    function onKeyDown(e) {
      const tag = e.target.tagName;
      // Also bail inside the contentEditable script editor (a DIV) so a/b can be
      // typed — the tag check alone let the pedal handler swallow those letters.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        if (directionRef.current !== -1) {
          directionRef.current = -1;
          if (!rafRef.current) {
            lastTimeRef.current = null;
            rafRef.current = requestAnimationFrame(scrollLoop);
          }
        }
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (directionRef.current !== 1) {
          directionRef.current = 1;
          if (!rafRef.current) {
            lastTimeRef.current = null;
            rafRef.current = requestAnimationFrame(scrollLoop);
          }
        }
      }
    }

    function onKeyUp(e) {
      if (e.key === 'a' || e.key === 'A') {
        if (directionRef.current === -1) directionRef.current = 0;
      } else if (e.key === 'b' || e.key === 'B') {
        if (directionRef.current === 1) directionRef.current = 0;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      directionRef.current = 0;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scrollLoop]);
}
