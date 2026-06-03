import { useCallback, useRef, useState } from 'react';

// Undo/redo state for the Builder. Wraps useState with a history stack
// and debounces pushes so dragging a slider doesn't fill the stack with
// every intermediate value. Ported from Triton lib/useSceneHistory.ts;
// stripped TS types but otherwise identical behavior.

const MAX_HISTORY = 60;
const DEBOUNCE_MS = 400;

export default function useSceneHistory(initial) {
  const [state, _setState] = useState(initial);
  const historyRef = useRef([initial]);
  const indexRef = useRef(0);
  const timerRef = useRef(null);
  const [, forceRender] = useState(0);

  const pushToHistory = useCallback((value) => {
    historyRef.current = historyRef.current.slice(0, indexRef.current + 1);
    historyRef.current.push(value);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    } else {
      indexRef.current++;
    }
  }, []);

  const setState = useCallback((next) => {
    _setState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        pushToHistory(resolved);
        forceRender((n) => n + 1);
      }, DEBOUNCE_MS);
      return resolved;
    });
  }, [pushToHistory]);

  const undo = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (indexRef.current > 0) {
      indexRef.current = Math.max(0, indexRef.current - 1);
      _setState(historyRef.current[indexRef.current]);
      forceRender((n) => n + 1);
    }
  }, []);

  const redo = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (indexRef.current < historyRef.current.length - 1) {
      indexRef.current++;
      _setState(historyRef.current[indexRef.current]);
      forceRender((n) => n + 1);
    }
  }, []);

  return [
    state,
    setState,
    {
      undo,
      redo,
      canUndo: indexRef.current > 0,
      canRedo: indexRef.current < historyRef.current.length - 1,
    },
  ];
}
