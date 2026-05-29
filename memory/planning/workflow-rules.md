# Workflow Rules

Living doc — updated as patterns are established. Every new workflow follows these conventions.

---

## Build Process

1. User gives the workflow a **name**.
2. User provides a **bulletpoint list** of each step in detail.
3. **No assignees** are specified in the step definitions — user sets those in the builder UI after the workflow is created.
4. Once the full workflow is understood, Claude asks **clarifying questions** using the multiple-choice selector. No building until all questions are answered.
5. Claude wires the **entire workflow in a single pass** — backend (DB rows, handlers, migration, deploy) and frontend (step actions, modals, task card rendering) together.

---

## Architecture

- **Source of truth**: Workflows builder UI (data-driven). The DB rows in `workflow_steps` and `workflow_step_outcomes` are authoritative.
- **No version pinning at runtime**: Engine always reads live DB rows (`resolveWorkflowDefinition` with `null` version). Version snapshots exist for rollback only.
- **Code-sourced workflows** (`source: 'code'`): Reserved for test workflows only. All production workflows are data-driven.

## Step Naming

- `step_key`: snake_case verb phrase describing the action — `review_proposal`, `collect_brief`, `write_ad_reads`, `connect_to_video`
- `title_template`: Human-readable, uses `{{context_key}}` interpolation — `"Write ad read: {{title}}"`
- Fan-out steps reuse the same `step_key` for all spawned tasks; each task is distinguished by `related_entity_id`.

## Action Types

| Type | When to use | Task card behavior |
|------|------------|-------------------|
| `complete` | Simple one-click tasks | Single button, completes on click |
| `modal` | Task requires data entry or selection | Opens modal, completes on submit |
| `navigate` | Task is done elsewhere in the app | Primary button navigates, secondary "Mark Done" button completes |
| `custom` | Complex inline UI (e.g., proposal review) | Fully custom rendering in MyTasks |
| `write_ad_read` | Long-form text entry with autosave | "Write It" opens editor modal (no auto-complete), separate "Complete" button with confirm |

## Modal Conventions

- **Registry**: `src/lib/workflowModals.js` — every modal must be registered here with `{ component, description }`.
- **Props contract**: `({ task, onSubmit, onClose })` — all modals receive these three props.
- **Auto-complete**: By default, `onSubmit` completes the task. Set `noAutoComplete: true` in the registry entry if the modal only saves data (e.g., WriteAdReadModal).
- **Style**: Dark theme (`#15151f` background), 440-520px width, `borderRadius: 16`, consistent with existing modals.

## Client-Side Step Actions

- **Registry**: `src/lib/workflowSteps.js` — maps `step_key` to action config.
- **DB-driven fallback**: Steps not in the hard-coded registry are fetched from `workflow_steps.action_type/action_label/action_config` and cached.
- **Config shape**: `{ type, label, modalKey?, navigateTab?, target? }`

## Fan-Out

- **Config fields**: `fan_out_context_key`, `fan_out_title_template`, `fan_out_entity_type`, `fan_out_entity_id_key`
- **Context array**: The context key (e.g., `deliverables`) must contain an array of objects. Each object must have the entity ID key (e.g., `deliverable_id`).
- **Dedup**: Engine skips items that already have a task with the same `step_key` + `related_entity_id`.
- **Refresh before fan-out**: If the context array may be stale (items added after initial save), the preceding step's `on_complete_handler` should refresh it from the DB (e.g., `ad_read:refresh_deliverables`).

## Fan-In

- **`depends_on_step_keys`**: Array of step keys that must all complete before this step activates.
- **Task status**: Created as `pending` with `depends_on` referencing the blocking task IDs. `checkFanIn` flips to `active` when all deps complete.

## Action Handlers

- **Registry**: `supabase/functions/shared/action-registry.ts`
- **Naming**: `domain:verb_noun` — `ad_read:accept_proposal`, `ad_read:refresh_deliverables`, `ad_read:set_video_event`
- **Contract**: `(ctx, payload, admin) => Promise<{ contextUpdates? }>`
- **Side effects**: Handlers can mutate DB rows (create records, update fields). Context updates are merged into the workflow instance.

## Assignee Resolution

- **`assignee_type: 'static'`**: UUID of a specific user.
- **`assignee_type: 'context'`**: Key in `context` whose value is a user UUID (e.g., `assignee_value: 'creator_id'`).
- **Builder UI** is the source of truth for assignees. Changing it takes effect on the next task creation (no restart needed).

## Task Card Rendering (MyTasks.js)

- **Subtitle**: For deliverable-linked tasks, show `Title + Channel + Due Month` (e.g., "Long Form Read + MD + Jun 2026"). For other entity types, show type + truncated ID.
- **Navigation links**: Small right-aligned link (e.g., "Go to Deliverables >") for tasks that reference content on another page. Uses `onNavigate(tab, contextTarget)`.
- **Confirmation**: Destructive or final actions (completing ad reads) should use a confirm dialog.
- **Button sizing**: Primary action slightly larger (`fontSize: 13, padding: 7px 16px`). Secondary actions uniform (`fontSize: 12, padding: 7px 14px`).

## Outcome Wiring

- **Branching steps**: Multiple outcomes with different `next_step_key` values (e.g., accept -> collect_brief, deny -> null).
- **Linear steps**: Single outcome with `outcome_key: 'complete'`.
- **Terminal steps**: `next_step_key: null` — signals end of workflow branch.

## Edge Function Deployment

- Always deploy with `supabase functions deploy <name> --no-verify-jwt`
- After changing `action-registry.ts`, `workflow-engine.ts`, or `workflow-definitions.ts`, redeploy both `workflow-start` and `workflow-complete-task`.

## DB Migrations

- Migration naming: `YYYYMMDDHHMMSS_description.sql`
- For step config changes that need to hit live DB immediately, use Supabase `execute_sql` in addition to creating the migration file.
