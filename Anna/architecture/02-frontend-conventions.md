---
title: Frontend Conventions
last_updated: 2026-07-15
tags: [architecture, frontend, styling, hooks, conventions]
---

# Frontend Conventions

The house style for React code in this repo. These are load-bearing — deviating
breaks the ESLint style rule and the visual consistency the whole app leans on.
Deeper topics have their own docs under `Anna/frontend/`.

## Styling: inline `style={}` objects only

- **No Tailwind classes in JSX.** The only place Tailwind runs at all is the
  `doc-editor` Tiptap editor — `craco.config.js:20` gates `@tailwindcss/postcss`
  to files whose path includes `doc-editor`; everything else gets plain PostCSS.
  Do not add `className="flex ..."` to app pages.
- Every page defines a `const styles = { ... }` object at the **bottom of the
  file** and references `style={styles.foo}`. Examples:
  `Deliverables.js:2994`, `Dashboard.js:2209`, `Projects.js:1340`.
- Dynamic styles spread the base then override:
  `style={{ ...styles.navItem, ...(active ? styles.navItemActive : {}) }}`
  (pattern used throughout `AppLayout.js`).
- Module-level **color-constant objects** hold status/category palettes, e.g.
  `STATUS_COLORS`, `EVENT_TYPE_COLORS`, `NETWORK_TO_COL_KEY`
  (`Tracking.js:59`), `Ops.js` `STATUS_COLORS`. Defined at the top of the file
  as `const NAME = { key: '#hex', ... }`.

### The design-token system (preferred for new code)

New code **must** use tokens + recipes rather than hardcoded hex/px values.
Enforcement is the standalone lint script `npm run lint:styles` →
`scripts/lint-styles.js` (`package.json:76`), which flags hardcoded hex/rgba and
off-scale spacing/radii/font-size literals in `style={}` / `const styles`
objects. **Note:** `styleTokens.js:4` also references an ESLint rule
`mayday/no-style-magic-numbers`, but that rule is **not** wired into any eslint
config on disk — the `lint:styles` script (not ESLint) is the real check, and
style is otherwise review-enforced.

- `src/lib/styleTokens.js` — single source of truth for palette, spacing, radii,
  font sizes/weights, shadows, transitions. Import `{ colors, spacing, radii, ... }`.
  - Dark theme: `colors.bg = '#0f0f1a'`, raised surfaces are
    `rgba(255,255,255,0.04..0.06)`, text uses `rgba(255,255,255,α)` where alpha
    conveys hierarchy (`text`/`textMuted`/`textSubtle`/`textDim`).
  - Accent is indigo `colors.accent = '#6366f1'`. Semantic tones
    (`success`/`warning`/`danger`/`info`) each ship `{ bg, border, fg }` triples
    for consistent badges/pills.
- `src/lib/styleRecipes.js` — reusable style **factories** built from tokens:
  `card(variant|opts)`, `pill(tone)`, `badge(tone)`, `button({variant,size})`,
  `input({size})`, `sectionHeader(level)`, `modalOverlay()`, `modal({width})`
  (`styleRecipes.js:34-237`). Prefer extending a recipe over hand-rolling a
  card/pill/input shape per page.

> Older pages predate the token system and use hardcoded values in their
> `styles` object. That's the legacy pattern — match tokens in new code, don't
> mass-rewrite old pages unasked.

### Global CSS (`src/App.js:176-197`)

A single injected `<style>` element defines the `spin`/`pulse` keyframes,
imports **DM Sans** from Google Fonts (`@import url(...DM+Sans...)`), sets
`body { background:#0f0f1a }`, styles the scrollbar, and darkens native
`select`/`date` widgets. DM Sans is the app font, referenced as
`"'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif"`.

## State management

- **`useState`-heavy.** Most UI state is component-local `useState`; large pages
  hold dozens. There is no Redux. `zustand` is a dependency
  (`package.json:66`) but used narrowly (e.g. editor/tool local stores), not as
  app-global state.
- **Contexts** are limited to cross-cutting concerns: `AuthContext`,
  `NotificationContext`, `PresenceContext`, `ConfirmContext` (`src/contexts/`).
- **Supabase Realtime** subscriptions drive live updates (presence,
  notifications, channels, nav config). See `06-realtime-notifications.md`.

## The custom hooks (`src/hooks/`)

| Hook | Purpose |
|------|---------|
| `useSupabaseQuery` (`useSupabaseQuery.js`) | `safeQuery(fn)` wrapper: on a JWT/`PGRST301`/401/403 error, refreshes the session and retries the query **once**. Use for reads that must survive a stale token. |
| `useVisibilityRefresh` (`useVisibilityRefresh.js`) | Calls `onRefresh()` once per blur→focus cycle when the tab/window regains focus. Gated so in-page clicks never trigger it. The standard "re-fetch on tab return" primitive per page. |
| `useNavConfig` (`useNavConfig.js`) | Loads/saves/subscribes the sidebar nav config; `getResolvedNav(...)` merges DB order with code `NAV_ITEMS`. See `01-app-shell-routing-auth.md`. |
| `useRealtimeTable` (`useRealtimeTable.js`) | Subscribe to `postgres_changes` for one table with `onInsert/onUpdate/onDelete/onAny` callbacks + exponential-backoff resubscribe on `CHANNEL_ERROR`/`TIMED_OUT`. |
| `useIsMobile` (`useIsMobile.js`) | `isMobileViewport()` boot check (for the App.js lazy split) + reactive `useIsMobile()` hook. Breakpoint `640px`. |
| `usePersistedTab` (`usePersistedTab.js`) | `useState` drop-in for a page's sub-view that survives refresh; stores under `tab:<key>` in localStorage, guarded by an optional `validValues` allowlist. |
| `useReadOnlyOnMobile` (`useReadOnlyOnMobile.js`) | Flags pages that are view-only on phones. |
| `useUsageTracking` (`useUsageTracking.js`) | TEMP clickstream tracker for the FE revamp study; no-op outside production. Slated for teardown (see project memory). |

## Page-level conventions

- **Pages are large single-file components** (100–200KB). See `03-page-catalog.md`.
  Read specific line ranges, never the whole file.
- Every routed page is wrapped in `<PageErrorBoundary>` at the render site
  (`AppLayout.js`) — a page crash shows a boundary, not a white screen.
- Deep-link props follow the convention `initialXId` (in) + `onXOpened`
  (clear-out callback) so `navTarget` from the URL flows to the page once.
- Cross-page navigation goes through the `onNavigate={navigateTo}` prop, not
  direct history manipulation.
- Display names: use `getDisplayName` / `getDisplayInitial` from
  `src/lib/displayName.js` — `full_name` for admin-facing UI, `nickname` for
  social. Never read `profile.full_name` directly for social surfaces.
- PT-vs-UTC date boundaries: use `src/lib/ptDate.js` helpers, not raw
  `new Date()` day math — daily metrics/snapshots key on the PT calendar.

## Pointers to deeper docs

- `Anna/frontend/` — component patterns, the style system in depth, editor
  internals (Tiptap doc-editor, screenplay-editor, Whiteboard/Canvas).
- `06-realtime-notifications.md` — realtime subscription + notification patterns.
- `03-page-catalog.md` — what each page is and where to look inside it.
