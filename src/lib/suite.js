// Mayday Studio suite navigation — shared by AppLayout + AppLayoutMobile.
//
// The suite has one live app today, Bridge (the classic studio hub — every
// existing tab route, unprefixed), plus a coming-soon teaser for Harbor
// (podcast & remote recording) at '/harbor'. The launcher lives at bare '/'
// and explicitly at '/launcher'.
//
// Bare '/' resolves to the last-used app, or the launcher on first login.
// The preference is a device-level nav setting (like 'studio-hub-tab' /
// 'studio-hub-mode'), so it lives in localStorage. Only entering Bridge
// writes it — visiting Harbor's teaser must never strand users there.

export const SUITE_LAST_APP_KEY = 'suite_last_app';
export const SUITE_VIEW_SEGMENTS = new Set(['launcher', 'harbor']);

// First URL segment → suite view: 'launcher' | 'harbor' | null (null = Bridge;
// normal tab resolution takes over). Explicit '/launcher' always wins over the
// stored preference; bare '/' consults it.
export function getSuiteViewFromPath() {
  const seg = window.location.pathname.replace(/^\/+/, '').split('/')[0];
  if (SUITE_VIEW_SEGMENTS.has(seg)) return seg;
  if (seg === '') {
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
