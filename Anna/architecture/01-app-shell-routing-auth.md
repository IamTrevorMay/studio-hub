---
title: App Shell, Routing & Auth
last_updated: 2026-07-23
tags: [architecture, routing, auth, layout, session, suite]
---

# App Shell, Routing & Auth

How Mayday Studio boots, decides which layout to render, gates on auth, and maps
"page keys" to page components. There is **no react-router** — routing is a
hand-rolled `activeTab` state machine synced to `window.history`.

## Boot sequence (`src/index.js` → `src/App.js`)

- `src/index.js` mounts `<App/>` into `#root`. That's it.
- `src/App.js:19-24` picks the layout + auth chunk **once at boot** based on
  viewport width. Mobile (`≤640px`, `MOBILE_BREAKPOINT_PX` in
  `src/hooks/useIsMobile.js:3`) lazy-loads `AppLayoutMobile`/`AuthPageMobile`;
  desktop loads `AppLayout`/`AuthPage`. Crossing the breakpoint after boot
  forces a full `window.location.reload()` (`App.js:11-17`) — the split is
  decided once, so there is no reactive re-render across breakpoints.
- Provider stack (`App.js:120-130`, outermost → innermost):
  `AuthProvider` → `PresenceProvider` → `NotificationProvider` →
  `ConfirmProvider` → `AppContent`.

### Public routes bypass the auth gate entirely

Checked in `App.js:105-119` **before** any provider mounts:
- `/careers` and `/careers/*` → `pages/public/PublicCareers` (`isCareersPath`).
- `/brief/:slug` → `pages/public/PublicBrief` (`isBriefPath`).

These render with no `AuthProvider`, so a logged-out visitor never touches auth.

### Auth gate (`AppContent`, `App.js:26-83`)

Reads `useAuth()`. Render decision, in order:
1. `loading` → full-screen spinner.
2. `user && !profile` → "trouble loading profile" screen with Retry / Sign Out.
3. `isPasswordRecovery || isInviteSetup` → `<AuthPage/>` (recovery/setup flow).
4. `!(user && profile)` → `<AuthPage/>` (login).
5. Otherwise → `<Layout/>` (the real app).

## Auth provider (`src/contexts/AuthContext.js`)

Custom session management on top of `supabase.auth`. Exposed via `useAuth()`.

### State exposed (`AuthContext.js:444-468`)

| Key | Meaning |
|-----|---------|
| `user`, `profile`, `loading` | Supabase auth user, `profiles` row, boot flag |
| `isAdmin` | `isAdminTier(role)` — admin **tier** (admin + both directors), see below |
| `isStrictAdmin` | `role === 'admin'` exactly |
| `isAssistant` / `isPartner` / `isAgency` / `isFreelancer` / `isProducer` | exact role checks |
| `canPost` | `role === 'admin' \|\| profile.posting_allowed === true` |
| `restrictedNavKeys` | `Set` of nav keys this role cannot see (`getRestrictedNavKeys`) |
| `refreshKey` | integer bumped after WebSocket reconnect; forces channel re-subscribe |
| `signIn` / `signUp` / `signOut` / `updateProfile` / `ensureSession` | actions |

`isAdmin` is **tier-based**, not `role==='admin'`. `isAdminTier` (`src/lib/rolePermissions.js:74`)
returns true for `admin`, `director_creative`, `director_comms`. Directors pass
DB `is_admin()` too — their restriction is UI-only via `restrictedNavKeys`
(`rolePermissions.js:16-43`). Use `isStrictAdmin` when you truly need only `admin`.

### Profile fetch with retry + staged degradation

- `fetchProfile` (`AuthContext.js:78-124`) retries up to 3× with backoff, and on
  a JWT/401 error calls `supabase.auth.refreshSession()` then retries.
- On exhaustion it calls `handleAuthFailure` (`:51-76`): counts consecutive
  failures; attempts a silent `refreshSession()`; after **3** consecutive
  failures it "nukes" the session (`nukeSession`, `:29-48` — wipes `sb-*`
  localStorage keys + `signOut({scope:'local'})`).
- A healthy fetch resets `authFailureCount` to 0 (`:103`) so unrelated blips
  hours apart don't accumulate toward the 3-strike nuke.

### The auth-lock deadlock (critical, `AuthContext.js:231-279`)

`onAuthStateChange`'s callback **must not be async and must not call any
`supabase.*` method directly** — the Supabase auth lock is still held during
the callback, so an awaited Supabase call deadlocks the whole client and the UI
appears frozen after a tab switch or token refresh. Async work (e.g.
`fetchProfile` on `SIGNED_IN`) is deferred via `setTimeout(..., 0)` (`:262-269`).

Companion mitigation: `src/supabaseClient.js:17-26` installs a **no-op lock**
(`noOpLock`) that bypasses `navigator.locks`. Safe for this single-tab app;
eliminates the deadlock class. `flowType: 'implicit'`, storage is `localStorage`,
storageKey is derived from the Supabase hostname.

### Recovery / invite detection (`AuthContext.js:137-155`)

`initAuth` inspects `window.location.hash` **before** processing the session:
- `type=recovery` → `isPasswordRecovery`, don't auto-login.
- `type=invite|signup|magiclink` → `isInviteSetup`, don't auto-login.
`isPasswordRecoveryRef` / `inviteSetupRef` mirror these into refs so the
once-registered `onAuthStateChange` listener reads current values, not the stale
render-0 `false` it closed over (`:20-26`, `:256`).

### Token refresh + WebSocket reconnect on tab return (`AuthContext.js:388-442`)

On `visibilitychange` → visible after **>30s** away (`RECONNECT_THRESHOLD_MS`):
refresh session, `supabase.realtime.setAuth(token)`, `reconnectRealtime()`
(tears down + reopens the socket, `supabaseClient.js:37-52`), re-ping presence,
then bump `refreshKey` so every channel-creating `useEffect` re-subscribes on
the fresh socket. Per-page **data** refresh is handled separately by
`useVisibilityRefresh` (see `06-realtime-notifications.md`).

## Suite routing layer (added 2026-07-23) — launcher / Bridge / Harbor

The app is now the **Mayday Studio suite**: the classic tab world is branded
**Bridge**; **Harbor** (podcast & remote recording) is a real app as of Phase 1
(same day — the coming-soon teaser lived hours). Suite resolution happens
**before** tab resolution, in both layout twins.

### Harbor (Phase 1: live calls, `claude/harbor` branch)

- **Staff routes** (inside the suite, both layouts): `'harbor'` segment renders
  `pages/harbor/HarborApp.js` — a tiny sub-router owning everything after the
  first segment: `/harbor` → `HarborHome.js` (sessions list, create, copy guest
  link), `/harbor/room/<session_id>` → `HarborRoom.js` (pre-join screen → call).
  The layouts' tab→URL effect only compares the FIRST segment, so deeper
  `/harbor/*` paths pushed by HarborApp are never clobbered. `HarborComingSoon.js`
  is deleted.
- **Public guest route**: `/harbor/join/<token>` → `pages/harbor/HarborJoin.js`,
  served in `App.js` before the auth gate (the `/careers` pattern) — no session,
  no providers, no staff chrome. Checked before the layouts ever see the
  `harbor` segment.
- **Architecture**: P2P WebRTC mesh, max 4 participants, no media server.
  `src/lib/harbor/mesh.js` (framework-free mesh manager: perfect negotiation,
  deterministic offerer = lexicographically smaller `client_id`, STUN-only with
  a marked TURN config point) + `src/lib/harbor/signaling.js` (Supabase Realtime
  broadcast wrapper + presence; channel = `harbor:<session_id>:<sha256(guest_token)
  hex[0:16]>` so a session id alone can't find the channel). Shared call UI:
  `pages/harbor/CallStage.js` (used by both HarborRoom and HarborJoin).
- **Data**: `harbor_sessions` / `harbor_participants` / `harbor_tracks`
  (migration `20260723150000_harbor_phase1.sql`). RLS helper `is_harbor_staff()`
  = admin tier + assistant + member. **NO anon policies** — guests go through
  the `harbor-join` edge function (service role; token = credential; bad token
  → 404, capacity 409 at 4, `action:'leave'` stamps `left_at`).
  `participants.state` enum already holds `lobby` for the Phase 3 green-room
  flow.

### Harbor (Phase 2: local recording + progressive upload, `claude/harbor` branch)

- **Model**: every participant records their OWN cam/mic locally
  (`MediaRecorder`, webm vp9→vp8+opus, 5s timeslice, ~2.5Mbps/128kbps caps) and
  progressively uploads chunks to the **private** `harbor-recordings` bucket —
  recording quality never depends on the call. Chunk layout (Phase 4 NAS
  archive walks then purges): `<session_id>/<participant_id>/<track_id>/<idx
  6-padded>.webm`.
- **Engine/transport split**: `src/lib/harbor/recorder.js` (framework-free
  `HarborRecorder`: in-memory queue, sequential uploads, exponential backoff —
  unbounded retries while recording, bounded 10/chunk during post-stop flush;
  `chunkPath()` + `HARBOR_RECORDINGS_BUCKET` live here) +
  `src/lib/harbor/recorderTransports.js` (staff = direct supabase-js under RLS;
  guest = `harbor-track` edge fn, token credential, batched signed upload URLs
  ×60 with low-water background refill; PUTs go straight to storage).
- **`harbor-track` edge fn** (public, `--no-verify-jwt`, mirrors harbor-join
  posture): actions `create` / `upload-urls` / `progress` / `finalize`. Create
  requires a not-ended session; the other three keep working for **6h after
  session end** (uploads outlive the call). Track ownership checked as
  session+participant+track triple; uniform 404s.
- **Producer controls** (CallStage): signaling messages `record`
  `{action:'start'|'stop', target: client_id|'all'}` — honored only if the
  sender's **presence-meta role is 'producer'** (the token-derived channel
  secret is the trust boundary) — and `record-state` rebroadcasts (throttled
  5s) driving REC/upload-health tile badges. Master Record-all + per-tile
  toggles are producer-only; guests see their own REC + "Saving — N behind /
  All safe" state.
- **Unload semantics changed in CallStage**: `beforeunload` now only WARNS
  (when chunks are pending); the destructive leave-beacon + `mesh.close()`
  moved to `pagehide` — teardown-on-beforeunload would have killed the call
  when a user cancels the dialog.
- **Tracks panel**: HarborRoom pre-join screen lists `harbor_tracks` live via
  postgres_changes (table added to the realtime publication in
  `20260723170000_harbor_phase2_recording.sql`); download = fetch chunks in
  order + Blob concat (sequential timeslice chunks of one MediaRecorder
  concatenate into a valid webm).
- **Storage RLS**: staff select/insert/update/delete on the bucket via
  `is_harbor_staff()`; zero anon (verified: anon list = `[]`, download 404,
  PUT 403). Guests only ever write through service-role-minted signed upload
  URLs (created with `upsert: true` so chunk retries can re-PUT).

- Shared logic: `src/lib/suite.js` — `SUITE_LAST_APP_KEY = 'suite_last_app'`
  (localStorage), `getSuiteViewFromPath()` (first segment → `'launcher'` |
  `'harbor'` | `null` = Bridge; bare `/` → launcher unless `suite_last_app
  === 'bridge'`), `rememberBridge()`.
- Both layouts hold `suiteView` state next to `activeTab`. Staff only:
  `isSuiteUser = !isFreelancer && !isPartner` — portal roles are pinned to
  `suiteView = null` at init and in popstate, so a freelancer deep-linking
  `/launcher` still gets their portal.
- Rendering: full-screen early returns (after all hooks, before the sidebar
  shell) to `pages/SuiteLauncher.js` / `pages/HarborComingSoon.js`.
- URL sync: the tab→URL effect is guarded — when `suiteView` is set, the suite
  page owns the URL (`/launcher`, `/harbor`) and tab sync is skipped. popstate
  re-resolves the suite view first, then falls through to tab resolution.
- `suite_last_app` is written **only** when Bridge chrome renders (an effect on
  `suiteView === null`); Harbor and the launcher never write it, so nobody gets
  stranded on the teaser at next login. Explicit `/launcher` always shows the
  launcher regardless of the stored value.
- Branding: staff sidebar header shows **Bridge** + a small "Mayday Studio"
  suite mark (`logoStack`/`logoSuiteMark` styles; same in `MobileDrawer` via
  `suiteBrand` prop). `document.title`: launcher "Mayday Studio", Bridge
  "Bridge · Mayday Studio", Harbor "Harbor · Mayday Studio"; portal roles and
  auth pages stay "Mayday Studio". Switcher: "Apps" button (grid icon) above
  the Admin Mode toggle on desktop; "Apps" row above the mode toggle in
  `MobileDrawer` (`onOpenLauncher` prop).
- Token note: `fontSizes.displayLg: 28` was added to `styleTokens.js` for the
  launcher/teaser hero headlines.

## Routing model — `activeTab` state machine (`src/pages/AppLayout.js`)

There is one string of truth: `activeTab`. It is:
- **initialized** from URL path → localStorage → `'dashboard'` (`AppLayout.js:263-271`),
- **persisted** to `localStorage['studio-hub-tab']` and pushed to
  `window.history` on change (`:358-367`),
- **restored** on browser back/forward via `popstate` (`:370-378`).

### Path ↔ key mapping

- `getTabFromPath()` (`:180-185`) takes the first path segment, applies
  `TAB_KEY_ALIASES` (`{ roadmap: 'business_dev' }`), and validates against
  `VALID_TAB_KEYS` (`:96`).
- `TAB_KEY_TO_PATH` (`:178`) reverses it so `business_dev` shows as `/roadmap`.
- `getSubPathFromURL()` (`:187-190`) reads the **second** segment into
  `navTarget` — the deep-link target passed to pages (e.g. a campaign id for
  Deliverables, a sheet id for Production; see the render block below).

### Page rendering = a big conditional wall

There is no route table. `AppLayout.js:~855-898` is a flat list of
`{activeTab === 'x' && <PageErrorBoundary key="x"><PageX .../></PageErrorBoundary>}`.
Each page gets `navTarget` as a typed prop (`initialCampaignId`, `initialSheetId`,
`initialChannelName`, etc.) and clears it via a callback. Cross-page navigation
uses `navigateTo(tab, target)` (`:445-449`), passed down as `onNavigate`.
Role gates are inline in the same JSX, e.g.
`{isAdmin && activeTab === 'analytics' && <Analytics/>}` (`:876`),
`{(isAdmin || isPartner) && activeTab === 'business_dev' && <BusinessDev/>}` (`:882`).

All page components are **statically imported** at the top of `AppLayout.js`
(`:11-52`) — no per-page lazy loading; only the layout/auth split is lazy.

## Sidebar nav config (`NAV_ITEMS` + `useNavConfig`)

- `NAV_ITEMS` (`AppLayout.js:61-94`) is the hardcoded catalog: `{ key, label,
  icon, adminOnly?, external? }`. Labels are **aliased** from route keys — e.g.
  `production` displays as "Beat Sheet", `business_dev` as "Roadmap",
  `research` as "News", `freelancers` as "Contractors" (`:57-60`).
- `useNavConfig` (`src/hooks/useNavConfig.js`) loads a single `nav_config` row
  from Supabase (admin-editable order + folders), subscribes to its `UPDATE`
  events, and merges DB config with `NAV_ITEMS`:
  - items in code but not config are appended (new pages auto-appear),
  - items in config but removed from code are skipped,
  - `getResolvedNav(navItems, isAdmin, isPartner, isFreelancer, profile, restrictedNavKeys)`
    (`useNavConfig.js:90`) produces the ordered `{type:'item'|'folder', ...}` array.
- The subscription rebuilds on `refreshKey` change (`useNavConfig.js:30,66`) so
  the channel doesn't go stale after a tab-away reconnect.

### Locked portals (early nav returns, `useNavConfig.js:93-120`)

- **Freelancer** (`isFreelancer`): fixed sidebar — Dashboard, (Assignments if a
  drive folder is assigned), Submit, Resources, Assets, Documents, Channels,
  Messages, Profile, Notifications. `fl_*` keys.
- **Partner** (`isPartner`): two-item sidebar — Dashboard + Roadmap only.

These bypass the DB nav config entirely.

## Admin Mode vs Work Mode (`AppLayout.js`)

A bottom-of-sidebar toggle (`toggleMode`, `:344-352`) flips `mode` between
`'work'` (default) and `'admin'`, persisted in `localStorage['studio-hub-mode']`.
Non-admins are pinned to Work Mode (`:294-296`).

- `ADMIN_PAGE_KEYS` (`:112`): pages that live **only** in Admin Mode and vanish
  from Work View — `payroll, analytics, tracking, accounting, business_dev,
  freelancers, workflows, jobs, invoicing, ops` + beta keys.
- `ADMIN_ESSENTIAL_KEYS` (`:114`): everyday anchors kept at the **top** of Admin
  Mode too — `dashboard, projects, calendar, deliverables, channels, messages`.
- `buildAdminNav` (`:133-147`): essentials + divider + `ADMIN_PAGE_NAV` +
  (Beta folder if beta owner).
- `buildWorkNav` (`:162-173`): strips `ADMIN_PAGE_KEYS`, retires the empty
  "Core Team" folder, drops empty folders.
- Switching modes redirects if the current tab isn't valid in the target mode
  (`:347`, `:350`).

### Beta pages (`AppLayout.js:99-110`)

`broadcast, timeline, graphics, mailer` are visible **only** to `BETA_OWNER_EMAIL`
(`trevormayofficial@gmail.com`), inside a collapsed "Beta" folder in Admin Mode.
No other role — including other admins — sees them anywhere.

### External / Triton nav items

Items marked `{ external: { url } }` open in a new tab; `{ external: { triton } }`
call `openTritonTool` (`:195-211`) which invokes the `triton-link` edge function
for a short-lived SSO link into Triton Apex (`https://www.tritonapex.io`).

## Agency portal — REMOVED (drift note, 2026-07-23)

Commit 9b877341 replaced the agency portal with the **public, login-free**
`pages/public/PublicDeliverables.js`, served before the auth gate in
`App.js:107-109,126-132` for `/deliverables(\/|$)`. `isAgency`/`AgencyPortal`
no longer exist anywhere in `src/` (neither layout, nor `rolePermissions.js`,
nor `AuthContext.js`). The only portal roles inside the layouts today are
**freelancer** (locked nav + redirect effect) and **partner** (two-item nav).
**Landmine:** the internal `deliverables` tab still pushes `/deliverables`, so
a staff reload on that URL lands on the public page — see
`debugging/02-known-issues-gotchas.md` (l).

## Mobile layout (`src/pages/AppLayoutMobile.js`, 745 lines)

- Same `NAV_ITEMS` source of truth, kept in sync with desktop intentionally
  (`AppLayoutMobile.js:42-45`, `VALID_TAB_KEYS` at `:72`).
- Same `activeTab` model, localStorage + `history.pushState` sync (`:180-186`),
  same `isAgency` early return (`:321`), same freelancer/restricted redirects.
- `renderActiveTab(...)` (`:382`) is the mobile render wall; `isExcludedOnMobile`
  (`:384`) drops desktop-only pages (heavy editors/tools) on phones.
- Bottom nav / drawer UI instead of a persistent sidebar; top bar shows
  `TAB_LABELS[activeTab]` (`:152`, `:318`).

## Gaps / notes

- Desktop and mobile `NAV_ITEMS` / `VALID_TAB_KEYS` are duplicated and must be
  hand-kept-in-sync (comment at `AppLayoutMobile.js:42`). Adding a page means
  editing both files' render walls.
- `my_tasks` is a legacy key aliased to `dashboard` in three places
  (`AppLayout.js:265,268,446`); My Tasks content lives inside Dashboard now.
