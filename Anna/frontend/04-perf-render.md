---
title: Performance & Render Hygiene
last_updated: 2026-07-15
tags: [frontend, performance, render, realtime, queries]
---

# Performance & render hygiene

What actually makes pages slow here, and how Anna avoids it. The two structural realities are
(1) **giant single-file pages** and (2) **many direct Supabase reads + Realtime channels**.
Everything below follows from those.

## 1. The giant-page problem (and the split effort)

Several pages are 100–200KB single files (real on-disk bytes, 2026-07-15): `Deliverables.js`
(167KB / 3,315 lines), `BusinessDev.js` (153KB), `Production.js` (132KB), `Calendar.js`
(130KB), `Dashboard.js` (115KB), `Freelancers.js` (96KB), `Channels.js` (92KB), `Research.js`
(89KB), plus `Invoicing.js` (75KB) and `Projects.js` (74KB, though its heavy board is already
split into `projects/UnifiedBoard.js`). CLAUDE.md flags this; memory
`audit_phase6_page_splits.md` is the ongoing effort to split the top-7 >100KB pages.

Consequences Anna must respect:
- **Read line ranges, never the whole file.** Reading a 170KB page burns context for nothing.
- These pages hold dozens of `useState` in one component, so **any state change re-renders the
  entire page tree**. This is the single biggest real hazard: `Deliverables.js` has **67
  `useState` and 0 `useMemo`** in one 3,315-line function — every keystroke in any of its
  inline forms re-renders the whole page. Keep new interactive widgets as separate child
  components (they render in isolation) rather than adding more state to the monolith.
  `analytics/` and `projects/` were already broken into subfolders (`analytics/viz/*`,
  `analytics/components/*`, `projects/UnifiedBoard.js`) — that's the target shape. Note those
  split pages also **drop the bottom-of-file `styles` const**: `analytics/Analytics.js` imports
  `{ styles, L } from './styles'` and `projects/UnifiedBoard.js` builds styles inline from raw
  `styleTokens` — extracting a section is the moment to move its styles into the subfolder too.
- When splitting, extract self-contained sections into `src/pages/<page>/` subfolders with
  their own `styles` and a thin prop interface — don't lift shared state up unless it must be
  shared.

### No route-level code splitting

`src/App.js:19-24` lazy-loads only the desktop-vs-mobile `AppLayout`/`AuthPage` and the two
public pages (`:96-97`). Inside a layout, **every page is statically imported**
(`AppLayout.js:11-40`), so the whole app bundle loads up front. If bundle size becomes a
concern, the lever is converting these static imports to `React.lazy` + `Suspense` — currently
unused for internal pages. (No action unless asked; just know the split isn't there yet.)

## 2. Query efficiency — avoid N+1

Memory `audit_phase4_perf.md` was a dedicated N+1 sweep. The rules that came out of it:

- **One query with an embedded join, not a loop of queries.** Supabase's PostgREST embedding
  pulls related rows in a single round trip:
  ```js
  // ✅ join in the select — one request
  .select('id, title, campaign:sponsor_campaigns(name, brief_url, campaign_briefs(id))')
  //   (MemberAssignmentModal.js:76-77 / Deliverables.js field strings)
  // ❌ never: fetch parents, then loop and fetch each child
  ```
- **Parallelize independent reads** with `Promise.all` (`MemberAssignmentModal.js:68-83`) — three
  tables in one await instead of three serial awaits.
- **Select only displayed columns.** Hoist the column list to a module const
  (`IDEA_FIELDS`, `Ideas.js:24`). No `select('*')` on hot paths.
- **Paginate anything that can exceed 1000 rows** with `fetchAllRows` (`analytics/utils.js:124`)
  — a naïve query silently truncates at 1000 and the page renders wrong-but-not-erroring data,
  which is worse than slow.
- **Filter server-side, not client-side.** Push `.eq/.gte/.in/.order` into the query; only do
  in-JS filtering for cheap post-processing (e.g. `recordOptions` typeahead filter,
  `MemberAssignmentModal.js:126-131`).

## 3. Memoization — where and why

`useCallback` (~540 uses) and `useMemo` (~200 uses) are heavily used; `React.memo` is **not used
anywhere** (0 hits). The convention:

- **`useCallback` on every `fetch*` function** so it's a stable dep for `useEffect(..., [fetchX])`
  and `useVisibilityRefresh(fetchX)` (`Ideas.js:53-74`). Without this, the effect re-runs every
  render → refetch storm.
- **`useMemo` for derived lists/filters** that would otherwise recompute a filter/sort each
  render: `team`/`contractors` filtered from profiles (`MemberAssignmentModal.js:118-119`),
  `recordOptions` typeahead (`:126-131`). Memoize when the input array is non-trivial or the
  derivation runs on every keystroke.
- **Don't reach for `React.memo`** — the pattern here is to *not* create deep child trees that
  need it, and the giant pages re-render wholesale anyway (memoizing a child inside a monolith
  that re-renders on every keystroke buys little). If you extract a heavy child that receives
  stable props, `React.memo` is fair game, but it's off-pattern; prefer structural extraction.
- **Module-level `styles` objects are a free win** — because they're defined once (not per
  render), style props are reference-stable, so children that *do* care about prop identity
  don't thrash (doc 02 §"inline-style convention").

## 4. Realtime subscription hygiene

Realtime is a top source of subtle perf/correctness bugs. Invariants:

- **Every channel is torn down.** Verified 2026-07-15: **32 `.channel(` sites across 26 files**
  (only 5 written as the fully-qualified `supabase.channel(`; most are chained off a client
  ref) ↔ **36 `removeChannel` sites**. A leaked channel survives navigation and keeps firing
  state setters on an unmounted tree. Always `return () => supabase.removeChannel(channel)` from
  the subscribing effect (`useNavConfig.js:60-65`).
- **Prefer `useRealtimeTable`** (`src/hooks/useRealtimeTable.js`) for new single-table
  subscriptions — it handles teardown, an `enabled` gate, opts-in-a-ref (so changing callbacks
  don't tear down the channel, `:22-23`), and **exponential-backoff resubscribe** on
  `CHANNEL_ERROR`/`TIMED_OUT` (1s→30s cap, `:52-57`). Rolling your own risks a tight
  resubscribe loop when the socket flaps.
- **Re-subscribe on `refreshKey`** for long-lived channels. After a >30s tab-away, `AuthContext`
  reconnects the socket and bumps `refreshKey` (`AuthContext.js:437`); channels keyed on it
  re-subscribe on the fresh socket (`useNavConfig.js:30,66`). A channel *not* keyed on
  `refreshKey` goes silently dead after a long absence.
- **Realtime should patch state, not trigger a full refetch on every event**, when the payload
  is enough. `useNavConfig` sets state straight from `payload.new` (`:53-56`). Use `onAny: () =>
  refetch()` only when you need to re-derive from multiple rows. On a busy table, a refetch per
  event is a re-render storm.
- **Don't over-subscribe.** Rows outside a user's RLS read set never emit `postgres_changes` for
  that user (e.g. the Agency portal notes deliverable rows are outside agency RLS, so it polls
  every 20s instead — CLAUDE.md "Agency Portal"). Match the mechanism to what RLS actually
  delivers.

## 5. Avoiding re-render storms

- **`useVisibilityRefresh` is gated** so it fires at most once per blur→focus cycle and never on
  in-page clicks (`useVisibilityRefresh.js:12-35`). If you add your own focus listener, replicate
  the `pendingRefresh` gate or you'll refetch on every click.
- **The 30s reconnect threshold** (`AuthContext.js:393,410`) prevents a full token-refresh +
  socket-reconnect + `refreshKey` bump on quick tab flicks. Don't lower it casually — a bump
  re-subscribes every keyed channel app-wide.
- **Functional state updates** avoid stale-closure re-renders and are required for batched
  updates (Sets/toggles, doc 01 §2).
- **Debounce/slice expensive per-keystroke work.** Typeahead lists memo-filter then
  `.slice(0, 50)` before render (`MemberAssignmentModal.js:277`). Don't map 5000 rows into DOM.
- **Polling widgets** (Dashboard "Do this more" refreshes every 30s; Agency portal every 20s)
  should live in their own component with their own interval + cleanup, not add a timer to a
  monolith's top-level effect.

## 6. Charts / SVG rendering

Charts are **hand-rolled SVG** — no charting library, so no canvas/DOM-node explosion. There
are **two implementations**: the shared `src/lib/charts.js` (`DonutChart`/`TrendChart`/
`formatCompact`, used by `Accounting.js:5`) and Analytics's own copies under
`analytics/components/` (`TrendChart.js`, `DonutChart.js`) + primitives in `analytics/viz/`
(`Sparkline`, `MiniBar`, `Legend`, `palette.js`). The `charts.js` header comment notes Analytics
"still has its own copies for now; safe to migrate later" — so a chart fix may need mirroring in
both until they converge. Perf notes (citing `src/lib/charts.js`):

- `TrendChart` (`charts.js:70-205`) renders one `<path>` per metric + transparent hover `<rect>`
  overlays for hit-testing (`:168-174`); hover state is a single `hoveredIndex` (`:71`) so a
  hover re-renders only the tooltip, not the paths.
- It wraps in `overflowX:'auto'` (`:132`) and uses a fixed `viewBox` scaled to 100% width, so
  wide series scroll rather than reflow — the responsive/no-horizontal-page-scroll rule.
- `DonutChart` (`:21-61`) is pure SVG path math, no state. `formatCompact` (`:7-13`) keeps axis
  labels short.
- Color comes from `analytics/viz/palette.js` (`viz.*`, token-derived) — reuse it, don't inline
  chart hex, so a platform is one color everywhere.

For a **new** chart: follow `charts.js` — compute geometry in JS, emit SVG, single hover-index
state, `overflowX:'auto'` wrapper, `viz` palette. Don't add a chart library.

## 7. Images / assets

No image-optimization pipeline in-app; assets are served from the cloud host
(`https://assets.maydaystudio.net`, CLAUDE.md "Contractor Portal") and Drive. When rendering
media lists, bound the count and lazy-load offscreen items (native `loading="lazy"` on `<img>`)
rather than mounting hundreds at once — the `FindAssetsModal` preview pane loads one selected
asset into a side viewer instead of rendering all candidates inline
(`FindAssetsModal.js` header comment).

## 8. Quick perf checklist for any change

1. New data read → embedded join + `Promise.all`, explicit columns, `fetchAllRows` if >1000.
2. New `fetch*` → wrap in `useCallback`; feed it to `useEffect` + `useVisibilityRefresh`.
3. Derived filter/sort on a real array → `useMemo`; slice long lists before render.
4. New Realtime channel → `useRealtimeTable` (or manual with `removeChannel` cleanup + key on
   `refreshKey`); patch state from payload instead of full refetch when possible.
5. New heavy UI section on a monolith page → extract a child component, don't add more top-level
   state.
6. New chart → hand-rolled SVG per `charts.js` + `viz` palette, no library.
7. Wide content (tables/charts) → `overflowX:'auto'` container; page body never scrolls sideways.
