# Disconnected-code removal audit

Date: 2026-09-10. Reviewed commit: `a18935a7a341f780ce7f1b382e3a2b9612502a0a`.

## Recommendation

Remove all 13 disconnected files listed below, totaling **3,500 lines / 142,596 bytes of source**. Keep their shared dependencies, backend endpoints, database tables, and current replacement screens. Remove the two dependency groups together. Preserve recovery context in this report and Git history; an archive of executable components inside `src` would perpetuate the maintenance problem.

**Verified production impact: none in the local comparison.** Both builds passed; all 35 generated output files were byte-for-byte identical before and after removing the 13 files. This cleanup reduces source maintenance, search noise, and misleading architecture references. It does not reduce the shipped bundle or current network traffic: these components already do not execute.

Implementation update (2026-09-10): the user authorized the recommended cleanup.
All 13 files have now been removed from the checkout and current-reference
documentation corrected. Shared dependencies, backend infrastructure, and the
optional individual-export cleanup remain unchanged. The evidence below records
the pre-removal audit; implementation validation is recorded at the end.

## Evidence and limits

- Parsed all 414 JS/JSX/TS/TSX files in `src` with Babel. Included static imports, re-exports, literal `require()` calls, and dynamic `import()` calls. No parse errors or nonliteral import/require calls were found.
- Traversed desktop, mobile-web, public and authentication paths from `src/index.js`, plus tests, test mocks, `setupTests.js`, and CRA's framework-loaded `setupProxy.js`. None of the 13 candidates was reachable. The latter framework/test files are retained.
- Removing the entire set leaves no retained source file importing a deleted file and removes no previously reachable module or asset. No additional whole source files become disconnected.
- Searched repository source, scripts, configuration, planning documents, and Git history for candidate names, exports, and related service/table usage. The app uses explicit component imports; a database navigation key does not load arbitrary files from `src/pages`.
- Built a temporary copy with the installed dependencies and existing CRA/CRACO configuration using `GENERATE_SOURCEMAP=false npm run build`, first intact, then with just these 13 files removed. Both passed. SHA-256 comparison of every generated file: 35 before, 35 after, zero differences.
- Ran `npm run test:frontend -- --runInBand` on the stripped copy, then restored the 13 files in that copy and reran for a baseline. Both: **119 passed, 1 failed; 6 suites passed, 1 failed**. The same existing failure is `ConfirmContext > resolves false on overlay click`, at `src/__tests__/contexts/ConfirmContext.test.js:57`. The test emits a click without the mousedown required by `backdropDismiss`; neither file is in the removal set.
- Builds omitted the checkout's environment files and used the same environment for both variants. No authenticated browser smoke test, live database inspection, endpoint invocation, deployment, or schema mutation was performed. Runtime conclusions apply to the checked-in app and local build, not unknown external consumers or other branches.
- Scope is the 13 disconnected files from the prior review. The 86 unused bindings and reachable-but-expired usage tracker are separate cleanup work.

## Deletion groups

```text
PlatformView.js ──→ KPICard.js
                └→ TrendChart.js

ShortcutsCanvas.js ──→ workflowCatalog.js

Eight other files have no incoming source imports.
```

`KPICard.js`, `TrendChart.js`, and `workflowCatalog.js` have callers, but those callers are themselves disconnected. Deleting a dependency alone would leave an unresolved import in a retained file, even if today's application build never visits it. Delete each group atomically.

## Per-file assessment

### 1. `src/components/SprintBacklog.js` — CLEAR

**Size:** 212 lines. **Incoming imports:** none. **Source-only deletion risk:** low.

An older expandable backlog widget with personal-task creation, deletion, priority/category edits, and promotion into a sprint. Its requests run inside the component; it has no independent background job.

The current Dashboard renders [SprintPanel and SprintBoard](../../src/pages/Dashboard.js), and [SprintBoard](../../src/components/SprintBoard.js) includes the backlog column and sprint planning. Removing this file does not remove the current backlog, task records, sprint planning, or point tracking. Preserve `personal_tasks`, `sprints`, the current board components, Supabase client, and style tokens.

**Recovery value:** low; it is an older, narrower task UI. Recent palette and guard fixes in its history do not establish current usage. No replacement work is required for deletion.

### 2. `src/components/UpcomingPostsSidebar.js` — CLEAR

**Size:** 237 lines. **Incoming imports:** none. **Source-only deletion risk:** low.

A three-day Metricool scheduled-post rail. Its fetch happens only on mount. History associates its removal from Tracking with commit `aaee6321` (2026-06-04).

[Tracking](../../src/pages/Tracking.js) now fetches upcoming Metricool posts and YouTube scheduled videos itself and displays upcoming entries in its columns. [Calendar](../../src/pages/Calendar.js) also calls `metricool-posts`.

**Keep:** the `metricool-posts` edge function, credentials, scheduling integration, Tracking and Calendar. Removing the sidebar saves no current API requests because it is already unmounted. The exact three-day rail layout is retired; scheduled-post visibility survives.

### 3. `src/hooks/useReadOnlyOnMobile.js` — CLEAR

**Size:** 12 lines. **Incoming imports:** none. **Source-only deletion risk:** low.

An unused convenience wrapper around viewport detection and a mobile support lookup. It cannot currently be enforcing any read-only UI behavior because no page invokes it. Removing it changes no current permission checks or mobile controls.

**Keep:** [useIsMobile](../../src/hooks/useIsMobile.js), used by app boot and the Projects board, and [mobileNavConfig](../../src/config/mobileNavConfig.js), used by `AppLayoutMobile` for navigation filtering and excluded routes. Do not delete the mobile support registry or treat this hook as a security boundary.

Update the stale hook references in `MOBILE_PLAN.md`, `Anna/architecture/02-frontend-conventions.md`, and the mobile config's introductory comment. If consistent mobile editing restrictions are desired, that is an implementation task; retaining an unused hook supplies no protection.

### 4. `src/lib/bdAttention.js` — CLEAR FILE; KEEP DATA CONTRACTS

**Size:** 159 lines. **Incoming imports:** none. **Source-only deletion risk:** low. **Risk if expanded into table retirement:** high.

Contains old Business Dev tag/status metadata, overdue/stale attention buckets, and `syncBdTaskToBacklog`. The Roadmap rebuild (`0a9582ee`, 2026-07-24) removed its consumers. Current BusinessDev desktop/mobile pages use the `roadmap_*` hierarchy instead. Removing the file cannot turn off a mirror that is currently running through it: there are no callers.

**Critical boundary:** do not drop `bd_tasks`, `bd_initiatives`, `personal_tasks.bd_task_id`, or associated integrations based on this file's status. Current callers include:

- [AshleyRead](../../src/pages/analytics/components/AshleyRead.js): reads `bd_initiatives` and creates `bd_tasks` for analytics actions.
- [SprintBoard](../../src/components/SprintBoard.js): updates `bd_tasks` completion when a linked personal task changes status.
- [assistant-roadmap](../../supabase/functions/assistant-roadmap/index.ts): reads both legacy tables.
- The Business Dev notification cron migration also references the old tables. Actual deployed schedules were not inspected.

The architecture notes describe the legacy tables as dormant/empty; current code demonstrates remaining consumers, so those notes are insufficient evidence for deletion. Keep `ptDate`, `user_task_options`, and all shared task data. The abandoned Needs Attention calculation may be a useful design reference, but would need adapting to the new schema if revived.

### 5. `src/lib/workflow/entities.js` — CLEAR

**Size:** 41 lines. **Incoming imports/export consumers:** none. **Source-only deletion risk:** low.

A static entity-field/autocomplete registry with three suggestion helpers. No live builder uses it; it is not the database schema or the server workflow definition registry. It has no imports, network calls, or persistence.

Delete the file and, optionally, its now-empty `src/lib/workflow/` directory. Preserve similarly named `workflowApi.js`, `workflowSteps.js`, server definitions, and schema migrations. No feature or dependency package disappears with this file.

### 6. `src/lib/workflowCatalog.js` — CLEAR WITH SHORTCUTS CANVAS

**Size:** 173 lines. **Only incoming import:** `ShortcutsCanvas.js`. **Grouped deletion risk:** low.

Contains trigger/action labels, navigation targets, context-key suggestions, and a condition-string builder/parser for the old editor. These are frontend presentation helpers; the server's workflow engine has its own definitions and evaluation logic.

Delete with item 13. Keep the server workflow engine, action registry, schemas, and runtime helpers. If the visual editor returns, recover this alongside the canvas and review its catalogs against current route keys and server contracts.

### 7. `src/pages/Tools.js` — CLEAR

**Size:** 219 lines. **Incoming imports:** none. **Source-only deletion risk:** low.

The old Toolbox landing page and nested active-tool switcher. [Tool-port decisions](../tool-ports/decisions.md) explicitly call for deleting it and moving routing into AppLayout; the file survived that transition.

[AppLayout](../../src/pages/AppLayout.js) directly imports and renders Teleprompter, Organize, PostShow, Telestration, and PitchVideos. Preserve all five modules, their dependencies, current navigation entries, and Triton SSO infrastructure. This is deletion of the obsolete wrapper only.

Its `tools-active` persisted subview becomes irrelevant; clearing browser storage is unnecessary. Do not conflate the current Tools navigation folder with this component or remove that folder. No package removal follows: every imported tool remains live.

### 8. `src/pages/analytics/components/IngestionHealthPanel.js` — CLEAR; RECORD RETIRED ACTION

**Size:** 152 lines. **Incoming imports:** none. **Source-only deletion risk:** low.

Old ingestion-log table plus a TikTok revenue-entry action linked to a successful CSV upload's date range. Commit `7bd9e209` (2026-07-01) deliberately removed this section because ingestion visibility was covered by Ops.

**Keep:** [Ops](../../src/pages/Ops.js), `ingestion_logs`, `revenue_events`, CSV uploaders, [DataInputSection](../../src/pages/analytics/components/DataInputSection.js), [ManualMetricsForm](../../src/pages/analytics/components/ManualMetricsForm.js), analytics styles and utilities.

**Capability worth recording:** the exact ingestion-log-linked TikTok revenue action has no equivalent in the current Data Input configuration. TikTok's manual form is configured for followers only. ManualMetricsForm supports revenue for other configured platforms, so restoring a TikTok revenue workflow should extend the active UI and validate its record identifiers/upsert behavior. Do not claim full feature parity or reactivate an entire retired panel just to recover this action. No current UI loses the action upon deletion; it was already unavailable.

### 9. `src/pages/analytics/components/KPICard.js` — CLEAR WITH PLATFORM VIEW

**Size:** 16 lines. **Only incoming import:** `PlatformView.js`. **Grouped deletion risk:** low.

A simple value/change tile. The live dashboard uses `DecisionKpiCard` and its own digest cards. Delete with items 10–11; keep shared analytics styles and the current cards. This file is unrelated to the locally declared `KPICard` inside the separate native mobile Analytics screen.

### 10. `src/pages/analytics/components/PlatformView.js` — CLEAR; RECORD MERCHANDISE VIEW

**Size:** 465 lines. **Incoming imports:** none. **Source-only deletion risk:** low.

The old per-account Platforms tab, covering views, audience, YouTube impressions, content sorting, and a Fourthwall merchandise drill-down. Commit `19d901fd` (2026-06-28) explicitly removed the Platforms tab in favor of dashboard platform digest cards. The current Analytics imports neither this component nor its two children.

**Keep:** current Analytics, CompareView, YouTubeStudioAdvanced, account metadata, rollups, audience/content/revenue tables, `sync-fourthwall`, analytics utility/style files, and Pacific-date helpers. Those services and datasets have independent consumers.

**Capability worth recording:** Fourthwall order/profit/margin and product-sales detail is specialized legacy UI without an equivalent found in the current web source. Its profit logic includes an estimated payment fee, so it should not be silently transplanted as authoritative financial logic. Recover and redesign it only if a merchandise detail screen is wanted.

The component is also a poor drop-in fallback: it still requests content while assigning `content: []` to state. The old TODO entries about its crash, debug logging, and disabled content table should be closed or reclassified as historical. Remove with both child components; preserve Git history for recovery.

### 11. `src/pages/analytics/components/TrendChart.js` — CLEAR WITH PLATFORM VIEW

**Size:** 187 lines. **Only incoming import:** `PlatformView.js`. **Grouped deletion risk:** low.

An SVG time-series chart with hover behavior, gaps, interpolation styling, and independently scaled metric lines. Delete with PlatformView and KPICard.

**Keep:** the separate `TrendChart` exported from [src/lib/charts.js](../../src/lib/charts.js), used by Accounting, and the current analytics visualization components. Same component names do not imply the same module. Keep analytics `utils.js`; its date and formatting helpers are shared.

### 12. `src/pages/tools/_ToolScaffold.js` — CLEAR

**Size:** 159 lines. **Incoming imports:** none. **Source-only deletion risk:** low.

A Phase 1 placeholder with a Coming Soon label, back button, and Triton SSO launch. It was a shared runtime shell for stubs, rather than a generator or required framework file. The old Asset Designer/Template Builder/Scene Composer stubs were removed in commit `9792adb2` (2026-06-12).

Keep [SuiteComingSoon](../../src/pages/SuiteComingSoon.js), which is actively rendered for suite teaser routes, plus style tokens, the Supabase client, and live SSO routes/functions. The suite teaser has a different purpose/API; no substitution is necessary because no caller of this scaffold remains.

Do not keep an unused executable component solely as an example. Existing live pages and Git history provide examples. Update `Anna/architecture/03-page-catalog.md`, which still presents it as the shared tool shell.

### 13. `src/pages/workflows/ShortcutsCanvas.js` — CLEAR WITH CATALOG

**Size:** 1,468 lines. **Incoming imports:** none. **Grouped deletion risk:** low. **Risk if expanded into workflow retirement:** high.

The old visual step builder: trigger editing, action/assignee selectors, conditions, branching, repeat blocks, and step insertion. Mutations are passed through props; it has no independent endpoint or self-registering entry point. Commit `4cce83f9` (2026-06-04) removed its parent wiring when Workflows became a grid with Kanban drill-ins and automation editing.

This is a substantial retired authoring UI, not an equivalent implementation of today's board editor. If it returns, both its former parent-side CRUD/versioning wiring and current schema compatibility need work. Keeping only this unmounted canvas would not preserve a usable builder. Git history preserves the former parent and canvas together.

**Keep:** current Workflows/KanbanPanel, `workflowApi.js`, `workflowSteps.js`, `workflowModals.js`, its modal components, `backdropDismiss`, style helpers, workflow engine/definitions/action registry, and all associated tables and endpoints. MyTasks still resolves runtime step actions and modals. Payroll, Production, Deliverables, and sprint boards call workflow helpers. Several Mailer endpoints also import server workflow-engine utilities.

Delete with item 6. Its sole-use `listWorkflowModals()` export may be removed separately from `workflowModals.js`; retain `getWorkflowModal()` and the registry.

## Adjacent cleanup and exclusions

The 13-file experiment intentionally did not remove individual exports, configuration keys, packages, backend functions, or data. Possible small follow-ups, requiring their own focused diff:

| Candidate | Recommendation |
|---|---|
| `workflowModals.js:listWorkflowModals` | Remove after ShortcutsCanvas; no other caller found. Keep the rest of the module. |
| `mobileNavConfig.js:isReadOnlyOnMobile` | Remove after the wrapper hook if retaining only the live config API. Keep the support map and navigation filters. |
| `mobileNavConfig.js:getMobileSupport` | Already has no source caller; optional export cleanup, unrelated to the 13-file deletion. |
| `analytics/constants.js:TREND_METRICS` | Already has no source caller; optional export cleanup. Keep the rest of the constants module. |
| Shared styles and utilities | Keep. Individual stale keys may warrant a separate property-level audit; whole-file removal is unsafe. |
| Package dependencies / lockfile | Keep for this change. Candidates directly use React or shared live modules; no exclusively owned external package was found. |
| Database tables, columns, triggers, schedules and edge functions | Keep. Frontend disconnection is not evidence of backend disuse; `bd_*` and workflow infrastructure have demonstrated callers. |
| `setupProxy.js`, `setupTests.js`, `__mocks__` | Keep: framework/test entry points. |

## Documentation and recovery

When implementing, update current-reference documents so they stop directing work toward deleted components:

- `Anna/architecture/03-page-catalog.md`: obsolete builder/tool-shell references.
- `Anna/architecture/02-frontend-conventions.md`, `MOBILE_PLAN.md`, and mobile config comments: unused hook claims.
- `Anna/architecture/04-supabase-schema-map.md` and `Anna/README.md`: distinguish the orphaned BD helper from the still-referenced legacy tables.
- `Anna/backend/03-cron-automations.md`: distinguish retired builder labels from runtime workflow infrastructure.
- `TODO.md`: obsolete PlatformView-specific fixes.
- `docs/ashley-analytics-spec.md`: replace PlatformView as a current source reference with the actual live schema/consumers.
- Preserve historical planning and shipped-change records as history; label their retired status where needed instead of rewriting what happened.

All 13 files are tracked in the reviewed commit. Any can be recovered using `git show a18935a7:<path>`; the parent-wiring removal commits above provide recovery context for complete old features. No archive directory or new retention branch is necessary.

## Implementation recommendation

Make one source-cleanup change removing the exact 13-file set plus documentation corrections. Keep the optional export cleanup separate if a minimal, easily reviewed deletion is preferred. Do not include schema, package, or endpoint retirement.

Rerun the production build and frontend suite at implementation time because the working branch may have advanced. Expect the known ConfirmContext baseline failure until its interaction test is fixed separately. Smoke-check desktop/mobile Dashboard, Tracking/Calendar, Analytics/Ops, Workflows/task modals, and direct tool routes when validating a deployment. The local identical-output comparison is strong evidence of no frontend behavior change, but it is not a substitute for live backend retirement analysis.

## Implementation validation — 2026-09-10

- Removed exactly the 13 audited files (3,500 source lines). Updated current-reference documentation and the mobile navigation comment. Optional export cleanup remains separate.
- `npm run build`: passed in the real checkout with its normal environment and source-map settings. Reported dependency source-map warnings for missing source files in the installed Elgato packages.
- `npm run test:frontend -- --runInBand`: 119 passed, one failed, matching the audited baseline. The existing failure remains `ConfirmContext > resolves false on overlay click` at test line 57.
- `git diff --check`: passed. No remaining source references to the removed modules were found. Audit/TODO local links resolve.
- Backend, database migrations, native mobile code, and dependency manifests were not changed. No deployment or commit was performed.
