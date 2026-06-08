# Mayday Studio — Planning

## Recently Completed

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
- `project_type` enum needs business board values added (issue #5)
- Supabase CLI update (v2.95.4 → v2.101.0)
- `CLAUDE_MODEL` env var should be set in Supabase dashboard to pin model versions across `generate-trends`, `run-report`

### Long-term
- **Business Dev Page** — Full spec written (in CLAUDE.md), not yet built. Four-level hierarchy: Phase > Workstream > Initiative > Task. Four views: Phases, Timeline/Gantt, Calendar, My Stuff. Tables: `bd_phases`, `bd_initiatives`, `bd_initiative_links`, `bd_tasks`, `bd_milestones`, `bd_settings`.
  - Deferred from v1: Comments/discussion threads, file attachments, budget rollup view, non-admin owners and visibility, MyBoard/personal_tasks integration, email reminders
- Consider converting remaining enums to text + check constraints (proven pattern)

---

## Infrastructure & Architecture Improvements

Based on inefficiency report review (June 2026). Items are grouped by phase; each was either agreed-upon from the report or identified as an additional recommendation during review.

### Phase 0 — Immediate Correctness & Security

| Item | Source | Notes |
|---|---|---|
| Fix More Mayday YouTube sync and backfill missing videos after May 5 | Report #20 | Highest-priority product bug. Function reports success but data is stale. Verify channel ID, uploads playlist ID, `YOUTUBE_REFRESH_TOKEN_MAYDAY`, and API quota. Backfill missing content_items and recompute affected rollups/goals. |
| Rotate hardcoded `CRON_SECRET` in migration `20260328200001` | Report #18 | Secret is in git history. Rotate value, remove from migration, add CI secret scanner, establish rule that migrations never contain secrets. |
| Deploy staged Goals fixes | Report #22 | Three fixes sitting undeployed: `reel` content type filter, missing auth header on `metricool-posts` (always 401), channel names in Monthly Results. |
| Fix "Total Short Form Posts" goal configuration | Report #21 | Only has TikTok account ID with placeholder external_id. Needs YouTube + Instagram account IDs added to `platform_account_ids`. |
| Fix `handleOooDecision` hardcoded `all_day: true` | Additional | OOO approval creates calendar events with `all_day: true` regardless of the actual request. Should respect the user's original all_day/partial-day selection. |

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

### Phase 2 — Reduce Frontend Maintenance Cost

| Item | Source | Notes |
|---|---|---|
| Split monolithic page files into feature modules | Report #13 | Start with largest: Reviews.js (182KB), Analytics.js (172KB), BusinessDev.js (154KB), Dashboard.js (133KB). Extract into `pages/Analytics/AnalyticsPage.jsx` + `analytics.queries.js` + `components/` + `modals/` + `styles.js`. |
| Standardize realtime subscriptions with delta updates | Report #11 | Current pattern refetches entire page data on any row change. Create a shared `useRealtimeTable` hook that uses `onInsert`/`onUpdate`/`onDelete` handlers for incremental cache updates instead of full refetches. |
| Add error boundaries on pages | Additional | No React error boundaries exist on page components. A crash in one section (e.g., a chart) takes down the entire page. Add route-level or section-level error boundaries with fallback UI and error reporting. |
| Fix mobile bundle split recovery | Additional | `App.js` checks `isMobileViewport()` once at boot and lazy-loads the corresponding layout. Orientation change, split-screen, or resize after boot can't recover. Add a resize listener or at minimum handle the most common viewport transitions. |
| Enable strict CI (fix warnings, then set `CI=true`) | Additional | `CI=false` in build hides real warnings. Audit current warnings, fix them, then enable strict mode so new issues are caught at build time instead of accumulating silently. |

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
- **#5** — `project_type` enum missing business board values (e.g. `sponsorship`)

### Low Priority (from backend audit)
- `backfill-youtube-dimensions/index.ts:3` — inconsistent import path (`./shared/` vs `../shared/`)
- `sync-stripe/index.ts:240-254` — unnecessary braces around upsert
- `sync-metricool/index.ts:210-224` — inconsistent error logging
- `public-subscribe/index.ts:110` — hardcoded Postgres error code `"23505"` as string

### Tech Debt
- `node_modules/` drift in git status (local package versions diverge) — do not commit
- `20260328200001_cron_generate_trends.sql` contains a hardcoded `CRON_SECRET`
- Orphan remote migration `20260526035022` was reverted from history (tables already created by it exist)
- Pages are large single-file components (100-200KB) — consider splitting as complexity grows

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
