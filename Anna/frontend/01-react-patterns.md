---
title: React Patterns — how React is written in Mayday Studio
last_updated: 2026-07-15
tags: [frontend, react, hooks, data-loading, state]
---

# React patterns

This codebase is React 18 (CRA + Craco). Pages are large single-file default-export
function components. There is **no Redux / Zustand / react-query** — data flows through
`useState` + direct Supabase calls + Realtime subscriptions + a handful of custom hooks.
Learn these idioms and you can add to any page without introducing a foreign pattern.

## 1. Component shape

Every page/component is a function component with hooks. The canonical top-of-file layout,
from `src/pages/Ideas.js:1-51`:

```js
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

// 1. Module-level constants: categories, field lists, color maps (see doc 02)
const CATEGORIES = [ /* ... */ ];
const IDEA_FIELDS = 'id, text, checked, position, category, ...';
const RATING_COLORS = { 1: '#ef4444', 2: '#f97316', /* ... */ };

export default function Ideas() {
  const { profile } = useAuth();
  // 2. Component-level useState — one useState per concern
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // lazy init
  const [byCategory, setByCategory] = useState(() => /* ... */);
  // 3. fetch fn, effects, handlers...
  // 4. return JSX
}

// 5. const styles = { ... } at the very bottom (see doc 02)
```

Mobile variants are **separate files** (`Ideas.js` + `IdeasMobile.js`), chosen at the
layout level, not via responsive CSS. `src/App.js:19-24` lazy-loads the desktop vs mobile
`AppLayout` by boot-time viewport check (`isMobileViewport()` from
`src/hooks/useIsMobile.js`). Individual pages inside a layout are **statically imported**
(`src/pages/AppLayout.js:11-40`) — there is no per-route code splitting.

## 2. State conventions

- **One `useState` per concern**, not one big object. This grain is extreme: verified counts
  (2026-07-15) — `Deliverables.js` **67** `useState`, `BusinessDev.js` 54, `Dashboard.js` 51,
  `Freelancers.js` 47, `Production.js` 46, `Channels.js` 41, `Projects.js` 33, `Calendar.js`
  30. A form's every field is its own state (`Deliverables.js:49-80` — `deliverableType`,
  `dueDate`, `deliverableNotes`, `deliverablePlatforms`, … each separate). Match that grain;
  do **not** introduce a reducer/one-object-form. `useMemo` is used sparingly per page (0 in
  Deliverables/Production/Freelancers/Projects) **except** `Accounting.js` (31) and
  `BusinessDev.js` (10), which are derivation-heavy — memoize there, not reflexively.
- **Lazy initializers for expensive/derived initial state**: `useState(() => new Set())`,
  `useState(() => Object.fromEntries(...))` (`src/pages/Ideas.js:45,49`). The arrow form
  runs once; a bare value re-allocates every render.
- **Functional updates** when the next state depends on the previous — required for Sets,
  toggles, and anything that can batch: `setAssignees(prev => prev.includes(id) ? prev.filter(...) : [...prev, id])` (`src/components/MemberAssignmentModal.js:121-123`).
- **Modal/panel open state is just a nullable value in the parent**: `showDeliverableForm`
  holds a trigger or `null` (`Deliverables.js:50`); `editingDeliverable` holds the row being
  edited or `null` (`:51`); `videoLinkModal`/`briefModalBrand`/`agencyThreadTarget` each hold
  the target row or `null` and the JSX renders `{videoLinkModal && (<overlay/>)}`
  (`Deliverables.js:2716,2834,2958`). Extracted child modals instead take `open`/`onClose`
  and early-return `if (!open) return null` (`MemberAssignmentModal.js:233`). Both shapes
  coexist — inline-conditional overlays for one-page modals, `open`-prop components for
  reusable ones.

## 3. Data loading — the standard idiom

The repeated pattern is: a memoized `fetch*` callback, an effect that calls it on mount,
and `useVisibilityRefresh` to re-run it on tab refocus. From `src/pages/Ideas.js:53-74`:

```js
const fetchAll = useCallback(async () => {
  const { data, error } = await supabase
    .from('write_ideas')
    .select(IDEA_FIELDS)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true }); // deterministic tiebreak
  if (error) { console.error('Error loading ideas:', error); return; }
  // ...group/normalize into local state
  setByCategory(grouped);
}, []);

useEffect(() => { fetchAll(); }, [fetchAll]);
useVisibilityRefresh(fetchAll);
```

Notes that hold across pages:
- **`select()` uses an explicit column string**, hoisted to a module const (`IDEA_FIELDS`,
  `Deliverables.js` uses embedded joins like `campaign:sponsor_campaigns(name, ...)`). Never
  `select('*')` on hot paths — pull only what you render.
- **Always `.order(...)` with a deterministic tiebreak** when a manual `position` column
  exists, or rows shuffle between reloads (`Ideas.js:57-60`).
- **Parallelize independent reads** with `Promise.all` — see `MemberAssignmentModal.js:68-83`
  (profiles + deliverables + campaigns in one round trip).
- **Errors are logged, not thrown** in fetch callbacks; the UI just shows its empty/loading
  state. Only user-triggered writes surface toasts.

### Pagination past 1000 rows

Supabase caps a query at 1000 rows. For anything that can exceed that, wrap the query in
`fetchAllRows` (`src/pages/analytics/utils.js:124-136`) which pages via `.range()`:

```js
import { fetchAllRows } from './analytics/utils'; // or '../pages/analytics/utils'
const rows = await fetchAllRows(
  supabase.from('sponsor_deliverables').select('id, title, due_date').order('due_date')
);
```

`Production.js:8` and `MemberAssignmentModal.js:73` both use it. Reach for it whenever a
table could realistically hold >1000 rows (metrics, transactions, deliverables).

### Safe queries (`useSupabaseQuery`)

`src/hooks/useSupabaseQuery.js` provides `safeQuery(queryFn)` — it runs the query, and if the
result carries a JWT/auth error (`PGRST301`, `401`, `403`, or a message containing `JWT`/`token`)
it calls `supabase.auth.refreshSession()` and retries **once** (`:19-36`). Use it for queries
that run right after a long tab-away where the token may have expired:

```js
const { safeQuery } = useSupabaseQuery();
const { data, error } = await safeQuery(() =>
  supabase.from('projects').select('*').eq('id', id).single()
);
```

It is **not** universally applied — verified, only **`Projects.js` and `Dashboard.js`** import
it; every other page's fetch callbacks call `supabase` directly and rely on `AuthContext`'s
reconnect (below). Add `safeQuery` when you observe transient 401s on refocus.

## 4. Tab-refocus refresh — two cooperating layers

There are **two independent mechanisms** and they do different jobs. Don't conflate them.

**Layer A — per-page data refresh: `useVisibilityRefresh(onRefresh)`**
(`src/hooks/useVisibilityRefresh.js`). Fires your callback once per blur→focus cycle. It
arms a `pendingRefresh` flag on `visibilitychange→hidden` / window `blur`, and fires on the
matching `visible`/`focus` (`:24-35`). Critically it does **not** fire on in-page clicks, so
it won't flood. Pass it your `fetch*` callback:

```js
useVisibilityRefresh(fetchAll);
```

The callback is held in a ref (`:4-8`) so you can pass an inline/changing function without
re-registering listeners.

**Layer B — WebSocket + auth reconnect: `AuthContext`** (`src/contexts/AuthContext.js:388-438`).
On return after **>`RECONNECT_THRESHOLD_MS`** (30s) away — gated at `AuthContext.js:410` — it
refreshes the auth token, re-auths the realtime socket (`supabase.realtime.setAuth`, `:421`),
force-reconnects the WebSocket (`reconnectRealtime()`, `:425`), then bumps a `refreshKey`
counter **after the socket is live** (`setRefreshKey(k => k + 1)`, `:437`; exposed `:467`).
Consumers that own a Realtime channel re-subscribe when `refreshKey` changes — see
`useNavConfig.js:30,66` which rebuilds its `nav_config` channel on `refreshKey`. If you add a
long-lived subscription that must survive tab-away, key its effect on `refreshKey` too.

## 5. Realtime subscriptions

Two ways to subscribe, both must clean up.

**Ad-hoc channel** (most pages) — subscribe in an effect, `removeChannel` in cleanup
(`src/hooks/useNavConfig.js:51-65`):

```js
useEffect(() => {
  const channel = supabase
    .channel('nav_config_changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'nav_config' },
        (payload) => setConfig(payload.new.config || {}))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [refreshKey]);
```

**Reusable hook: `useRealtimeTable(channelName, opts)`** (`src/hooks/useRealtimeTable.js`).
Handles `onInsert`/`onUpdate`/`onDelete`/`onAny`, an `enabled` gate, and exponential-backoff
resubscribe on `CHANNEL_ERROR`/`TIMED_OUT` (1s→30s, `:52-57`). Opts live in a ref so callbacks
can change without tearing down the channel. Currently only `FreelancerDashboard.js` uses it —
prefer it for new single-table subscriptions:

```js
useRealtimeTable('my-tasks', {
  table: 'tasks',
  filter: `assignee_id=eq.${profile.id}`,
  onAny: () => fetchTasks(),
});
```

Cleanup is non-negotiable: 32 `.channel(` sites (across 26 files; 5 written fully-qualified as
`supabase.channel(`), 36 `removeChannel` sites — every channel is torn down. A leaked channel
survives navigation and double-fires handlers.

## 6. Auth & role gating

`useAuth()` (`src/contexts/AuthContext.js`) exposes `profile`, `isAdmin`, `isAssistant`,
`canPost`, `refreshKey`, and role helpers. Gate admin UI inline:

```js
const { profile, isAdmin, refreshKey } = useAuth();
{isAdmin && <AdminOnlyThing />}
```

Deeper role logic (broadcast access, etc.) lives in `src/lib/rolePermissions.js` and is
consumed by `useNavConfig.js:12`. For **names in social/chat contexts** use
`getDisplayName(profile)` / `getDisplayInitial(profile)` from `src/lib/displayName.js` —
nickname-first, first-name fallback. Admin/legal contexts (Payroll, BD) keep raw
`profile.full_name`.

## 7. Loading & empty states

Minimal and inline — no shared spinner component on most pages.

- **Loading**: a ternary on a `loading` flag rendering a plain text node —
  `{loading ? <div style={styles.emptyState}>Loading...</div> : (...)}`
  (`src/pages/Production.js:1761-1762`).
- **Empty**: a short muted sentence, styled via a `styles.emptyText`/`styles.emptyState`
  entry. Real examples: `"No ideas yet"` (`Ideas.js:721`), `"No brands yet. Add one to get
  started."` (`Deliverables.js:2387`), `"No versions yet"` (`Production.js:1522`).
  Phrasing is `No <things> yet[.  <call to action>.]`.
- Errors from writes surface via a `showToast(msg, 'error')` prop passed down from the layout
  (`MemberAssignmentModal.js:110,223`). There is no global error boundary per page beyond
  `src/components/PageErrorBoundary.js`.

## 8. Modals & panels — composition

- Modal = self-contained component taking `open`/`onClose`/callbacks; early-returns null when
  closed. Canonical: `src/components/MemberAssignmentModal.js`.
- Backdrop click-to-dismiss uses `backdropDismiss(onClose)` spread onto the overlay div, which
  avoids the text-selection misfire bug (`src/lib/backdropDismiss.js`; **44 files** import it —
  see doc 03). Inner card stops propagation: `<div style={styles.modal} onClick={e =>
  e.stopPropagation()}>`.
- **Variance to know:** the biggest page, `Deliverables.js`, does **not** import
  `backdropDismiss` at all — its overlays hand-roll the same guard inline with
  `onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}`
  (`Deliverables.js:1969,2979`) and use `styles.modalOverlay` (`:3295`) rather than the recipe.
  Both approaches are considered correct here; when editing an existing modal, **match the file
  you're in** rather than swapping its dismiss mechanism.
- Confirmation dialogs use the app-wide `useConfirm()` context
  (`src/contexts/ConfirmContext.js`), not `window.confirm` — `const confirm = useConfirm();
  if (await confirm({ ... })) { ... }` (`Deliverables.js:6,39`).

## 9. Gotchas Anna should respect

- **PT vs UTC date boundaries** are a recurring bug class. Use helpers in `src/lib/ptDate.js`
  (`ptMonthKey`, `ptDayKey`) rather than raw `toISOString().slice(0,10)` for anything
  user-facing/daily — `Deliverables.js:9` imports them for exactly this reason.
- **Don't `select('*')`** on large tables; hoist an explicit column list.
- **Don't add a data-refetch to the reconnect effect in AuthContext** — that layer only does
  socket/token work; page refetch belongs in `useVisibilityRefresh` (comment at
  `AuthContext.js:389-390`).
- Pages are 100–200KB single files — Read specific line ranges, never the whole file.
