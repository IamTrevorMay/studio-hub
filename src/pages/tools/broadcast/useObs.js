// React hook for obs-websocket-js v5. Connects to a local OBS Studio
// instance over the OBS WebSocket protocol. Persists the WebSocket URL
// to localStorage so reconnecting between page loads is one click.
//
// Security: the OBS WebSocket password is NEVER persisted. A leaked
// password effectively grants control of the user's local OBS Studio
// (including scene/source manipulation and remote shell via custom
// browser docks), so we keep it in-memory only and require re-entry
// after each page load.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OBSWebSocket from 'obs-websocket-js';

const STORAGE_KEY = 'mayday-broadcast-obs';

function loadStored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // Strip any legacy persisted password from older builds.
    if (v && typeof v === 'object') delete v.password;
    return v || {};
  } catch { return {}; }
}
function saveStored(v) {
  if (!v) return;
  // Persist URL only; password lives in component state for the session.
  const { password: _ignored, ...safe } = v;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

export function useObs() {
  const [status, setStatus] = useState('disconnected'); // disconnected | connecting | connected | error
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(() => ({
    url: 'ws://127.0.0.1:4455',
    password: '',
    ...loadStored(),
  }));
  const obsRef = useRef(null);

  // One-time scrub of any password persisted by older builds.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && raw.includes('"password"')) {
        saveStored(JSON.parse(raw));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => () => { if (obsRef.current) obsRef.current.disconnect().catch(() => null); }, []);

  const updateConfig = useCallback((patch) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveStored(next);
      return next;
    });
  }, []);

  const connect = useCallback(async () => {
    if (status === 'connecting' || status === 'connected') return;
    setStatus('connecting'); setError(null);
    if (!obsRef.current) obsRef.current = new OBSWebSocket();
    try {
      await obsRef.current.connect(config.url, config.password || undefined);
      setStatus('connected');
    } catch (e) {
      setStatus('error'); setError(String((e && e.message) || e));
    }
  }, [config.url, config.password, status]);

  const disconnect = useCallback(async () => {
    if (!obsRef.current) return;
    try { await obsRef.current.disconnect(); }
    finally { setStatus('disconnected'); }
  }, []);

  const call = useCallback(async (request, params) => {
    if (!obsRef.current || status !== 'connected') throw new Error('OBS not connected');
    return obsRef.current.call(request, params);
  }, [status]);

  const api = useMemo(() => ({
    status, error, config, updateConfig, connect, disconnect, call,
    obs: obsRef.current,
  }), [status, error, config, updateConfig, connect, disconnect, call]);
  return api;
}
