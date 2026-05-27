# Mayday Studio — Planning

## Recently Completed

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

### Contractor System (2026-05-25)
Renamed Freelancer to Contractor in admin panel. Added document signing (`DocumentSigner.js`, `DrawingPad.js`), assigned Drive folders, and contract upload flow. Multiple migrations for freelancer tables, notifications RLS, invitation signing flag, and signature columns.

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

## Upcoming / Deferred

### Business Dev Page (Spec in CLAUDE.md)
Full spec written, not yet built. Four-level hierarchy: Phase > Workstream > Initiative > Task. Four views: Phases, Timeline/Gantt, Calendar, My Stuff. Tables: `bd_phases`, `bd_initiatives`, `bd_initiative_links`, `bd_tasks`, `bd_milestones`, `bd_settings`.

**Deferred from v1:**
- Comments / discussion threads on initiatives
- File attachments
- Budget rollup view
- Non-admin owners and visibility
- MyBoard / personal_tasks integration
- Email reminders

### Database
- `project_type` enum needs business board values added (issue #5)
- Consider converting remaining enums to text + check constraints (proven pattern)

### Infrastructure
- Supabase CLI outdated (v2.95.4 vs v2.101.0 available)
- `CLAUDE_MODEL` env var should be set in Supabase dashboard to pin model versions across `generate-trends`, `run-report`

## Architecture Notes

### Critical Patterns (from MEMORY.md)
- **useEffect deps**: always `useCallback` for async functions in dep arrays (infinite render loop otherwise)
- **Auth lock deadlock**: `onAuthStateChange` must be synchronous; defer DB calls via `setTimeout(0)`
- **Enum migrations**: convert to `text` + check constraint (can't `ALTER TYPE` in transaction)
- **Routing**: pages unmount/remount on every nav — initial `useEffect` handles data load
- **Styling**: all inline `style={{}}`, no Tailwind classes

### Key Files
- `src/pages/AppLayout.js` — routing, sidebar, page mounting
- `src/contexts/AuthContext.js` — auth, profile, notifications
- `src/hooks/useVisibilityRefresh.js` — tab restore refresh
- `src/hooks/useSupabaseQuery.js` — safe query wrapper with auth retry
- `supabase/functions/shared/utils.ts` — shared ingestion log, upsert, retry helpers
