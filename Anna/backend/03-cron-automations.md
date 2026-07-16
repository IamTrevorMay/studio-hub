---
title: Scheduled and Event-Driven Backend (Cron, Automations, Workflows)
last_updated: 2026-07-15
tags: [backend, cron, pg_cron, automations, workflows, edge-functions]
---

# Scheduled and Event-Driven Backend

Three related systems drive things that happen without a user clicking a button: **pg_cron** (time-based edge-function invocation), the **Automations** system (admin-configurable trigger→action rules), and the **Workflow** engine (multi-step task pipelines). They interlock through one edge function — `run-automations` — and one shared secret.

## pg_cron: how scheduled work fires

Postgres runs the schedules via the `pg_cron` extension; each job uses `pg_net`'s `net.http_post` to hit an edge function URL, authenticating with the shared cron secret in the query string. Jobs are registered **in migrations** with `cron.schedule(name, cron_expr, sql)` and updated by unschedule+reschedule.

The canonical modern form reads the secret from **Vault** at execution time:

```sql
select cron.schedule(
  'daily-generate-trends',
  '0 15 * * *',   -- 15:00 UTC = 8:00 AM PT (during PST)
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/generate-trends?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$cron$
);
```
(`20260601140000_cron_secret_via_vault.sql`)

The receiving function validates that `?secret=` matches its `CRON_SECRET` env var (doc 01, auth pattern 2). The Vault value and the edge-function env var must be the same string.

### The hardcoded-secret caveat

The **original** trends cron migration hardcoded the secret directly in the SQL:

```sql
-- 20260328200001_cron_generate_trends.sql
url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/generate-trends?secret=300897BA-1E26-4328-97E8-FFB11BCF2C6D',
```

That value has since been **rotated and moved to Vault** (`20260601140000_cron_secret_via_vault.sql` supersedes it and re-registers the job reading from `vault.decrypted_secrets`). The stale literal still exists in git history and in that old migration file — it is dead. **Never copy that pattern.** All new cron jobs and trigger functions must read `cron_secret` from Vault. The superseding migration lists every file it replaced (trends, run-reports, daily-graphics, snapshot-daily-work, drive-watch-poll, run-automations, and several trigger functions).

### Notable jobs (all times UTC; PT = UTC−8/−7)

| Job | Schedule | Target fn |
|---|---|---|
| `daily-generate-trends` | `0 15 * * *` (8am PT) | generate-trends |
| `run-reports` | `5 15 * * *` | run-report |
| `daily-fetch-graphics` / `daily-post-graphics` | `0 13` / `15 13` | fetch/post-daily-graphics |
| `nightly-snapshot-daily-work` | `59 7 * * *` | snapshot-daily-work |
| `minutely-drive-watch-poll` | `* * * * *` | drive-watch-poll |
| `hourly-run-automations` | `0 * * * *` | run-automations |
| plaid sync, tiller sync, weekly report, ashley-read, mailer tick, refresh-rollups, business-dev notifications, archive-published-cards, etc. | various | respective fns |

Find them all: `grep -rl "cron.schedule" supabase/migrations/`.

### Triggers also call edge functions

Some flows fire on data change, not on a clock. `SECURITY DEFINER` trigger functions read `cron_secret` from Vault and `net.http_post` to a function. Examples in `20260601140000_cron_secret_via_vault.sql`:

- `trg_fl_assignment_notify_new_owner` → `notify-fl-assignment` (freelancer reassignment)
- `trg_mayday_video_start` → `workflow-internal` (a beat sheet entering the "mayday" folder starts the video workflow)
- `trg_mayday_video_match_film` / `_wait` → `workflow-internal` (editor assignment auto-advances the workflow)
- `fn_campaign_brief_auto_complete` → `workflow-brief-complete` (brief_url set → complete the brief step)

This is the "database change → HTTP → edge function" bridge. It's how `sync-youtube` also fires events (below), except that one originates in TypeScript.

## The Automations system

Admin-configurable **trigger→action** rules living in the Workflows page's "Automations" tab. Two tables, one engine function.

### Tables (`20260601100000_create_automations.sql`)

- **`automations`**: `name`, `is_enabled`, `trigger_type` (`'schedule'|'event'`), `trigger_config` jsonb, `actions` jsonb array, `dedup_key` (template string), `run_count`, `last_run_at`, `last_error`, plus `requires_confirmation`/`confirmation_admin_id` (added later). Admin-only RLS.
- **`automation_runs`**: audit log — `automation_id`, `trigger_payload`, `actions_taken`, `status` (`success|skipped|error|pending_confirmation`), `error_message`, `dedup_key`. Admin read/insert RLS.
- **`tasks.automation_id`** (FK, `on delete set null`) + **`tasks.link_url`** were added to link generated tasks back and drive the "Go To Work" button.
- RPC **`increment_automation_run_count(automation_uuid)`** — `SECURITY DEFINER`, atomic `run_count = run_count + 1`.

### The engine: `run-automations/index.ts`

One function, two invocation modes, decided by the request body.

**Schedule mode** (empty body, cron caller): queries enabled `trigger_type='schedule'` automations and checks each against the current time via `shouldFireSchedule(config, nowUtc)` (`:112-137`). Config types:
- `days_of_month` — `days: number[]` + hour (payroll: days 1 & 15)
- `daily` — hour only
- `weekly` — `day_of_week` + hour

**Crucially, day/date intent is evaluated in Pacific time** while the firing *hour* is UTC. Helpers `ptDayOfMonth` / `ptDayOfWeek` / `ptDayString` compute the PT calendar (`:88-99`), and `targetUtcHour` converts a stored `hour_pt` to UTC live for DST (`:71-81`). Without this, a schedule firing after PT-midnight-in-UTC would be a day off. Since cron fires hourly (`hourly-run-automations`), schedules are hour-granular.

**Event mode** (`{ event, source, payload }` body): queries enabled `trigger_type='event'` automations, matches `trigger_config.event === event` and optional `source` (`:594-603`). **Event mode requires the CRON_SECRET** — an admin JWT is rejected here, so nobody can hand-forge a `new_video` event and synthesize fake tasks (`:580-582`).

### Actions

`executeAutomation` iterates the `actions` array. Two action types (`:198-218`):

- **`create_task`** (`executeCreateTask`, `:341-426`): resolves templated `title`/`description`/`link_url`/`due_date`/`nav_target`, resolves assignees by `assignee_type` (`all_admins` → all admin profiles; `specific` → `assignee_id`; `context` → pull an id out of the payload by key), and inserts one task per assignee.
- **`send_notification`** (`executeSendNotification`, `:429-464`): inserts `notifications` rows for `all_admins` or a `specific` recipient.

### `{{variable}}` template resolution

`resolveTemplate(template, context)` does `{{key}}` → `String(context[key])` replacement (`:25-33`). Context is the trigger payload (event mode) or `getScheduleContext()` which supplies `today`, `day_of_month`, `day_of_week` (PT-anchored, `:102-109`).

### Dedup — the important subtlety

`dedup_key` is itself a template, e.g. `payroll_{{today}}` or `clip_{{video_id}}`. It's resolved with **`resolveTemplateStrict`** which reports whether any referenced variable was **missing** (`:39-53`). If a variable is absent, the run is **skipped entirely** rather than collapsing to a partial key like `clip_` that would falsely dedup unrelated events or fire duplicates on retry (`:157-167`). Dedup check: skip if an `automation_runs` row with the same `automation_id` + resolved `dedup_key` in status `success` or `pending_confirmation` already exists (`:172-184`).

Task creation is **idempotent per (automation, dedup_key, assignee)**: a pre-check plus a unique-index `upsert(..., { onConflict: "automation_id,dedup_key,assignee_id", ignoreDuplicates: true })` closes the concurrent-run race (`:387-421`).

### Confirmation gate

If `requires_confirmation`, actions are **deferred**: a `pending_confirmation` run row is inserted up front (so dedup blocks repeats) and a "Confirm: <name>" task is assigned to the chosen admin (or all admins). Approving fires the real actions via the `approve-automation` function; `run_count` is incremented on resolution, not at gate time (`createConfirmationGate`, `:252-338`; `logRun` skips the increment for `pending_confirmation`, `:497-504`).

### Seeded automations

- **Payroll Reminder** — schedule, `days_of_month` [1,15], `create_task` → all admins.
- **Clip Video** — event `new_video` from source `More Mayday`, `create_task` → David Korn, with `link_url` to the video.

### How events get fired

`sync-youtube` fires `new_video` after ingesting new non-short videos. It first **verifies the rows actually persisted** in `content_items` (to avoid an infinite new_video loop when a batch upsert silently drops rows), then POSTs to `run-automations` with the cron secret in the query string:

```ts
await fetch(`${supabaseUrl}/functions/v1/run-automations?secret=${cronSecret}`, {
  method: "POST",
  body: JSON.stringify({
    event: "new_video", source: account.account_name,
    payload: { video_id, video_title, video_url },
  }),
});
```
(`sync-youtube/index.ts:457-504`)

So the event bus is: **any function (or trigger) → HTTP POST to `run-automations?secret=…` with `{event, source, payload}`**. There's no message queue; it's direct HTTP + the shared secret.

## The Workflow system (verified deep-dive)

Distinct from Automations. Workflows are **multi-step task pipelines** (e.g. the Mayday video pipeline: brief → film → send-to-editor → wait-on-edit → publish). The engine is `supabase/functions/shared/workflow-engine.ts` (827 lines) with three siblings in `shared/`: `workflow-definitions.ts` (431), `action-registry.ts` (309), `handler.ts` (149). **There are two step models in one engine** — know which you're touching.

### Model A — the column / sign-off state machine (the live one)

This is what `workflow-start`, `workflow-complete-task`, and `workflow-move-card` actually run. Steps are **DB rows** in `workflow_steps` (loaded by `loadColumns`, `workflow-engine.ts:173-190`), not code. A workflow instance is a kanban card (`workflow_instances`) whose `current_step_key` points at a column.

State primitives (`workflow-engine.ts`):
- **`Column`** = a `workflow_steps` row: `step_key`, `title_template`, `description_template`, `position`, `default_assignee_ids`, `entry_action_type`, `is_terminal` (`:17-27`).
- **`enterColumn(admin, instance, column, actorId)`** (`:219-298`) is the heart. Terminal column → set instance `status='complete'` + `completed_at`, no task. Empty assignee set → set `status='blocked'` and halt the card (`:245-251`). Otherwise: point `current_step_key` at the column, insert **one shared** `tasks` row with `requires_sign_off = true` and `assignee_id = null` (`:260-273`), then insert **one `task_sign_offs` row per assignee** (`:278-286`), notify each, and route Sprint Board cards for opted-in users via `maybeCreateSprintCards` (`:295`).
- **`resolveAssignees(instance, column)`** (`:211-215`) — per-card override in `instance.assignee_overrides[step_key]` wins over `column.default_assignee_ids`.

Advancing (`signOffTask`, `:371-460`): validate the caller has a **pending** sign-off row (reject if none or already signed) → stamp `signed_off_at` → if any sign-offs still pending, stop (task not yet complete). When the **last** sign-off lands: mark the task `complete`; `isColumnDone` (`:338-367`) confirms no other open tasks in the column; find `nextColumn` by position (`:200-207`); if none, `completeInstance`; else `enterColumn(next)`. So a card walks forward one column per fully-signed task. `skipOpenTasksInColumn` (`:302-334`) is the escape hatch `workflow-move-card` uses — it marks open tasks `skipped` and deletes their pending sign-offs.

`reassignTask` (`:464-516`) rebuilds the sign-off set for a task mid-flight, **preserving** already-completed sign-offs for retained users and writing a `workflow_card_audit` row.

### Model B — the code-defined `WorkflowDefinition` (legacy + fan-out)

`workflow-definitions.ts` defines a `WorkflowStep` interface (`:32-50`) with code hooks: `assignee` (string or `(context)=>id`), `condition`, `dependsOnSteps` (fan-in), `dynamicFanOut` (one task per array element), and an **`onComplete(context, payload, admin) => { next, contextUpdates }`** handler that decides the next step key(s). `WORKFLOW_REGISTRY` (`:414`) holds the code-defined workflows — on disk that's `test_workflow` and `test_fan_workflow` (`:346,373`); real workflows are built **from DB rows** by the `buildWorkflowFromRows`-style constructor (`:213-254`), which maps `workflow_steps` + outcome rows + `on_complete_handler` names into the same shape.

This model's task creation lives in `advanceWorkflow` (`:753-827`):
- `createTaskFromStep` (`:631-689`) — one task; `status = 'pending'` if it has unmet `depends_on`, else `'active'`.
- `createDynamicFanOutTasks` (`:691-751`) — reads `context[fanOut.contextKey]` (an array), creates one task per item keyed by `relatedEntityIdKey`, **idempotently skipping items whose entity already has a task** (`:710,720`). This is how "one ad-read task per deliverable" fans out.
- Fan-in: `checkFanIn` (`:576-609`) scans `pending` tasks and flips one to `active` once **all** its `depends_on` tasks are `complete`/`skipped`. Called at the end of every `advanceWorkflow`.

Named side-effects are the **action registry** (`action-registry.ts:189-295`): `getActionHandler(slug)` (`:297-299`) returns a handler by slug. Live slugs: `ad_read:accept_proposal` (creates sponsor+campaign+deliverables, stashes them in context for fan-out), `ad_read:decline_proposal`, `ad_read:review_proposal`, `ad_read:refresh_deliverables` (re-pulls `sponsor_deliverables` so late additions fan out), `ad_read:set_video_event`, and `mayday:film_send_handoff` (stashes `editor_assignment_id` so the wait-on-edit step can match the assignment's completion). Handlers return `{ contextUpdates }` that get merged into the instance context.

### How steps get triggered

- **User completes a task** → `workflow-complete-task` (JWT). Sign-off path (`:54-97`) calls `signOffTask`; regular-complete path (`:99-135`) marks the task done, reverse-syncs any linked `personal_tasks` sprint card to `done` (`:121-135`), and for standalone tasks may auto-advance a project (`:137+`).
- **DB trigger auto-completes a step** → `workflow-internal` (CRON_SECRET) with `op: 'complete_match'`. The `trg_mayday_video_*` triggers use this — e.g. an editor assignment being created auto-advances the wait-on-edit step (the "editor assignment auto-advances the workflow" handoff).
- **Event creates a card** → `workflow-trigger-event` (dual). **Gated off** now (below).

### The kill switches (both matter)

- **`WORKFLOWS_DISABLED`** (env, on `workflow-start`/`-internal`/`-trigger-event`) — server-side kill switch for the whole engine.
- **`WORKFLOWS_CREATION_DISABLED = true`** (`src/lib/workflowApi.js:8`) — the **currently-active** gate. It's "Phase 2 of unified Kanban migration: stop creating new workflow instances." The client's `callWorkflowFn` short-circuits `workflow-start` and `workflow-trigger-event` to a no-op (`workflowApi.js:11-14`). **In-flight workflows keep advancing** via `workflow-complete-task`; no new ones are minted. When reasoning about "why didn't a new card appear," this flag is the first suspect, not the engine.

### Client-side glue (not orchestration)

- `src/lib/workflowSteps.js` — `getStepAction(stepKey, task)` picks which button MyTasks renders: `sign_off` if `requires_sign_off`, `write_ad_read` for `write_ad_reads`, else default `complete` (`:13-18`). Also names `step_key: 'automation'` for standalone automation-created tasks.
- `src/lib/workflowModals.js` — modal registry for tasks whose `action_type === 'modal'` (MyTasks looks up by `modalKey`): `PickVideoEventModal`, `AddBriefModal`, `WriteAdReadModal`, etc.
- `src/lib/workflowCatalog.js` — plain-English label catalogs for the Workflows **builder** UI (trigger/action sentence builder).
- `src/lib/workflowApi.js` — thin client (`callWorkflowFn`) that carries the JWT and enforces the creation gate above.

None of these orchestrate; the state machine is entirely server-side in `workflow-engine.ts`.

## Mental model

- **Clock-based** work: pg_cron → `net.http_post(fn?secret=…)`, secret from Vault. Register in a migration.
- **Rule-based** work: `run-automations` (schedule or event mode), admin-configured, dedup-guarded, PT-aware.
- **Pipeline** work: the workflow engine, advanced by user actions and DB triggers.
- The glue for all three is the single `cron_secret` (Vault + `CRON_SECRET` env), and the transport is plain HTTP POST — no queue.
