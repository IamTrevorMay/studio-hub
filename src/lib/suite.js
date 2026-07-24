// Mayday Studio suite navigation — shared by AppLayout + AppLayoutMobile.
//
// The suite's app roster lives in src/lib/suiteApps.js. Routed inside this
// SPA: Bridge (the classic studio hub — every existing tab route,
// unprefixed), Harbor (podcast & remote recording) at '/harbor'
// (+ '/harbor/room/<id>'; the PUBLIC '/harbor/join/<token>' guest route is
// served by App.js before the auth gate and never reaches the layouts), and
// the coming-soon teasers at '/anchor' and '/radar'. External apps (Cast,
// Drift, Fathom) are separate deployments — plain links, never routed here.
// The launcher lives at bare '/' and explicitly at '/launcher'.
//
// Bare '/' always resolves to Bridge (Trevor's call, 2026-07-24): login
// lands in Bridge exactly as it did pre-suite, and the Apps button is the
// one road to the launcher. The suite_last_app localStorage plumbing below
// is intentionally left in place — flip BARE_PATH_LANDING back to
// 'remember' to restore last-used-app resolution later.

import { SUITE_APP_SEGMENTS } from './suiteApps';

export const SUITE_LAST_APP_KEY = 'suite_last_app';
export const SUITE_VIEW_SEGMENTS = new Set(['launcher', ...SUITE_APP_SEGMENTS]);

// 'bridge' → bare '/' is always Bridge. 'remember' → last-used app, launcher
// on first login (the original suite behavior).
const BARE_PATH_LANDING = 'bridge';

// First URL segment → suite view: 'launcher' | 'harbor' | 'anchor' | 'radar'
// | null (null = Bridge; normal tab resolution takes over). Explicit
// '/launcher' always wins.
export function getSuiteViewFromPath() {
  const seg = window.location.pathname.replace(/^\/+/, '').split('/')[0];
  if (SUITE_VIEW_SEGMENTS.has(seg)) return seg;
  if (seg === '') {
    if (BARE_PATH_LANDING === 'bridge') return null;
    // localStorage can throw in hardened privacy modes — fall back to launcher.
    try {
      return localStorage.getItem(SUITE_LAST_APP_KEY) === 'bridge' ? null : 'launcher';
    } catch {
      return 'launcher';
    }
  }
  return null;
}

export function rememberBridge() {
  try {
    localStorage.setItem(SUITE_LAST_APP_KEY, 'bridge');
  } catch {
    // Preference just won't persist; never crash a render effect over it.
  }
}
