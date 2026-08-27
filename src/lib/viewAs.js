// "View as… staff" — boots a SEPARATE TAB whose entire app tree runs under the
// target's Supabase session, so every page reads exactly what they read.
//
// Why a second tab instead of swapping identity in place: pages import the
// `supabase` singleton directly, so the only way to make all of them read as
// someone else is to build that singleton with the other identity. Doing that
// in the admin's own tab would tear down their session; a second tab keeps the
// two completely separate and the preview ends when the tab closes.
//
// Token handoff: the admin's tab mints the token (it has the admin JWT the
// edge function requires) and drops it in localStorage, which is same-origin
// and shared across tabs. The preview tab consumes it ONCE on boot, deletes it
// immediately, and keeps it in sessionStorage — tab-scoped, so it survives a
// reload inside the preview but is invisible to every other tab.
//
// The minted token has no refresh token, so it cannot outlive its hour.

const HANDOFF_KEY = 'mayday-view-as-handoff';
const SESSION_KEY = 'mayday-view-as-session';
const PARAM = 'view_as';

function parsePayload(raw) {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (!payload?.session?.access_token || !payload?.target?.id) return null;
    // expires_at is epoch seconds from Supabase.
    if (payload.session.expires_at && payload.session.expires_at * 1000 <= Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Boot-time read, called by supabaseClient before the client is constructed.
 * Returns { session, target } for a preview tab, or null for a normal tab.
 */
export function readViewAsBoot() {
  if (typeof window === 'undefined') return null;

  // Already inside a preview tab (e.g. after a reload).
  const existing = parsePayload(window.sessionStorage.getItem(SESSION_KEY));
  if (existing) return existing;

  const wantsPreview = new URLSearchParams(window.location.search).get(PARAM) === '1';
  if (!wantsPreview) return null;

  const handed = window.localStorage.getItem(HANDOFF_KEY);
  window.localStorage.removeItem(HANDOFF_KEY); // one-shot, whether or not it parses
  const payload = parsePayload(handed);
  if (!payload) return null;

  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  return payload;
}

/** End the preview in this tab and return to a normal session. */
export function endViewAs() {
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }
  window.location.replace(window.location.origin);
}

/**
 * Called from the ADMIN's tab. Mints a token for `targetId` and opens the
 * preview in a new tab. Throws with the edge function's message on refusal.
 */
export async function startViewAs(client, targetId) {
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(
    `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/impersonate-contractor`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ target_id: targetId }),
    }
  );
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Failed to start preview');

  window.localStorage.setItem(HANDOFF_KEY, JSON.stringify({
    session: result.session,
    target: result.target,
  }));

  const opened = window.open(`${window.location.origin}/?${PARAM}=1`, '_blank');
  if (!opened) {
    window.localStorage.removeItem(HANDOFF_KEY);
    throw new Error('Allow pop-ups for this site to open the preview tab');
  }
  return result.target;
}

/**
 * Transport-level read-only guard for the preview client.
 *
 * The preview is read-only by enforcement, not by asking every page to behave:
 * reads go to the network, writes are refused here and never leave the browser.
 * `baseFetch` is injectable so tests don't need a real network.
 *
 * Known gap: RPCs are allowed through, because most read paths in this app are
 * RPCs. An RPC that writes would still write.
 */
export function createReadOnlyFetch(baseFetch = (...args) => fetch(...args)) {
  return function readOnlyFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (
      init.method || (typeof input === 'object' && input?.method) || 'GET'
    ).toUpperCase();

    const allowed =
      method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ||
      (method === 'POST' && url.includes('/rest/v1/rpc/')) ||
      // Signed-URL minting is a read: without it private docs/images fail in preview.
      (method === 'POST' && url.includes('/storage/v1/object/sign'));

    if (!allowed) {
      console.warn(`[View as\u2026] blocked ${method} ${url}`);
      return Promise.resolve(new Response(
        JSON.stringify({ message: 'Blocked: this is a read-only "View as\u2026" preview' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ));
    }
    return baseFetch(input, init);
  };
}
