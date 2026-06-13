// WebHID StreamDeck integration. Uses @elgato-stream-deck/webhid so the
// browser can talk directly to a connected device. WebHID is
// Chromium-only (Chrome / Edge / Arc). The hook exposes:
//   status, error, device, request(), reopen(), close(),
//   fillImage(idx, buf), fillRgb(idx, r, g, b), clear(idx),
//   onKey(callback)
// Buffer / image rendering is left to the caller — see StreamDeckGrid
// for the canvas-to-buffer pipeline.

import { useCallback, useEffect, useRef, useState } from 'react';
import { requestStreamDecks, getStreamDecks } from '@elgato-stream-deck/webhid';

export function useStreamDeck() {
  const [device, setDevice] = useState(null);
  const [status, setStatus] = useState('disconnected'); // disconnected | requesting | connected | unsupported | error
  const [error, setError] = useState(null);
  const keyCb = useRef(null);
  // Track listeners we add to a device so we can take them off again on
  // re-attach / unmount. Otherwise each .on() call leaves a handler behind
  // on the underlying HID instance.
  const listenersRef = useRef(null);

  const supported = typeof navigator !== 'undefined' && navigator.hid;

  const detachListeners = useCallback(() => {
    const entry = listenersRef.current;
    if (!entry) return;
    const { device: d, down, up, err } = entry;
    try { d.off ? d.off('down', down)  : d.removeListener && d.removeListener('down', down); } catch { /* ignore */ }
    try { d.off ? d.off('up', up)      : d.removeListener && d.removeListener('up', up); } catch { /* ignore */ }
    try { d.off ? d.off('error', err)  : d.removeListener && d.removeListener('error', err); } catch { /* ignore */ }
    listenersRef.current = null;
  }, []);

  const attach = useCallback((d) => {
    // If a device was previously attached, drop its handlers first.
    detachListeners();
    const down = (key) => { if (keyCb.current) keyCb.current(key, 'down'); };
    const up   = (key) => { if (keyCb.current) keyCb.current(key, 'up'); };
    const err  = (e)   => setError(String((e && e.message) || e));
    d.on('down', down);
    d.on('up', up);
    d.on('error', err);
    listenersRef.current = { device: d, down, up, err };
    setDevice(d);
    setStatus('connected');
  }, [detachListeners]);

  useEffect(() => {
    if (!supported) { setStatus('unsupported'); return; }
    // Try silent re-open of a previously-granted device on mount.
    let active = true;
    (async () => {
      try {
        const decks = await getStreamDecks();
        if (active && decks && decks[0]) attach(decks[0]);
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, [supported, attach]);

  useEffect(() => () => { detachListeners(); }, [detachListeners]);

  const request = useCallback(async () => {
    if (!supported) { setStatus('unsupported'); return; }
    setStatus('requesting'); setError(null);
    try {
      const decks = await requestStreamDecks();
      if (!decks || decks.length === 0) { setStatus('disconnected'); return; }
      attach(decks[0]);
    } catch (e) {
      setStatus('error'); setError(String(e && e.message || e));
    }
  }, [supported, attach]);

  const close = useCallback(async () => {
    detachListeners();
    if (device) try { await device.close(); } catch { /* ignore */ }
    setDevice(null); setStatus('disconnected');
  }, [device, detachListeners]);

  const onKey = useCallback((cb) => { keyCb.current = cb; }, []);

  const fillRgb = useCallback((idx, r, g, b) => {
    if (!device) return;
    return device.fillKeyColor(idx, r, g, b).catch(() => null);
  }, [device]);

  const clear = useCallback((idx) => {
    if (!device) return;
    return device.clearKey(idx).catch(() => null);
  }, [device]);

  const clearPanel = useCallback(() => {
    if (!device) return;
    return device.clearPanel().catch(() => null);
  }, [device]);

  const dims = device ? {
    keyCount: device.NUM_KEYS,
    columns:  device.KEY_COLUMNS,
    rows:     device.KEY_ROWS,
  } : null;

  return {
    supported, status, error, device, dims,
    request, close, onKey,
    fillRgb, clear, clearPanel,
  };
}
