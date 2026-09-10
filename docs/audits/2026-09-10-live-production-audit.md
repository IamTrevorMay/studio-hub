# Live production, database, and dependency audit — September 10, 2026

The biggest newly confirmed win is fixing a Dashboard Sprint refresh loop. Sprint reads accounted for **92,260 requests, or 72.15% of all REST requests**, in the sampled day. A local reproduction confirms the loop. This should precede the larger architectural refactors.

The overall architectural estimate remains **18,000–30,000 net owned source lines removed**, with 24,000 as a planning target, excluding the 3,500 already removed. Live measurements change implementation priority and deletion boundaries; they do not prove additional line savings. Several immediate fixes may add a small amount of code.

## Scope and evidence

- **Production performance:** inspected real Supabase API and function request logs, PostgreSQL statement statistics, Vercel runtime logs and deployment outputs, and three unauthenticated browser loads. Authenticated page rendering, interaction timing, hidden-tab behavior, and device-specific traces remain pending test-account/browser access. They have not been measured.
- **Database:** inspected sizes, indexes, foreign keys, RLS policy metadata, actual counts for deletion candidates, query statistics, replication, and a nonexecuting `EXPLAIN` of the live analytics rollup definition.
- **Dependencies:** inventoried deployed functions, scheduled jobs, seven days of cron results, triggers, publications, workflow/task state, foreign keys, and live endpoint usage.

API/function log window: **2026-09-09 19:20 through 2026-09-10 19:20 UTC**. Database snapshots were collected on September 10 starting at 19:15 UTC. Statement statistics reset on **August 30 at 14:53 UTC**. Cumulative database statistics are not one-day counts or browser latency measurements.

SQL used Supabase's [read-only query endpoint](https://supabase.com/docs/reference/api/v1-read-only-query). The session reported `transaction_read_only=on`; its role bypasses RLS. Consequently, counts include all rows, while the inspected execution plan does **not** establish an authenticated user's RLS performance. No migrations, application records, cron schedules, indexes, or production configuration were changed. No refresh RPC or `EXPLAIN ANALYZE` was run.

The [sanitized evidence](2026-09-10-live-production-evidence.json) contains aggregate results, plans, inventories, browser samples, and the local reproduction result. Request credentials, personal message contents, raw cron commands, and customer records are excluded. Log queries use Supabase's documented [Management API log interface](https://supabase.com/docs/reference/api/v1-get-project-logs).

Production changed during collection. Vercel initially showed ready deployment `dpl_3N3SjquzdmT8u7ZHUYP49VFEY7bu`; the alias later resolved to `dpl_Gh8zkUUdA2BeCFrv7HfBeWRMNLMW`. Local source reached commit `1a97e9ff`. Historical logs span earlier deployments; this is not a controlled before/after benchmark.

## Recommendations, biggest immediate wins first

### 1. Fix the SprintPanel refresh loop before introducing a global cache

**Confirmed behavior.** The sampled day contains 31,120 GETs to `sprints`, 30,628 to `personal_tasks`, and 30,512 to `sprint_goals`. There were 127,873 REST requests overall. One hour alone contained 60,512 reads across those three endpoints. The main production website's referrer accounts for most of this traffic; it is not explained solely by development traffic.

In `src/components/SprintPanel.js:31`, `fetchActiveSprint` stores a fresh object. The task/goals callbacks depend on the entire `activeSprint` object at lines 57 and 82. At line 86, an effect depends on those callbacks and calls `fetchActiveSprint` whenever `boardVersion > 0`. Each new object changes the callbacks and restarts the effect, even when the Sprint ID and board version have not changed.

A bounded local React/jsdom reproduction used the unchanged component and mocked Supabase reads: `boardVersion=0` settled after **4 reads**; `boardVersion=1` exceeded **50 reads within 250 ms**, reaching the mock cutoff. No production requests were made by this reproduction. Exact historical attribution of every Sprint request remains unavailable, but the query shapes and traffic strongly support this as the main source.

**Change:** depend on primitive Sprint IDs, give board-version invalidation one explicit owner, and avoid an effect that fetches state on which its own callback dependencies depend. Add a regression test asserting that requests settle after one board update.

**Blast radius:** Dashboard Sprint summary, task points, goals and velocity refresh. Preserve refresh after task edits and Sprint changes. **Line impact:** small; do not target a large deletion here. Most of the 92,260 reads are an opportunity ceiling, not a promised reduction to zero.

### 2. Repair live schema/RPC drift and stop hiding failed health checks

**Missing rate-limit storage:** `public.authenticated_rate_limits` does not exist. Logs show **12 HEAD 404s and 12 POST 404s** against it. `supabase/functions/shared/utils.ts:191` ignores both query errors, treats missing count as zero, and returns `allowed: true`. The shared code therefore permits requests when this storage fails. The repository contains a creation migration, but that is not proof it was applied to this database.

**Broken health RPC:** both observed `get_sync_health` requests returned HTTP 400. PostgreSQL recorded `column reference "platform_account_id" is ambiguous`; log context explicitly identifies `get_sync_health()` at `RETURN QUERY`. Its live definition uses unqualified names that collide with output parameters. It also returns an enum where the signature declares text and an uncast numeric expression where the signature declares double precision; reconcile the complete return contract when fixing it.

**Change:** reconcile the specific missing schema with the live database; handle rate-limit storage errors explicitly; qualify SQL columns and match RPC return types. Consolidate the two health-widget requests and expose an unavailable/error state. Both widgets currently suppress errors and disappear.

**Blast radius:** every caller of the shared rate limiter and the Analytics health display. Use a reviewed targeted migration and role-specific checks, not a blanket replay of migration history. These are fixes, not candidates for stripping safeguards out. **Line impact:** likely neutral or positive initially.

### 3. Simplify analytics rollup computation and give refreshes one owner

The two top-level refresh statement forms recorded **403 calls and 23.0 cumulative execution minutes** since the statistics reset. Cron calls averaged **3.72 seconds**; service-role RPC calls averaged **2.84 seconds**. In the sampled day, 12 API refresh calls averaged **2.85 seconds**, with approximately **3.18 seconds p95 origin time**.

The live materialized-view definition generates a 731-day grid for active accounts, then runs correlated content and revenue aggregation. Its plan shows account-only index conditions followed by date-cast filters for content; this repeats work across the day/account grid. The latest-content-metric lookup already uses an index: do not assume it needs a new one.

**Change:** first aggregate source data once by account/date and join it, preserving the current view-weighted engagement and latest-snapshot semantics. Then decide whether changed-account/day refreshes are worthwhile. Consolidate refresh scheduling across hourly cron, seven ingestion handlers, and the manual Analytics action. Avoid a new incremental bookkeeping system unless its measured savings justify it.

**Blast radius:** Analytics, KPI/report consumers and public metrics. Historical totals, timezone boundaries, revenue, missing days and revised old posts need result-equivalence checks. Keep the materialized view's consumer contract and required unique index during migration. The existing 800–1,600-line analytics estimate overlaps this work; there is no defensible separate line estimate yet.

### 4. Reduce notification and background request duplication

Real daily traffic includes 1,451 notification-summary calls, 1,486 unread-DM-count calls, 2,687 channel-message reads, 1,724 conversation-participant reads and 5,257 profile PATCHes. Notification-summary origin time averaged **96.5 ms**, approximately **301.5 ms p95**, while its cumulative SQL mean was only **6.3 ms**. This favors reducing repeated requests and round trips before trying to optimize that SQL in isolation.

Background functions are also material: `drive-watch-poll` and `mailer-cron-tick` each had 1,439 successful calls; `sync-progress-cards` had 719. All three are scheduled consumers, regardless of frontend imports.

**Change:** consolidate shared notification reads, batch conversation summaries, coordinate presence across tabs, and refresh on relevant changes with visibility-aware fallbacks. Review poll cadence against required freshness. Do not equate frequent polling with unused functionality.

**Blast radius:** unread counts, presence, task cards, email scheduling and Drive ingestion. Preserve freshness and recovery after reconnect. **Line opportunity:** the earlier shared-cache/lifecycle estimate of 1,200–2,500 net lines remains applicable, overlapping domain refactors.

### 5. Separate workflow-specific orchestration from the active task system

All **6 workflow instances are canceled**. There are no running instances in this snapshot. However:

- `tasks` contains **6,931 rows**, including 10 active and 1 pending; none of those active/pending tasks is linked to a workflow instance.
- 49 personal tasks have task links; 22 completed tasks retain workflow-instance links.
- Production recorded successful POSTs to `workflow-complete-task` **4 times**, `workflow-update-task` **2 times**, `assign-task` **2 times**, and `sprint-task-sync` **7 times** in the sampled day.
- Two automations are enabled. One workflow definition still has `is_active=true` and automatic trigger mode.
- Foreign keys connect workflow history to tasks, proposal records and workflow audit records. Task triggers still support overtime/payroll behavior.

**Change:** extract ordinary task commands from workflow execution, migrate their callers, then consider retiring workflow creation/editor/execution machinery separately. Keep historical records readable. A canceled instance count supports investigating retirement; it does not authorize deleting every `workflow-*` endpoint.

**Blast radius:** Sprint boards, assignment, completion, sign-off, overtime/payroll, proposals, automation and history. This supports the earlier transactional/domain consolidation recommendation, not immediate table deletion.

### 6. Make cron health reflect HTTP outcomes and recover stale runs

There are **40 active scheduled jobs**. Over seven days, two cron launches failed with connection-related errors, one each for progress-card sync and Calendar pull. But a successful cron entry only establishes that its SQL completed: jobs using asynchronous HTTP can still fail downstream.

The one-day function logs show HTTP 500 for **`post-daily-graphics` and `sync-stripe`**, despite successful corresponding cron SQL launches. A YouTube dimensions ingestion row has remained `running` since September 5, even though later runs succeeded. This is stale tracking state, not proof that a process is still running.

**Change:** correlate scheduled dispatches with function results, expire abandoned run states, and distinguish dispatch success from work completion. Investigate the two 500s separately before deleting or consolidating their handlers. Keep execution monitoring as shared plumbing. HTTP 401/403 responses elsewhere may be intentional authorization enforcement and are not automatically defects.

### 7. Remove unnecessary payload and deployment breadth

**Production list data:** 73 beat sheets serialize to roughly **662 kB of JSON**, of which **437 kB** belongs to 43 archived sheets. Most bytes are beat content. Fetch compact active-list metadata first and load the selected document's content separately. Preserve archive browsing and search deliberately. This measures uncompressed row JSON, not actual wire compression or every user's RLS-visible payload.

**Deployment:** Vercel exposes 37 lambda outputs, including internal Harbor helpers such as `api/harbor/naming`, `renditions`, `rescue`, and `trackPipeline`. Seven Harbor/server outputs each report a roughly **67.9 MB bundle**. These metadata sizes do not establish seven times that amount of billed storage or memory; deployment deduplication is unknown.

**Change:** separate the local Express/NAS service and reusable helpers from public serverless entry points; explicitly verify required endpoint mappings. This is packaging cleanup, not a reason to delete Harbor. Live Harbor records show two archived tracks with NAS paths totaling roughly **1.19 GB**. Keep the archiver and recovery paths.

### 8. Keep BD data; cautiously review index and policy duplication

**BD is not empty:** 38 tasks, including **14 incomplete**, 16 initiatives, and **5 linked personal tasks** remain. A daily BD notification cron and six BD triggers across tasks, initiatives and phases are installed; BD tables also remain in the realtime publication. Preserve this data and these consumers until there is an explicit migration/retirement decision.

**Do not use estimated live tuples to identify dead tables.** `cut_records` reports zero live tuples in activity statistics but actually contains **6,179 rows**. `automation_runs` reports one but contains **6,711**. Planner row estimates are much closer; this is not evidence of universally broken query planning.

The database is approximately **694 MiB**. `content_metrics` accounts for **296 MiB including indexes**. Catalog inspection found 655 public indexes; 160 nonunique indexes had zero recorded scans, totaling only **10.2 MiB**. No exact duplicate index pair was found by the structural comparison. Zero scans in this observation window do not justify deletion. Retain primary/unique constraints, rare operational indexes and foreign-key support.

There are 372 foreign keys, with 206 lacking an unconditional valid index prefix under the catalog check. These are review candidates, not 206 automatically necessary new indexes. The frequently read `personal_tasks.sprint_id` is among them, but its small SQL execution cost reinforces fixing the request loop first. RLS metadata shows 635 policies on 269 tables; authenticated execution plans and role checks are still needed before changing policy behavior.

## Live deletion boundaries

| Area | Recommendation | Reason |
|---|---|---|
| Sprint callback/effect duplication | Refactor immediately | Locally reproduced request loop and matching live traffic |
| Workflow-specific engine/editor | Stage retirement after task separation | No running instances, but active commands and retained history |
| `tasks`, task events/sign-offs, personal-task links | Keep | Current tasks, endpoint traffic, payroll and assignment dependencies |
| BD tables, notification job, recurrence triggers | Keep | Unfinished work, linked tasks and installed consumers |
| Analytics rollups and sync handlers | Refactor behind existing contracts | Measured cost and multiple active consumers |
| Harbor archiving/recovery | Keep; repackage helpers | Archived production recordings and NAS references |
| Zero-scan indexes | Review individually | Limited observation window; small total savings |
| Remote-only edge functions | Recover ownership/source first | `assistant-inbox`, `simplefin-claim`, `simplefin-sync` are deployed but absent from local function sources |

All **122 deployed edge functions** are marked active; 119 have matching local function directories. Forty-seven distinct functions received non-OPTIONS requests in the one-day log window. Lack of traffic for the others is not proof of disconnection: weekly/monthly jobs, external clients and infrequent recovery paths require longer observation and owner checks. The inventory is not a complete proof of all external consumers or dynamic SQL dependencies.

## Browser result and remaining limits

Three fresh desktop browser contexts loaded the unauthenticated production page with no observed page errors or long tasks over 50 ms. TTFB was **1,501 / 135 / 134 ms** and LCP **2,348 / 476 / 272 ms**. Initial JavaScript transferred approximately **116 kB** across two scripts. These are unthrottled synthetic samples on one machine; fresh contexts do not imply a cold CDN or cold operating-system network cache.

This measures the login surface only. It neither confirms nor disproves the earlier finding about large authenticated desktop feature bundles. Existing logs provide real backend behavior for Dashboard, Messages, Pipeline and Analytics, but do not provide authenticated render timing or full interaction waterfalls. A test-account session is still required for that remaining portion. No p95 end-user page-load, production CPU saturation, or financial savings claim is supported by this audit.

Vercel returned 30 runtime log entries for the queried day, predominantly sitemap requests. That small sample does not represent all static traffic. PostgreSQL snapshots showed no deadlocks or temporary-file spills and negligible retained replication WAL; the findings do not establish an overloaded database.

**Recommended sequence:** fix the Sprint loop and live contract failures; consolidate refresh ownership and verify analytics equivalence; separate task commands from workflow orchestration; then proceed with the UI/domain/editor refactors in the [architecture audit](2026-09-10-architecture-refactoring-audit.md). Keep its 18,000–30,000-line estimate as a provisional engineering target rather than using line reduction to rank urgent fixes.
