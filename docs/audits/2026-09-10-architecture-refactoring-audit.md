# Architecture refactoring audit: biggest wins first

Reviewed 2026-09-10 at `ac3fe8b1`, after the 13 disconnected files were removed.

Follow-up: the [live production, database, and dependency audit](2026-09-10-live-production-audit.md) adds measured traffic and live deletion boundaries. It prioritizes a confirmed Sprint refresh loop and production schema/RPC failures ahead of the larger refactors below. Authenticated browser interaction traces remain pending access.

## Decision summary

**Plan for 18,000–30,000 additional first-party source lines removed, with 24,000 as the planning target.** That is approximately 8–14% of the current 218,322-line owned source footprint. These are engineering estimates, not proven deletion counts or a commitment to remove features. They account for replacement abstractions, tests, and overlapping opportunities. The previously removed 3,500 lines are excluded.

The central problem is repeated ownership: pages independently own business rules, queries, refresh subscriptions, mutations, and presentation. Many existing shared helpers have been added without replacing all the implementations they were intended to consolidate. Splitting a large page into files alone would make navigation easier but would not substantially shrink the code or fix competing state owners.

Recommended direction: a few shared UI primitives; feature-specific models and data hooks shared by desktop/mobile; a coordinated query lifecycle; transactional server commands for multi-record changes; narrow platform adapters around shared editor, renderer, and integration logic. Keep specialized product views and runtime boundaries where they serve a real purpose.

There is also a separate repository hygiene finding: **38,656 tracked `node_modules` files, approximately 180 MB of Git blob content and 2.98 million code lines at tracked paths.** Removing dependencies from tracking dwarfs any raw line-count reduction but is not an application refactor. It is excluded from all first-party savings estimates.

## Scope, measurement, and confidence

- Inventoried tracked first-party JS, JSX, TS, TSX, Python, CSS, and SQL source: 665 files / 218,322 physical lines, including comments and blank lines. Excludes vendored dependencies, the migration archive, and database-test SQL. Includes frontend tests and sidecar tool source. This is a consistent source-footprint measure, not executable-statement count.
- Separately counted 446 migration files / 19,776 lines and one database-check SQL file / 198 lines. Historical migrations are not a deletion target in the savings estimate.
- Parsed all 648 first-party JavaScript/TypeScript files with Babel, with zero parse errors. Measured functions, state/effect calls, recognizable style declarations, imports, and exact function-body clones. Found 73 cross-file exact-body clone groups; nested groups overlap, so their line counts were not added together.
- Reviewed high-impact implementations in desktop and mobile-web pages, native mobile, both document-editor trees, edge functions, Node API, Python Timeline, Harbor, rendering, scheduling, payroll/invoicing, and analytics. Inspected package/build configuration and sidecar entry points. Examined the existing production source maps to verify eager feature bundling.
- Ran a dedicated React-app ESLint analysis on `src` JS/JSX: 81 unused-binding findings, 84 hook-dependency warnings, three undefined-name occurrences, one hook-order error, and two duplicate object keys, plus smaller warnings. Warnings require review; they are not all bugs or deletion opportunities.
- The immediately preceding implementation validated the same commit's code: production build passed with Elgato dependency source-map warnings; frontend tests were 119 passing and one known ConfirmContext failure. This audit did not rerun that unchanged build or suite. No native build, live SQL execution plan, production trace, authenticated UI walkthrough, or deployed cron inventory was collected.
- Structural coverage is repository-wide; manual reasoning is concentrated on representative implementations and the measured hotspots. This is not a claim that every branch of every feature has been proven correct or that every endpoint is safe to retire.
- No application implementation changed during this audit. Numeric evidence is retained in [architecture-metrics.json](2026-09-10-architecture-metrics.json).

| Owned area | Files | Physical lines |
|---|---:|---:|
| Web `src` | 404 | 166,136 |
| Supabase functions, shared modules and tests | 144 | 32,551 |
| Native mobile | 25 | 6,359 |
| Node API | 40 | 5,624 |
| Standalone MaydayDocs | 31 | 4,852 |
| Python Timeline service | 9 | 957 |
| Other owned tools/configuration | 12 | 1,843 |
| **Total** | **665** | **218,322** |

## Ranked recommendations

Rank balances maintainability, duplication, runtime payoff, and confidence. A lower-ranked item can still be the best first implementation when it is easier to isolate.

| Rank | Refactor | Estimated net lines removed within that workstream | Principal benefit | Risk / relative effort |
|---|---|---:|---|---|
| 1 | Shared UI primitives and presentation patterns | 7,000–11,000 | Largest source reduction; consistent interactions | Medium / large rollout |
| 2 | Shared domain logic behind desktop/mobile views | 4,500–7,500 | Stop fixing the same behavior twice | Medium / large rollout |
| 3 | One query, refresh, and subscription lifecycle | 1,200–2,500 | Fewer requests, races and stale-state patches | Medium-high / medium-large |
| 4 | Transactional commands and authoritative task transitions | 1,800–3,500 | Remove synchronization and partial-write repair code | High / large, staged |
| 5 | One document-editor implementation, host adapters | 2,700–3,600 | Eliminate demonstrated near-copy tree | Medium / medium |
| 6 | Complete backend handler and integration consolidation | 1,500–2,500 | Remove repeated auth/CORS/OAuth/plumbing | Medium-high / medium |
| 7 | Shared route registry and feature lazy loading | 600–1,200 | Smaller startup dependency graph, less route drift | Medium / medium |
| 8 | One Canvas drawing core, browser/Node adapters | 900–1,150 | Keep graphics previews and exports consistent | Low-medium / small-medium |
| 9 | Shared analytics definitions and aggregated reads | 800–1,600 | Fewer row downloads and less metric drift | Medium-high / medium |
| 10 | Remaining dead declarations and expired instrumentation | 250–600 | Cheap cleanup of stale paths | Low / small |
| 11 | Isolate long-running work and standardize save lifecycle | No guaranteed reduction; may add 100–300 lines initially | Responsiveness and reliable persistence | Medium / medium |
| 12 | Stop tracking dependencies | About 2.98 million vendored code lines; **0 owned-code savings** | Repository hygiene and reproducible installs | Low-medium / small |
| 13 | Add targeted correctness gates; document current contracts | No reduction budget | Make the preceding refactors safe and durable | Low-medium / ongoing |

**Do not sum the workstream ranges as an exact total.** Rows 1–10 sum to 21,250–35,150 lines of opportunity. The recommended overall budget is **18,000–30,000 net**, reserving roughly 3,250–5,150 lines for cross-workstream overlap, replacement/test scaffolding, and estimation uncertainty. Native-only behavior, historic SQL migrations, deleted product functionality, and dependency vendoring are not used to inflate this target.

### 1. Replace repeated page chrome with a small shared UI layer

**Evidence:** Approximately 41,538 frontend lines are touched by recognizable style objects or JSX `style` attributes. That is not 41,538 removable lines: it includes unique layouts and some mixed expressions. It nevertheless identifies the largest consolidation surface. Dashboard has 1,524 such lines; Production 1,460; Deliverables 799; ContractorDashboard 788. The web code contains 44 files exceeding 1,000 lines, totaling 80,025 lines.

The existing [styleRecipes.js](../../src/lib/styleRecipes.js) and `styleTokens.js` are useful foundations, but recipe imports appear in only 29 source files. Page-local buttons, inputs, overlays, table cells, empty states, tabs, status pills, and field layouts still repeat their shapes and behaviors.

**Refactor:** Introduce or extend a small set of stable components: Button/IconButton, Field, StatusBadge, Dialog, PageHeader, EmptyState, Tabs, and a table shell. Build on current tokens and recipes. Preserve mobile sheet presentation through an adapter around common dialog content. Consolidate repeated status/label configuration within each domain. Keep custom board canvases and editorial layouts custom.

**Removal mechanism:** Delete repeated JSX structure, style objects, keyboard/focus/dismiss plumbing and page-specific variants that the shared component expresses. This is more valuable than moving the same style objects into another file. Avoid a new styling framework or a giant configuration-driven universal page generator.

**First pilot:** Three ordinary management screens with dialogs and tables. Expand only after the component API actually reduces their code. Visual checks must cover keyboard focus, outside-click behavior, text selection, mobile sheets, and loading/error states. Preserve `backdropDismiss`'s mouse-down protection.

**Estimate:** 7,000–11,000 net lines across non-editor UI. Most value is consistency and maintainability; do not promise a speedup merely from fewer style declarations.

### 2. Share feature models between desktop and mobile, not just helper functions

**Evidence:** 23 same-name desktop/mobile component pairs contain 59,647 lines. This includes the app shells and a nine-line Reviews wrapper, so the entire pool is not duplicated logic. Significant examples are Messages (1,711 + 1,434), Channels (2,586 + 1,301), Invoicing (2,086 + 1,091), and Ideas (1,748 + 1,020). The auth submit bodies match exactly after AST normalization, and Ideas contains a 71-line exact function-body copy. Other pairs implement similar responsibilities with divergent text, which an exact-copy detector misses.

**Refactor:** Create feature-local models/controllers for conversation membership, message editing, invoice totals and validation, idea/tag operations, and Roadmap mutations. Expose those to separate desktop and mobile renderers. Keep form schemas, status semantics, and pure date/money rules next to the feature. Feature hooks should compose the common data layer from recommendation 3.

Existing [messageImages.js](../../src/lib/messageImages.js), `useAttachmentEdit`, `ptDate`, `ptTime`, and accounting's `useBreakdownData` demonstrate that extraction already works in this codebase. Finish the migration to existing helpers before adding competing abstractions.

**First pilot:** Messages desktop/mobile: common conversation model and mutation functions, distinct layouts. Follow with Invoicing and Ideas. Do not force React Native to share DOM components: share only compatible pure contracts/calculations and data adapters. Native mobile uses different React/runtime dependencies.

**Risk:** Desktop and mobile do not have complete feature parity. Record differences before extraction; avoid silently dropping desktop fields or widening mobile editing capabilities. Date-only values, UTC timestamps, and Pacific calendar dates must remain distinct concepts even if their helpers share implementation.

**Estimate:** 4,500–7,500 lines of domain/model duplication, excluding reusable styles, the app route registry, and both editor trees.

### 3. Give cached data and refresh behavior one owner

**Evidence:** The frontend has 2,288 `useState` and 677 `useEffect` call sites across files, including nested components. There are 31 importers of `useVisibilityRefresh`, but only two of `useRealtimeTable` and two of `useSupabaseQuery`. AuthContext, the safe-query hook, realtime reconnection, providers, and individual pages each have recovery/refresh behavior.

Concrete waste:

- [Messages.js:154](../../src/pages/Messages.js) and mobile issue two additional queries per conversation. Fifty conversations require 102 requests for list construction alone.
- NotificationContext refreshes mention history on channel-message changes and separately refreshes badge summaries. Its history query is unbounded client-side aggregation.
- SyncHealthWidget and DataCompletenessBadge both fetch `get_sync_health` on mount and every minute when rendered together.
- [Pipeline.js](../../src/pages/projects/Pipeline.js) refetches five datasets every 25 seconds, including roster/goals/settings that change much less often: approximately 12 requests per minute per mounted view, before focus refreshes. No hidden-tab guard appears in that interval.
- Payroll and Contractors request one pay-breakdown RPC per member/hour entry. Deduplicating by person and period, or returning a batch summary, avoids repeated identical computations.

**Refactor:** Use one query owner keyed by resource plus auth identity, filters, and period. It handles caching, in-flight deduplication, cancellation/stale-response protection, invalidation, visibility refresh and bounded retry. Realtime should invalidate or patch those keys, rather than independently triggering every consumer's loader. Auth recovery needs one shared in-flight refresh coordinator; treat permission denial differently from token expiry.

Move conversation summary/last-message/unread aggregation to an appropriately authorized query/RPC. Cache reference data separately from live operational data. Debounce bursts of invalidations and avoid polling hidden pages. A mature query-cache implementation is an option, but selecting a new dependency is a separate decision; the architectural requirement is ownership, not a particular library.

**Risk:** Cache keys must isolate real users, impersonation/view-as sessions, client scope and role-dependent responses. Preserve the current auth lock avoidance and password recovery/invite behavior. Clear privileged data on identity change.

**Estimate:** 1,200–2,500 net lines of lifecycle boilerplate. Expected request-count benefits are strong; actual latency savings require runtime traces.

### 4. Move multi-record business changes into authoritative commands

**Evidence:** [SprintBoard.js:1140](../../src/components/SprintBoard.js) updates card status and then coordinates task creation, legacy BD completion, reopening, workflow completion and hours/sign-off prompts through separate paths. The task-sync endpoint inserts a task, links a card, and manually deletes the task if linking fails. Workflows also derives status from mirrored sprint cards. The creation flag in `workflowApi.js` remains disabled while in-flight task execution is retained.

Both invoice editors separately update the invoice, delete all line items, and insert replacements. The mobile sequence at [InvoicingMobile.js:295](../../src/pages/InvoicingMobile.js) does not inspect the Supabase result errors of the line-item delete/insert before calling `onSaved()`. Desktop has the same independent-write structure. A failed insert can leave a saved invoice header without its intended lines.

**Refactor:** Start with explicit commands such as `save_invoice_with_lines` and `transition_work_item`. Perform database-only changes atomically, validate ownership and transition prerequisites once, and return the updated projection. Use an idempotent outbox/job for external side effects that cannot participate in a database transaction. UI state should reflect a returned outcome, not infer success from several fire-and-forget writes.

For task ownership, introduce one transition contract over existing tables first. Do not immediately merge every project, contractor assignment, personal task and workflow card into a universal table. Once the contract is exercised, identify which mirrors can become views or projections and which tables carry distinct business information.

**Risk:** High: payroll hours, sign-off, existing workflow instances, reassignment, legacy links and external notifications must remain correct. Legacy `bd_*` tables still have Ashley, SprintBoard and assistant consumers. Inventory deployed triggers, in-flight records and retry semantics before retiring anything. Keep applied migrations intact.

**Validation:** Transaction rollback on injected failure; duplicate command replay; unauthorized caller; concurrent completion; missing required hours; reopen behavior; historical linked tasks. Roll out invoice atomicity before broader task transitions.

**Estimate:** 1,800–3,500 net lines of distributed orchestration and repair logic after server replacement code. Savings are less certain until live state is inventoried, but reliability payoff is substantial.

### 5. Stop maintaining two document-editor trees

**Evidence:** Standalone MaydayDocs has 4,852 source lines; embedded `src/pages/editors/doc-editor` has 5,166 JS/TS lines. Twenty-four matching filename pairs contain 4,091 lines on the standalone side, 3,624 embedded, and **3,245 matching trimmed lines**. Examples: Toolbar matches 467/470 lines; FormatMenu 50/50; ZoomControl 53/54; FindReplace 262 matching lines. Persistence, comments and host integration account for meaningful differences.

**Refactor:** Share editor extensions, menus, commands, toolbar, dialogs, find/replace and export logic. Inject persistence, uploads, document identity and navigation through host adapters. Share the core rather than copying host-specific Zustand stores into another universal store.

Keep independent app entry points while determining whether the standalone editor is a maintained product or prototype. If it is intentionally retired later, its whole-app deletion is an alternative to extraction, not an additional saving to add on top.

**Risk:** Standalone uses React 19 and Vite; the main app uses React 18 and CRA/CRACO. A shared module/package must avoid bringing two React copies into one bundle and must compile through both hosts. Validate formatting, search, links, comments, export, image insertion and autosave. Do not attempt to merge the separate Lexical screenplay editor into Tiptap just because both edit text; their semantics differ.

**Estimate:** 2,700–3,600 net lines. This is one of the strongest candidates for an early, bounded refactor.

### 6. Finish common backend plumbing instead of adding another wrapper

**Evidence:** There are 119 edge entry points. Only two import `shared/handler.ts`; 72 locally declare `corsHeaders`; 24 contain the Google token endpoint. Ten files have matching Google access-token function bodies. `google-drive-resources` and `google-drive-write` have matching 223/224-line handler bodies apart from external module configuration. There is also duplicated shared utility logic under `sync-youtube/shared` and top-level `shared`.

**Refactor:** Reuse a tested handler/auth foundation with explicit policies; keep endpoint files as small deployment entry points. Parameterize the Drive document handler by root/configuration, centralize OAuth refresh and ancestry checks, and deduplicate ingestion-log lifecycle and response/error helpers. Cache OAuth tokens per credential identity with expiry and one in-flight refresh. Preserve appropriate failure/retry behavior.

Do not blindly route everything through the current `createHandler`: it constructs an admin client and its auth modes do not encode every resource-level access rule. Public guest links, webhook signatures, cron secrets, user JWTs and project ACLs need distinct policies. Browser and Node runtimes should use thin adapters rather than importing Deno globals.

**Demonstrated drift:** `src/lib/rolePermissions.js` allows canonical `director` into Broadcast; `api/_lib/broadcast/access.js`'s `PRODUCER_TIER_ROLES` includes legacy director names and producer but omits canonical `director`. Project creation calls `requireProducer`. Shared capability definitions and contract tests should make this mismatch visible without flattening intentionally different access rules.

**Estimate:** 1,500–2,500 net lines. A first pass over the two identical Drive endpoints plus repeated token helpers offers a smaller low-risk pilot, with root isolation and authorization tests.

### 7. Consolidate route metadata and lazy-load features

**Evidence:** AppLayout is 2,414 lines; mobile shell 875. Catalogs, aliases, role gates, icon maps, persisted tabs, suite paths and render conditions are repeated. AppLayout statically imports nearly every feature, including editors and heavyweight tools.

The existing production map places Payroll, Screenwriter, both Whiteboard surfaces, Broadcast, Graphics and document-editor code in the same roughly **650 kB gzip desktop application chunk**. Another roughly **637 kB gzip dependency chunk** includes Fabric, jsPDF, editor engines and graph tooling. App-level desktop/mobile lazy splitting exists, but desktop feature imports remain eager.

**Refactor:** Extend the existing suite/nav model with one typed feature registry: stable key, aliases, label, icon, loader, supported layouts, and explicit capability policy. Derive navigation and route rendering from it. Lazy-load heavy features and exports at their actual entry points. Share shell controller state; keep distinct desktop/mobile chrome.

**Risk:** Preserve old URLs, notification navigation, browser back/forward, persisted selections, public routes, client/contractor portals and view-as isolation. Central navigation metadata does not replace server authorization. A router rewrite or build-tool migration is not required to realize this benefit.

**Estimate:** 600–1,200 net shell/registry lines. Startup bytes should decline, but the exact chunk/latency reduction requires a prototype build and network trace; no numeric speedup is claimed here.

### 8. Share the graphics drawing implementation across runtimes

**Evidence:** [src/lib/imagineRenderer.js](../../src/lib/imagineRenderer.js) explicitly describes itself as a browser-compatible copy of `api/_lib/imagineRenderer.js`. Large matching function bodies include custom visuals, stat cards, plots, text and heatmap calculations. The runtime differences are fonts, image loading, canvas creation and output encoding.

**Refactor:** One pure Canvas drawing module accepting a small environment adapter. Browser adapter returns Blob and uses browser images/fonts; Node adapter returns encoded output using the existing canvas library. Avoid duplicated generated source checked into two locations.

**Validation:** Representative scene fixtures, dimensions, text wrapping, images, opacity, empty data and metric boundaries. Compare render outputs with tolerances for platform font rasterization. Keep async image/font loading separate from drawing semantics.

**Estimate:** 900–1,150 net lines. High confidence in the duplication; useful early win with modest blast radius.

### 9. Give analytics one definition of a metric and reporting period

**Evidence:** Desktop Analytics, mobile web, native AnalyticsScreen, CompareView and weekly reports independently aggregate related tables. Desktop/native use `daily_platform_rollups`; weekly reports aggregate several base tables. Differences can be intentional, but their time-window and revenue/follower semantics are not expressed through a common contract. CompareView downloads rows for both periods and groups them in the browser. Payroll already illustrates the value of a server-side `compute_freelancer_pay` contract, though it should gain a batched read path.

**Refactor:** Define metric units, additive vs point-in-time behavior, time zone, period boundaries, missing-data meaning, platform coverage and provenance. Use common definitions to produce summary queries/RPCs and report data. Keep chart rendering and report wording independent. Return aggregate summaries for dashboards and load detail rows on demand.

Production's sheet list similarly fetches every sheet, including archives, with `select('*')`, pulling full beat payloads before a sheet opens. A summary/list query plus on-open content fetch is a concrete application of the same list-versus-detail separation.

**Risk:** Revenue cents vs dollars, estimated YouTube revenue vs transactions, snapshot followers vs gained followers, sparse data and Pacific date boundaries must be fixture-tested. Do not collapse different business metrics simply because they share a label. Leave applied SQL history untouched; document current definitions separately and evolve through forward migrations.

**Estimate:** 800–1,600 net aggregation/transform lines. Benefits include smaller transfers and consistent numbers; production data and query plans are needed to quantify database savings.

### 10. Remove remaining dead work and obsolete compatibility code carefully

**Evidence:** Dedicated lint found 81 unused bindings after the last cleanup. The usage tracker has a July 7, 2026 kill date but remains imported. Dashboard's unused upcoming-OOO state still receives queries, and ContractorDashboard still fetches a Drive folder ID into unused state. Projects retains unused KanbanCard and associated declarations.

**Refactor:** Remove verified-unused declarations together with their producers where appropriate. Remove the expired tracker/hook/app call. Review unused exports left by the disconnected-file removal. Distinguish UI-only unused state from data that feeds another derived value; never delete a query solely because one state variable is unused.

Compatibility aliases and old role names require evidence that no persisted URLs, stored settings, clients or deployed rows need them. `docx`/`mammoth` and unused root dependencies deserve a separate manifest/clean-install audit; package removal is not a first-party LOC saving and should not be assumed to shrink an already tree-shaken bundle.

**Estimate:** 250–600 net lines, excluding the already removed 3,500 and deeper compatibility retirement requiring production evidence.

### 11. Separate long-running processing from request handling and unify save lifecycle

**Evidence:** Timeline's async `/process-steps` handler calls synchronous concat, Whisper and alignment operations. Whisper uses blocking `subprocess.run` with a 30-minute timeout. Concurrent requests on that worker can be stalled. Transcription creates a JSON tempfile with `delete=False` and does not clean it up. Different editors implement their own debounce, dirty flag, retry and unload behavior; document autosave sends a full HTML snapshot per flush.

**Refactor:** Offload blocking Timeline work to a bounded worker/thread/process or durable job as appropriate. Return job status/cancellation when duration justifies it. Use scoped temp directories and cleanup on failure. Extract a modest save coordinator with revision/sequence protection, flush behavior, dirty-state semantics and explicit error handling; keep document serialization feature-specific.

**Do not indiscriminately parallelize media operations.** Harbor's archiver deliberately processes one session/track at a time on the machine serving NAS files and already has an in-flight lock. Preserve that resource policy. `organize-autotag` also caps its input batch at 12; its `Promise.all` is not an unbounded workload.

**Estimate:** No guaranteed line reduction; 100–300 additional lines may be warranted initially. The benefit is responsiveness and correctness. It is included as replacement overhead in the overall budget rather than presented as code-removal savings.

### 12. Stop tracking installed dependencies

`node_modules` is in `.gitignore`, but **38,656 paths are already tracked**. Their Git blobs total 179,903,625 bytes. The code-file inventory at those paths contains approximately 2,977,968 lines. Ignore rules do not untrack existing files.

**Recommendation:** Verify a clean install from package manifests/lockfiles and check for intentional vendored patches, then remove `node_modules` from the Git index while retaining the local install. Use reproducible installation in CI/deployment. Represent any necessary dependency patch explicitly rather than relying on an edited installed package.

This removes dependency contents from the current tree and future diffs. It does **not** shrink old Git history or installed runtime dependencies. Do not rewrite shared Git history as part of this refactor. It is an attractive quick housekeeping change, but it must not be reported as three million lines of your application simplified.

### 13. Fix the guardrails that let layered fixes persist

The dedicated lint scan found concrete issues in live source:

| File | Finding |
|---|---|
| `src/pages/Projects.js:1050,1104` | `isBusiness` is referenced without a definition. |
| `src/pages/editors/Whiteboard.js:226` | Save button references undefined `save`. |
| `src/pages/analytics/components/FrequencyGrowthChart.js:34,69` | Returns early for sparse data before calling `useState`; hook order changes as data arrives. |
| `src/pages/MyTasks.js:1725` | Duplicate `declineBtn` style key. |
| `src/pages/Production.js:3494` | Duplicate `dragHandle` style key. |

These should be resolved before broad feature extraction. The 84 dependency-array warnings need individual reasoning, not automatic insertion of dependencies that could create loops.

The repository contains seven frontend test files and four Deno test files; no native/Node/Python test files were found by the source inventory. Test file counts are not code coverage. Existing tests are concentrated in helpers/hooks and do not establish safety for task transitions, invoices or editor consolidation. The current pre-commit hook is a style-token ratchet, and no tracked `.github` workflow was found. External CI may exist; it was not inspected.

Add a reproducible lint/type check and focused behavioral tests for each extracted seam. Fix the existing ConfirmContext test's click-versus-mousedown expectation. Use shared contract types for records/commands and a current schema reference; do not migrate every JS file to TypeScript merely to reduce LOC, because types may increase it. Keep useful comments and tests even when that lowers the net deletion number.

## What I would deliberately keep

- Browser, Supabase edge, Vercel/Node and local NAS/Python runtime boundaries. They have different capabilities; sharing pure logic is preferable to one universal execution layer.
- Separate responsive layouts and native UI where interaction needs differ. Shared feature logic does not imply identical screens.
- Tiptap document editing and Lexical screenplay editing until there is a product-backed migration case. Likewise, do not merge all drawing tools simply because they use a canvas.
- Existing style tokens/recipes, Pacific date helpers, message attachment helpers and current query utilities as starting points; complete their adoption or replace them deliberately rather than layering equivalents alongside them.
- Historical migration records and live workflow/BD contracts until a deployment/data audit proves they can be retired.
- Stream Deck, scraper and Obsidian sidecars as separate runtime entry points. Their small sizes do not justify an architectural rewrite for LOC savings.
- The Harbor archive concurrency policy and browser-local media workflows. Those constraints are deliberate, not merely inefficiencies.

## Suggested execution order

1. **Stabilize and establish measurements.** Fix the demonstrated undefined references/hook-order issue and baseline test. Record request counts and major interaction timings. Verify clean installation and untrack vendored dependencies separately.
2. **Bounded early wins.** Consolidate the graphics core, the document-editor core and the duplicated Drive handlers/helpers; remove expired instrumentation/dead producers. Expected owned-code reduction from these narrower efforts: approximately **4,000–6,000 lines**, included in the total estimate.
3. **One vertical pilot.** Messages desktop/mobile using shared UI primitives, a conversation summary read, shared mutations and one query owner. Measure code removed, requests, behavior parity and recovery before expanding the pattern.
4. **Roll out across ordinary feature screens.** Ideas, Invoicing, Roadmap, Contractors and other management pages. Introduce atomic invoice save early; do not combine it with a whole task-table migration.
5. **Migrate high-risk domain ownership.** Task transitions, sync/read models, role capabilities and analytics contracts after fixtures and deployed-state inventory. Retire obsolete adapters only after consumers have moved.

## Acceptance criteria

- Count net source changes after replacement modules and tests; do not count moving files, minification, removing comments, or deleting migrations as architectural savings.
- A shared abstraction must replace old callers in the same migration slice. Avoid leaving the old path plus wrapper plus exception path all active.
- Critical flows retain authorization, deep links, desktop/mobile behavior, report totals and persistence semantics.
- Request counts drop in Messages, notification refresh and Pipeline; duplicate in-flight reads are observable and eliminated. Set latency targets only after recording a baseline.
- Feature bundles load when needed; confirm with a build and browser trace rather than assuming fewer files means fewer bytes.
- Keep the overall **18,000–30,000 line estimate** provisional until the first pilot establishes real deletion-to-replacement ratios. Do not sacrifice useful behavior or tests to hit 24,000.
