// TEMPORARY clickstream usage tracker for the front-end revamp study (2026-06-20).
//
// Collects pageviews + control clicks into public.usage_events so we can map
// which features/pipelines each role actually uses. Self-disables outside
// production and after KILL_DATE. Teardown: delete this file, delete
// useUsageTracking.js, remove the hook call in App.js, drop the table.
//
// Privacy: only records that an interactive control was clicked (its label),
// never the contents of inputs/textareas/contenteditable fields.

import { supabase } from '../supabaseClient';

// Auto-stop ~2 weeks out so it can't silently run forever if cleanup slips.
const KILL_DATE = new Date('2026-07-07T00:00:00Z').getTime();

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_AT_COUNT = 20;
const MAX_LABEL_LEN = 60;
const INTERACTIVE_SELECTOR =
  'button, a, [role="button"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], [data-track]';

let started = false;
let buffer = [];
let flushTimer = null;
let ctx = { userId: null, role: null }; // fed by React via setUser()
let sessionId = null;

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'sess-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function pageKey() {
  const p = (window.location.pathname || '/').replace(/^\/+/, '').split('/')[0];
  return p || 'dashboard';
}

// Build a short, content-free label for the clicked control.
function describeTarget(el) {
  const track = el.getAttribute('data-track');
  if (track) return { label: track.slice(0, MAX_LABEL_LEN), target: 'data-track' };

  const aria = el.getAttribute('aria-label');
  if (aria) return { label: aria.trim().slice(0, MAX_LABEL_LEN), target: tagSig(el) };

  const title = el.getAttribute('title');
  if (title) return { label: title.trim().slice(0, MAX_LABEL_LEN), target: tagSig(el) };

  // innerText only — never input values / typed content.
  const tag = el.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') {
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return { label: text.slice(0, MAX_LABEL_LEN), target: tagSig(el) };
  }
  return { label: '', target: tagSig(el) };
}

function tagSig(el) {
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
}

function enqueue(event_type, extra) {
  if (!ctx.userId) return; // not logged in yet — skip
  buffer.push({
    session_id: sessionId,
    user_id: ctx.userId,
    role: ctx.role,
    event_type,
    page_key: pageKey(),
    path: window.location.pathname,
    label: null,
    target: null,
    meta: null,
    ...extra,
  });
  if (buffer.length >= FLUSH_AT_COUNT) flush();
}

async function flush(useBeacon = false) {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  try {
    if (useBeacon && navigator.sendBeacon) {
      // Best-effort on unload: hit the REST endpoint directly with the anon key.
      const url = process.env.REACT_APP_SUPABASE_URL + '/rest/v1/usage_events';
      const blob = new Blob([JSON.stringify(batch)], { type: 'application/json' });
      // sendBeacon can't set custom headers; fall back to async insert if it fails.
      const ok = navigator.sendBeacon(url, blob);
      if (!ok) await supabase.from('usage_events').insert(batch);
    } else {
      await supabase.from('usage_events').insert(batch);
    }
  } catch (e) {
    // Never let tracking break the app; drop the batch on error.
    if (process.env.NODE_ENV !== 'production') console.warn('[usageTracker] flush failed', e);
  }
}

function onClick(e) {
  const el = e.target && e.target.closest ? e.target.closest(INTERACTIVE_SELECTOR) : null;
  if (!el) return;
  const { label, target } = describeTarget(el);
  enqueue('click', { label, target });
}

function onPageview() {
  enqueue('pageview', {});
}

function onHidden() {
  if (document.visibilityState === 'hidden') flush(true);
}

// AppLayout navigates via history.pushState; wrap it to detect SPA page changes.
function wrapHistory() {
  const origPush = window.history.pushState;
  window.history.pushState = function (...args) {
    const ret = origPush.apply(this, args);
    onPageview();
    return ret;
  };
  window.addEventListener('popstate', onPageview);
}

// Public API ---------------------------------------------------------------

export function initUsageTracker() {
  if (started) return;
  if (process.env.NODE_ENV !== 'production') return; // prod only
  if (Date.now() >= KILL_DATE) return; // study window closed
  started = true;
  sessionId = genId();

  document.addEventListener('click', onClick, true); // capture phase
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', () => flush(true));
  wrapHistory();
  flushTimer = setInterval(() => flush(false), FLUSH_INTERVAL_MS);
}

// React feeds the current identity; first identity also logs the entry pageview.
export function setUsageUser(userId, role) {
  if (!started) return;
  const firstIdentity = !ctx.userId && !!userId;
  ctx = { userId: userId || null, role: role || null };
  if (firstIdentity) onPageview();
}
