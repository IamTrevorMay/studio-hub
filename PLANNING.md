# Mayday Studio — Planning

## Recently Completed

### Mailer Phase 4 (2026-06-13)

Full Phase 4 port of the Mailer tool from Triton. Admin-only newsletter
system: block-based editor with live preview, audiences, scheduled sends,
open/click tracking, Resend webhooks, sender domain verification, CSV
subscriber import, suppression list, per-campaign stats.

**Phase 4a — Foundation** (commit `619b5542`)
- 8 tables (`mailer_audiences`, `mailer_subscribers`, `mailer_audience_subscribers`, `mailer_campaigns` w/ jsonb `blocks`, `mailer_sends`, `mailer_events`, `mailer_suppressions`, `mailer_sender_domains`) + admin-only RLS + `is_admin()` helper + `mailer_bump_stat()` RPC for atomic counter updates
- Edge functions: `mailer-send-now` (batch via Resend, suppression filter, per-recipient audit rows), `mailer-webhook` (Svix signature verify, status mapping, auto-suppress on bounce/complaint), `mailer-track-open` (1×1 gif w/ dedup), `mailer-track-click` (302 redirect w/ http/https allowlist), `mailer-unsubscribe` (GET confirm page so antivirus scanners don't auto-unsubscribe + POST one-click for Gmail List-Unsubscribe), `mailer-cron-tick` (atomic claim of due scheduled campaigns)
- Shared: `resend.ts` REST wrapper + `mailer-render.ts` block-tree → HTML/text renderer
- UI shell: 4-tab admin page (Campaigns / Audiences / Subscribers / Sends), CRUD wired to tables, status pills, modal editor (initially with raw-JSON blocks textarea)

**Phase 4b — Block editor, CSV, stats, settings** (commit `<pending>`)
- `BlockEditor.js` — visual block list with per-type inline forms (heading / paragraph / image / button / divider / spacer / html), reorder ↑↓, delete, add-block palette
- `CampaignPreview.js` — sandboxed iframe live preview via `srcDoc`
- `blockRenderer.js` — client-side JS mirror of the Deno renderer (kept in sync)
- `CampaignStats.js` — tile dashboard (recipients/delivered/opened/clicked/bounced/complained with %), top clicked URLs leaderboard, recent events log, cohort table
- `CsvImportModal.js` — small RFC4180-ish CSV parser, audience attach, upsert preserves existing subscriber status (re-import never un-suppresses)
- `SettingsPane.js` (new tab) — sender domains CRUD w/ DNS record display + verify, suppression list w/ remove
- Campaign editor rewrite: 3-pane modal (content / settings / stats), datetime-local scheduler, Schedule button flips status to `scheduled`
- `mailer-domain` edge fn — Resend `/domains` proxy (add/verify/remove)
- `cron_mailer_tick` migration — pg_cron `mailer-tick` job every minute, reads `CRON_SECRET` from Vault, POSTs to `mailer-cron-tick`

**Deploys / env still needed**
- `supabase functions deploy mailer-send-now mailer-webhook mailer-track-open mailer-track-click mailer-unsubscribe mailer-cron-tick mailer-domain --no-verify-jwt`
- Secrets: `RESEND_API_KEY`, `MAILER_DEFAULT_FROM`, `MAILER_WEBHOOK_SECRET` (Svix `whsec_…`), `MAILER_PUBLIC_URL` (Supabase project URL)
- Resend dashboard: create webhook → POST to `<project>/functions/v1/mailer-webhook`, subscribe `email.*`
- Confirm `CRON_SECRET` is in Vault (already used by other cron jobs)

### Broadcast hardening (2026-06-12 → 2026-06-13)

Full review pass on the Broadcast page (`src/pages/tools/Broadcast.js` + `src/pages/tools/broadcast/*` + `api/broadcast/*`). 5 critical / 17 high / 6 medium / 5 verify findings closed across commits `c7a24bc8`, `26d171a8`, `29ae8eea`, `379341e0`.

**Security**
- OBS WebSocket password no longer persisted to localStorage (leak grants remote control of user's OBS) — kept in component state only; one-time scrub of legacy entries.
- `api/broadcast/upload`: stopped echoing caller's own JWT back; client attaches Authorization locally.
- `api/broadcast/sessions`: bumped `randomSlug` 6 → 16 base36 chars (~82 bits) so overlay URL isn't brute-forceable.
- `api/broadcast/assets` + `sessions`: explicit security comments confirming public GET is intentional (overlay runs inside OBS browser source with no auth).
- `LivePreview.js` iframe sandboxed (`allow-scripts` only, opaque origin) so overlay can't reach producer console DOM/cookies.
- `OBSSettings.js` inputs: `autoComplete="off"` so browser credential managers don't save the OBS WebSocket password.

**Correctness**
- Realtime channels now `channel.unsubscribe()` before `removeChannel` (was leaking handlers).
- `api.js` `request()` + `trigger()` accept `opts.signal`; `trigger()` now checks `response.ok` instead of silently parsing error JSON.
- `useObs`: `connectTokenRef` invalidates in-flight `connect()` on cred change / unmount.
- `AssetLibrary`: capture `project.id` at dispatch time so uploads can't land in the wrong project; per-upload AbortController + mountedRef guard.
- `TemplateDataPanel`: 400ms debounce + AbortController per save; asset switch and unmount cancel pending PATCHes.
- `api/broadcast/trigger`: state update guarded `.eq('is_live', true)` + row-count check → 409 if session went offline mid-flight.
- `ScenesPanel` / `ClipMarkerPanel` / `MembersPanel`: explicit snapshot rollback on optimistic update failures.
- `LiveControlGrid:35`: wrapped `(a.hotkey_color || on)` (precedence bug — unselected no-color tiles were grabbing `colors.text`).
- `useStreamDeck`: track + remove device `.on('down'/'up'/'error')` listeners on re-attach + close + unmount.
- `OBSSettings`: scoped effect deps to `obs.status` + memoized `obs.call` (was re-running every parent render).
- `AssetProperties`: replace `JSON.stringify` equality with `EDITABLE_KEYS` shallow compare; gate post-PATCH state update on `activeAssetIdRef` so a save started for asset X can't paint a "Saved" badge against asset Y.
- `AssetsPanel`: snapshot selection before `load()` in both `onCreated` and `onSaved` — user's manual selection mid-flight isn't clobbered by the freshly-uploaded/saved row.
- `tusUpload`: detach the AbortController `abort` listener once the upload settles.

**Dev infrastructure** (commit `c028f966`)
- `api/server.js` auto-mounts every Vercel-style handler in `api/broadcast/*` at `/api/broadcast/<file>` so local dev hits the same code path Vercel runs in prod.
- `src/setupProxy.js` (new) forwards `/api/*` from CRA dev (`:3000`) to the Express backend (`:4400`). Local 404s on broadcast routes were caused by both gaps.

### Contractor Assignment UX Enhancements (2026-05-29)
Added three new capabilities to FreelancerDashboard.js for in-progress assignments:

1. **In Progress indicator** — Yellow badge replaces the old "Mark Complete" button when assignment is `in_progress`.
2. **Submit button** — Opens a Google Drive upload modal (reuses `drive-upload-init` edge function pattern). Uploads to contractor's `assigned_drive_folder_id` or falls back to shared `SUBMISSIONS_FOLDER_ID`. After successful upload, captures the Drive file ID from XHR response, constructs the view URL, saves it as `asset_url` on the assignment. Button turns green with checkmark; clicking green Submit auto-completes the assignment.
3. **I'm Stuck button** — Opens an inline text input asking "What are you stuck on?" Posts the message as an assignment comment (prefixed with construction emoji) and sends `fl_stuck` notifications to all admins.

New flow: `assigned → [Start Working] [Decline]` → `in_progress → [● In Progress] [Submit] [I'm Stuck]` → after upload → `[● In Progress] [✓ Submit (green)] [I'm Stuck]` → click green Submit → `completed`.

Hourly contractors still get the hours modal on green Submit click before completion.

### Backend Audit (2026-05-27)
Fixed 12 issues across 11 edge functions, all deployed:

**Critical (fixed)**
- Input sanitization for Drive query injection in `drive-list-clips`, `google-drive-resources`
- Swallowed error on YouTube `audience_snapshots` upsert in `sync-metricool`
- Hardcoded Claude model name in `generate-trends` (now uses `CLAUDE_MODEL` env var)

**Medium (fixed)**
- `shared/utils.ts`: ingestion log updates now check for errors; duplicate detection uses Postgres error code `23505`
- `invite-user`: invitation insert switched from `userClient` to `adminClient` (RLS fix)
- `sync-youtube`: channel slug derived dynamically instead of hardcoded map
- `metricool-create-post`: warns when image normalization returns no mediaId
- `run-report`: quoted UUID in `.or()` filter; hardcoded model name fixed (2 places)
- `drive-upload-init`: Origin header parsed via `new URL()` instead of raw Referer passthrough
- `google-auth-callback`: state param validated with try/catch + type checks

### Calendar Bug Fix (2026-05-27)
Recurring events now appear on any month. Root cause: DB query filtered by `start_date`/`end_date` overlap, excluding recurring events whose original dates were in a prior month. Fix: `or` filter fetches all recurring events regardless of date range.

### Profile Deletion FK Fix (2026-05-25)
Fixed `NO ACTION` FK constraints on `payroll_salaries` and other tables blocking profile deletion. Converted to `ON DELETE CASCADE` / `SET NULL`.

### YouTube Studio Advanced (2026-05-27)
New pages: `ContentHealthDashboard.js`, `YouTubeStudioAdvanced.js`. New edge functions: `sync-youtube-dimensions`, `backfill-youtube-dimensions`. Migration: `20260527000000_yt_studio_advanced.sql`.

### Contractor System (2026-05-25 → 2026-05-29)
Renamed Freelancer to Contractor in admin panel. Added document signing (`DocumentSigner.js`, `DrawingPad.js`), assigned Drive folders, and contract upload flow. Multiple migrations for freelancer tables, notifications RLS, invitation signing flag, and signature columns. Later added edit/delete UI for assignments, and Submit/In Progress/I'm Stuck UX for contractor dashboard.

## Planned

### Near-term
- Supabase CLI update (v2.95.4 → v2.101.0)
- `CLAUDE_MODEL` env var should be set in Supabase dashboard to pin model versions across `generate-trends`, `run-report`

### Pending — Ops page not showing updates (2026-06-11)

Ops dashboard remains stale — no fresh ingestion/sync/edge-function activity
showing despite recent runs. Need to audit:
- Whether the data sources (ingestion_runs, ingestion_logs, edge function
  invocations) are actually being written.
- Whether the page query filters are dropping recent rows.
- Whether realtime subscriptions on the Ops page are bound to the right
  channels.

### Pending — Missing team members from Workflows Team Section (2026-06-11)

Workflows page Team Section is missing three profiles that should appear:
- **Trevor May (CEO)**
- **Emily Jude**
- **Ethan Jones**

Likely culprit is the `TEAM_ROLES` filter in `src/pages/Workflows.js`
(`teamProfiles` useEffect) — it filters by `role IN (...some allowlist...)`.
Whatever role these three profiles have isn't in the allowlist. Audit:
1. Pull profiles.role for each missing user.
2. Confirm whether `TEAM_ROLES` should add their role or whether their role
   is wrong in DB.
3. Decide whether owners/leadership should always render in Team Section
   regardless of role.

### Done — Wire Projects board progress into Workflows Team + Contractors sections (2026-06-12)

Workflows Team + Contractors sections now append project cards under each
person's row. `project_stage_assignments` joined to `projects` filtered to
`stage = projects.status AND archived_at IS NULL` → blue dot + "PROJECT" badge
under tasks-based mirror (PROJECTS sub-list). Done · 7d picks up project rows
where `projects.archived_at` falls within last 7 days. Tasks remain primary.

### Done — Contractor-assignment auto-complete hooks (Mayday Kanban port, 2026-06-12)

Migration `20260612200000_contractor_assignment_auto_complete_hooks.sql`
installs two SECURITY DEFINER trigger functions on `freelancer_assignments`:

- `auto_complete_film_on_assignment_insert` — fires AFTER INSERT. Closes open
  `film` tasks for the project when a contractor assignment is created.
- `auto_complete_edit_on_assignment_complete` — fires AFTER UPDATE OF status.
  Closes open `edit` tasks when the assignment transitions to `completed`.

Scope (all conditions must match):
- `projects.type = 'mayday_video'`
- `freelancer_assignments.assignment_type = 'edit'`
- `projects.status` matches the stage being closed (`film` / `edit`)

Each closed task fans out one `task_assigned` notification to its assignee
mirroring the `card-move` pattern. `card-move`'s mayday_video stage
descriptions + `src/lib/kanbanStages.js` updated to drop the (TODO) markers.

### Unified Content Kanban (locked spec, 2026-06-10)

Replace Projects page Kanban with a type-aware unified board for all content projects. Disable workflow-instance creation + automation triggers while developing (nav stays; in-flight runs continue).

**Project types (4)** — collapses existing 10
- `mayday_video` → More Mayday
- `tm_baseball_video` → Trevor May Baseball
- `podcast`
- `short_form`

Channel field dropped (derived from type). AWA Wiffle retired.

**Columns** — shared canonical (6), type-specific labels (Map A, verb-leaning)

| Canonical | Mayday  | TM Baseball | Podcast | Short Form |
|-----------|---------|-------------|---------|------------|
| Idea      | Idea    | Idea        | Idea    | Idea       |
| Write     | Script  | Script      | Outline | Concept    |
| Produce   | Shoot   | Shoot       | Record  | Capture    |
| Edit      | Edit    | Edit        | Edit    | Cut        |
| Review    | Review  | Review      | Review  | Review     |
| Publish   | Publish | Publish     | Publish | Publish    |

**Assignment + tasks**
- Reuse `project_stage_assignments(project_id, stage, user_id)` — N assignees per stage allowed.
- Card enters column → one task per assignee (N tasks). Title: `{project name} — {column label}`.
- No manual complete; tasks close atomically on card move.
- Notif: task-creation notif only (drop legacy column-change notif).

**Carry-forward to next task**
- Rolling notes thread (all prior columns).
- Hold reason (if recently held).
- Outgoing-assignee handoff note (optional input on exit).
- Previous-column outputs (links/files).
- Card-level due date.

**Drag rules**
- Forward: current column assignees + admins.
- Backward: admin only. Closes current tasks; creates fresh tasks for prior-column assignees.
- Type change mid-flight: relabel column in place, retitle open tasks. Card stays put.

**Hold**
- Sidecar lane on right edge, collapsible. Admin-only hold/unhold with required reason.
- Storage: `projects.on_hold bool` + `projects.hold_reason text`.
- Open tasks suspended (no nag) while held.

**Sort within column**: auto by due date ascending. Drag only changes columns.

**Publish terminal**: stay current week; Monday 00:00 PT cron archives to `projects.archived_at`; "Published" expander shows archived.

**Visibility**: admin + assistant + member. Contractors: no board; get auto-generated tasks in portal as today.

**Doc linkage**: card surfaces "Open" buttons for `write_doc_id` / `beat_sheet_id` / `ad_read_id`. No auto-create.

**New project create**: form has "Start at column" dropdown (default Idea).

**Migration**

Type collapse:
- `youtube_video` → `mayday_video` (default)
- `short_form` / `podcast` → unchanged
- `social_post`, `substack_article`, `sponsorship`, `collaboration`, `documentation`, `administration`, `other` → NULL (admin re-tag tray)

Status collapse (creative): concept→Idea, script→Write, production→Produce, edit→Edit, review→Review, published→Publish.

Status collapse (legacy shorts): editing→Edit, ready_to_post→Review, posted→Publish.

Re-tag UX: persistent yellow banner above board (`N projects need a type`) → modal w/ type picker. Banner disappears at zero.

**Unplug Workflows**
- Disable workflow-instance creation endpoints + UI buttons.
- `automations.is_enabled = false` where actions include workflow-creating step.
- Workflows sidebar nav stays.
- In-flight `workflow_instances` continue to completion.

**Key touchpoints**
- `src/pages/Projects.js` — gut Kanban; rebuild as type-aware board.
- `src/pages/Workflows.js` — disable creation paths + UI.
- `supabase/functions/run-automations/index.ts` — gate workflow-creating actions.
- New columns: `projects.on_hold`, `projects.hold_reason`, `projects.archived_at`, `projects.start_column`.
- New tables: `project_card_notes` (rolling thread per column), `project_card_handoffs` (exit notes per transition).
- New edge fns: `card-move` (server-side fan-out + carry-forward + RLS check), `archive-published-cards` (Monday cron).
- New migration: `projects.type` CHECK constraint update to 4 values after backfill.

**Phasing**
1. Schema + migration (columns, new tables, backfill, re-tag banner).
2. Unplug workflows.
3. Backend (`card-move` edge fn, server task fan-out, carry-forward).
4. Board UI rebuild (desktop).
5. Archive cron + Publish expander.
6. Cleanup dead workflow paths.

Mobile swipe view tracked in the **Mobile View** section below.

### Long-term
- **Business Dev Page** — Full spec written (in CLAUDE.md), not yet built. Four-level hierarchy: Phase > Workstream > Initiative > Task. Four views: Phases, Timeline/Gantt, Calendar, My Stuff. Tables: `bd_phases`, `bd_initiatives`, `bd_initiative_links`, `bd_tasks`, `bd_milestones`, `bd_settings`.
  - Deferred from v1: Comments/discussion threads, file attachments, budget rollup view, non-admin owners and visibility, MyBoard/personal_tasks integration, email reminders
- Consider converting remaining enums to text + check constraints (proven pattern)

---

## Mobile View

Everything mobile-specific lives here. The mobile build is a parallel set of
`*Mobile.js` page components selected at the 640px viewport breakpoint.

### Done
- **Mobile bundle split recovery** — `App.js` listens via `matchMedia` and reloads when the viewport crosses the 640px breakpoint after boot, so the desktop/mobile bundle split doesn't strand the user on the wrong build.

### Pending
- **Unified Content Kanban — mobile swipe view** — Vertical scroll one column at a time, swipe between columns, long-press menu replaces drag. Last phase of the Unified Kanban rollout (desktop board shipped; mobile view not yet built). Touchpoint: `src/pages/ProjectsMobile.js`.

### Mobile-paired pages
- `AuthPage.js` ↔ `AuthPageMobile.js`
- `AppLayout.js` ↔ `AppLayoutMobile.js`
- `Projects.js` ↔ `ProjectsMobile.js`

When adding a feature to a desktop page that has a mobile counterpart, mirror the change (or explicitly note that mobile is deferred).

---

## Infrastructure & Architecture Improvements

Based on inefficiency report review (June 2026). Items are grouped by phase; each was either agreed-upon from the report or identified as an additional recommendation during review.

### Phase 0 — Immediate Correctness & Security

| Item | Source | Status | Notes |
|---|---|---|---|
| Fix More Mayday YouTube sync | Report #20 | **In progress** | Code is correct — YouTube API returns the same 167 video IDs. Added freshness detection: API error checking in `fetchAllVideoIds`, staleness warnings when no new videos found, `newest_content_at`/`total_api_videos`/`existing_db_videos` metadata on ingestion logs. Root cause is external (stale API response or quota). Deploy updated `sync-youtube` and monitor. |
| Rotate hardcoded `CRON_SECRET` | Report #18 | **Done** | Rotated in migration `20260512130000`, moved to Supabase Vault in `20260601140000`, sync jobs switched to header-based auth in `20260601150000`. |
| Deploy staged Goals fixes | Report #22 | **Done** | All three fixes live in `YearlyGoalsSection.js`: `reel` filter (line 288), auth header on metricool-posts (line 262), channel names in Monthly Results (lines 876-882). |
| Fix "Total Short Form Posts" goal configuration | Report #21 | **Done** | Updated `monthly_goals` to include YouTube (Trevor May Baseball + More Mayday), Instagram, and TikTok platform account IDs. |

### Phase 1 — Stabilize Platform Infrastructure

| Item | Source | Notes |
|---|---|---|
| Split AuthContext into smaller providers | Report #3 | 692-line context owns auth, session, profile, presence, realtime, notifications. Split into AuthSessionProvider, ProfileProvider, PresenceProvider, NotificationProvider, RealtimeProvider with focused hooks (`useSession`, `useProfile`, `usePermissions`, `usePresence`, `useNotifications`). |
| Replace session nuking with staged degradation | Report #5 | Profile fetch failure after 3 retries currently nukes the session. Replace with: 0-4s loading → 4-10s reconnecting/degraded → 10s+ "profile unavailable" with retry + sign out option. Only nuke on definitively invalid/revoked token. |
| Server-side notification summary RPC | Report #6 | Move badge count logic out of AuthContext. Create a `getNotificationSummary(userId)` RPC that returns all counts in one call. Realtime updates invalidate cached summary instead of each badge source maintaining its own fetch/subscription. |
| Edge Function standardization (`createFunction` wrapper) | Report #16 | Create a shared wrapper with explicit auth modes (`public`, `user`, `admin`, `cron`, `cron-or-admin`, `webhook-signed`), input validation, structured logging, request IDs, error formatting, timeout/retry policy, and rate limiting. |
| Build ingestion control plane | Report #19 | Tables: `source_accounts` (platform, status, token_status, last_success_at, last_data_seen_at), `ingestion_runs` (records_fetched/inserted/updated/skipped, newest_source_item_at, error), `ingestion_alerts`. Dashboards show freshness per source. |
| Build Ops dashboard | Report #46 | Internal admin page showing: sync health, external API quota/token health, latest ingestion runs, edge function errors, cron run status, automation failures, public endpoint abuse/rate limits, realtime connection health, known issue status. |
| Add rate limiting to authenticated edge functions | Additional | Currently only public endpoints have rate limiting. Authenticated functions (especially admin-triggered syncs, bulk operations) should have basic rate limiting to prevent accidental abuse. |
| Fix `reconnectRealtime()` hardcoded 150ms delay | Additional | Uses a fixed 150ms `setTimeout` before reconnecting. Should use exponential backoff with jitter to avoid thundering herd on infrastructure issues. |

### Phase 2 — Reduce Frontend Maintenance Cost (Completed 2026-06-08)

| Item | Source | Status | Notes |
|---|---|---|---|
| Add error boundaries on pages | Additional | **Done** | Created `PageErrorBoundary` component, wrapped all ~46 page entries in `AppLayout.js`. |
| Enable strict CI | Additional | **Done** | Flipped `CI=false` → `CI=true` in build script. Added `ignoreWarnings` for node_modules Critical dependency warnings in `craco.config.js`. |
| Standardize realtime subscriptions (`useRealtimeTable`) | Report #11 | **Done** | Created `src/hooks/useRealtimeTable.js` with per-event handlers, exponential backoff retry, and ref-based stale closure prevention. Pilot-migrated `FreelancerDashboard.js` (4 table subscriptions). Remaining pages can migrate incrementally. |
| Split Analytics.js into feature modules | Report #13 | **Done** | Decomposed 3,290-line monolith into `src/pages/analytics/` directory: `Analytics.js` (orchestrator), `constants.js`, `utils.js`, `styles.js`, and 13 components in `components/`. Remaining large pages (Reviews, BusinessDev, Dashboard) can follow the same pattern. |

### Phase 3 — Operational Maturity

| Item | Source | Notes |
|---|---|---|
| Make deployments atomic | Report #44 | Frontend auto-deploys to Vercel on push, but edge functions and migrations are manual. A frontend change can deploy before its migration. Create a release checklist or lightweight pipeline: migrations → edge functions → frontend, with smoke tests at each stage. |
| Document and harden Triton client dependency | Additional | Second Supabase project (Triton, read-only for briefs/cards) is initialized inline with hardcoded URL/key. If Triton goes down, affected pages fail silently. Document which features depend on it, add connection health checks, and consider a fallback/cache strategy. |
| Address Google Drive service account single point of failure | Additional | All Drive functions use one shared service account via `GOOGLE_DRIVE_REFRESH_TOKEN`. If token is revoked or account is disabled, all Drive features break simultaneously. Document the account, set up token health monitoring, and consider a backup credential. |
| Reduce `drive-watch-poll` frequency | Additional | Runs every minute (1440 API calls/day). Most Drive changes don't need minute-level detection. Evaluate whether 5-minute or 15-minute intervals are sufficient, or switch to push notifications via Drive webhooks where possible. |
| Add backup/export strategy for Supabase data | Additional | No documented backup or export strategy. Supabase provides point-in-time recovery on Pro plans, but there's no manual export process for critical tables (financials, projects, content). Set up periodic pg_dump or Supabase backup verification. |

## Known Issues

### Open GitHub Issues
- **#4** — Resources / Google Docs integration
- ~~**#5** — `project_type` enum missing business board values~~ (resolved: Business board removed entirely 2026-06-12)

### Low Priority (from backend audit)
- `backfill-youtube-dimensions/index.ts:3` — inconsistent import path (`./shared/` vs `../shared/`)
- `sync-stripe/index.ts:240-254` — unnecessary braces around upsert
- `sync-metricool/index.ts:210-224` — inconsistent error logging
- `public-subscribe/index.ts:110` — hardcoded Postgres error code `"23505"` as string

### Tech Debt
- `node_modules/` drift in git status (local package versions diverge) — do not commit
- `20260328200001_cron_generate_trends.sql` contains a hardcoded `CRON_SECRET` (mitigated: secret rotated and moved to Vault, but old value remains in git history)
- Orphan remote migration `20260526035022` was reverted from history (tables already created by it exist)
- Pages are large single-file components (100-200KB) — Analytics.js split complete; Reviews.js, BusinessDev.js, Dashboard.js remain

## Architecture Notes

### Critical Patterns (from MEMORY.md)
- **useEffect deps**: always `useCallback` for async functions in dep arrays (infinite render loop otherwise)
- **Auth lock deadlock**: `onAuthStateChange` must be synchronous; defer DB calls via `setTimeout(0)`
- **Enum migrations**: convert to `text` + check constraint (can't `ALTER TYPE` in transaction)
- **Routing**: pages unmount/remount on every nav — initial `useEffect` handles data load
- **Styling**: all inline `style={{}}`, no Tailwind classes

### Key Files
- `src/pages/AppLayout.js` — routing, sidebar, page mounting, SubmitModal (Google Drive upload)
- `src/contexts/AuthContext.js` — auth, profile, notifications
- `src/hooks/useVisibilityRefresh.js` — tab restore refresh
- `src/hooks/useSupabaseQuery.js` — safe query wrapper with auth retry
- `src/pages/FreelancerDashboard.js` — contractor-facing dashboard with assignments, Submit modal, I'm Stuck flow
- `src/pages/Freelancers.js` — admin-facing contractor management
- `supabase/functions/shared/utils.ts` — shared ingestion log, upsert, retry helpers
- `supabase/functions/drive-upload-init/index.ts` — Google Drive resumable upload init (used by AppLayout + FreelancerDashboard)

## Open Risks

- Supabase CLI outdated (v2.95.4 vs v2.101.0 available) — potential compatibility issues
- Pages are large single-file components (100-200KB) — maintainability risk as complexity grows
- `CRON_SECRET` hardcoded in a migration file
