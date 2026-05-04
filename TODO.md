# TODO

## Active Bugs

- [ ] **PlatformView React error #310** — Platform dashboards crash with "Objects are not valid as React child." Debug logging added (console.log in PlatformView). Need to check `sampleRollup` in browser console to identify which field is an object. Content table already ruled out.
- [ ] **Stale tab issue** — App goes stale when returning from background tab. Multi-layered problem across auth, realtime subscriptions, and missing refreshKey deps. Partial fix deployed (reconnectRealtime + refreshKey on subscription effects) but still happening. See memory file for full diagnosis.

## Pending Fixes

- [ ] **Substack sync broken** — Stopped syncing March 5. Likely same JWT/service_role_key issue that broke YouTube. Needs redeploy with `--no-verify-jwt`.
- [ ] **Fourthwall sync** — Zero data ever written. May need credentials or was never configured.
- [ ] **TikTok views** — Metricool API returns empty for `video_views` and `profile_views` stopped Feb 2. No API access for creator accounts. Manual CSV upload is the workaround.
- [ ] **Twitter/X follower sync** — Wired up in Metricool sync but returning 0 data. May need different network name or Metricool needs time after initial connection.

## Upcoming Work

- [ ] **Stale tab — coordinated fix** — Address all layers together: reconnect logic, useVisibilityRefresh hook (dead code), silent token refresh failures, error boundaries, refreshKey coverage gaps.
- [ ] **Re-enable content table in PlatformView** — Disabled during #310 debugging. Restore once error is fixed.
- [ ] **Remove debug logging from PlatformView** — Clean up console.log after identifying #310 source.
- [ ] **Build "Business Dev" page (admin-only)** — Permanent program tracker for unified Mayday Media + Neptune Performance buildout/ops. Workstream-first hierarchy (Workstream → Initiative → Task) across 7 fixed workstreams. Tags: Mayday/Neptune/Shared. Four views: Main (workstream-grouped), Timeline/Gantt, Calendar, My Stuff. Header shows launch countdown + milestones + overall %. Initiative metadata: target date, async-friendly status (Ideas/Planned/Active/Waiting/Done), owner, budget, description, links, priority. Tasks: title/due date/owner/notes/checkbox + simple recurrence. Filters: tag pills + Hide Done. Done auto-collapses to Completed section after 1 day. In-app notifications via existing bell system. Separate tables from Goals roadmap (`bd_initiatives`, `bd_initiative_links`, `bd_tasks`, `bd_milestones`, `bd_settings`). See CLAUDE.md "Business Dev page" section for full spec. Sidebar position: below Goals.

## Recently Completed (2026-04-18)

- [x] Remove Series feature from Projects
- [x] Hide Concepts/Ideation tab and disconnect wiring
- [x] Remove Show Planning page entirely
- [x] Fix Goals metric column names (views not total_views)
- [x] Fix YouTube sync — 401 from null service_role_key, redeployed with --no-verify-jwt
- [x] Add platform_daily_metrics upsert to sync-youtube
- [x] Backfill YouTube audience snapshots (March 28 - April 18)
- [x] Add Tiller revenue sync (sync-tiller edge function + daily cron)
- [x] Add Revenue breakdown to Analytics dashboard
- [x] Rebuild Revenues tab around Tiller data
- [x] Replace dashboard Revenue by Source with Tiller data
- [x] Switch Total Revenue KPI to Tiller data
- [x] Add Twitter and Threads to Metricool sync (Threads working, Twitter pending)
- [x] Add Platforms tab to Analytics with per-platform dashboards
- [x] Change Avg Engagement to Total Engagement (likes + comments + shares)
- [x] Match KPI card colors with trend line colors
- [x] Fix Trends chart to aggregate total engagement
- [x] Paginate rollup queries to bypass Supabase 1000-row limit
- [x] Production beat textareas auto-expand
- [x] Google Sheet title row white background
- [x] Drive folder root changed to Long Form
- [x] Add "last date with data" to TikTok CSV upload
- [x] Make Trends chart full-width
