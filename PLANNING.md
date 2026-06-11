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

### Pending — Contractor-assignment auto-complete hooks (Mayday Kanban port, 2026-06-11)

The 8-stage Workflows port landed labels + descriptions for Mayday's `film` and
`edit` tasks but does NOT auto-complete them. Legacy `mayday_video_workflow`
auto-cleared these on contractor events:

- **`film` stage** ("Film & Send to Editor") cleared when Trevor created the
  editor's Contractors assignment.
- **`edit` stage** ("Wait on Edit") cleared when the editor marked their
  Contractors assignment complete.

Both still need wiring. Suggested approach:
- Postgres trigger on `freelancer_assignments` (insert + update) calling a
  SECURITY DEFINER function that looks up the matching open `tasks` row by
  `step_key` + `related_entity_id=project.id` and sets `status='complete'`,
  `completed_at=now()`.
- Optional notification to other stage assignees mirroring the existing
  `card-move` notification path.
- Until wired, both tasks behave like any other manual-Complete task.

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

**Mobile**: vertical scroll one column at a time, swipe between, long-press menu replaces drag.

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
5. Mobile swipe view.
6. Archive cron + Publish expander.
7. Cleanup dead workflow paths.

### Long-term
- **Business Dev Page** — Full spec written (in CLAUDE.md), not yet built. Four-level hierarchy: Phase > Workstream > Initiative > Task. Four views: Phases, Timeline/Gantt, Calendar, My Stuff. Tables: `bd_phases`, `bd_initiatives`, `bd_initiative_links`, `bd_tasks`, `bd_milestones`, `bd_settings`.
  - Deferred from v1: Comments/discussion threads, file attachments, budget rollup view, non-admin owners and visibility, MyBoard/personal_tasks integration, email reminders
- Consider converting remaining enums to text + check constraints (proven pattern)

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
| Fix mobile bundle split recovery | Additional | **Done** | Added `matchMedia` listener in `App.js` that reloads when viewport crosses the 640px breakpoint after boot. |
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
- **#5** — `project_type` enum missing business board values (e.g. `sponsorship`)

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
