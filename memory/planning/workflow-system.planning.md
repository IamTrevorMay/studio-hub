# Workflow System — Planning Doc

## Overview

A task delegation engine for Mayday Studio. Every multi-step process is modeled as a chain of dependent tasks. Each person sees only what's currently theirs. Completing a step advances the workflow and assigns the next task automatically.

---

## Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Engine + UI | **Complete** | Schema, edge functions, My Tasks page, notifications |
| Phase 2: Ad Read Pipeline | **Complete** | First real workflow wired end-to-end with auto-publish |
| Phase 3A: Data-Driven Builder | **Schema ready** | Builder tables deployed, UI pending |
| Phase 3B: Additional Workflows | Not started | |

---

## 1. Data Model

### 1.1 `workflows`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `gen_random_uuid()` |
| name | text NOT NULL | Human label, e.g. "Ad Read Pipeline" |
| description | text | |
| slug | text UNIQUE NOT NULL | Code key, e.g. `ad_read_workflow` |
| is_active | boolean DEFAULT true | Soft-disable without deleting |
| created_at | timestamptz DEFAULT now() | |

### 1.2 `workflow_instances`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_id | uuid FK workflows ON DELETE CASCADE | |
| status | text CHECK (`active`, `complete`, `cancelled`) | |
| context | jsonb DEFAULT '{}' | Live state bag (campaign_id, deliverable_ids, etc.) |
| started_by | uuid FK profiles ON DELETE SET NULL | User who kicked off the workflow |
| started_at | timestamptz DEFAULT now() | |
| completed_at | timestamptz | Set when status flips to complete/cancelled |

### 1.3 `tasks`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_instance_id | uuid FK workflow_instances ON DELETE CASCADE | |
| step_key | text NOT NULL | Matches the step definition, e.g. `review_proposal` |
| title | text NOT NULL | Rendered title, e.g. "Review proposal: AG1 campaign" |
| description | text | Expanded detail |
| assignee_id | uuid FK profiles ON DELETE SET NULL | Who owns this task right now |
| status | text CHECK (`pending`, `active`, `on_hold`, `complete`, `skipped`) | |
| related_entity_type | text | `campaign`, `deliverable`, `video`, `proposal`, etc. |
| related_entity_id | uuid | FK is app-level, not DB-enforced (polymorphic) |
| hold_reason | text | Filled when status = on_hold |
| completion_payload | jsonb | Data returned by the user on complete (e.g. selected editor ID) |
| position | integer DEFAULT 0 | Ordering within the workflow instance |
| depends_on | uuid[] DEFAULT '{}' | Task IDs this task is waiting on (fan-in) |
| snoozed_until | timestamptz | Null = not snoozed |
| created_at | timestamptz DEFAULT now() | |
| completed_at | timestamptz | |

**Indexes:**
- `idx_tasks_assignee_status` on `(assignee_id, status)` — My Tasks query
- `idx_tasks_instance_status` on `(workflow_instance_id, status)` — engine lookups
- `idx_tasks_snoozed` on `(snoozed_until)` WHERE snoozed_until IS NOT NULL

**Fan-out/fan-in:**
- Fan-out: a step's completion handler creates multiple tasks with `status = 'active'`.
- Fan-in: the next step is created with `depends_on = [taskA.id, taskB.id]` and `status = 'pending'`. When each dependency completes, the engine checks if all `depends_on` tasks are complete. If yes, it flips the pending task to `active`.

### 1.4 `task_events`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| task_id | uuid FK tasks ON DELETE CASCADE | |
| event_type | text CHECK (`created`, `completed`, `held`, `resumed`, `reassigned`, `snoozed`, `skipped`) | |
| actor_id | uuid FK profiles ON DELETE SET NULL | Who did this |
| payload | jsonb DEFAULT '{}' | Event-specific data |
| created_at | timestamptz DEFAULT now() | |

Index on `(task_id, created_at)`.

### 1.5 Builder Tables (Phase 3A)

Added by `20260529100000_workflow_builder_schema.sql`:

- `workflow_steps` — data-driven step definitions (title template, assignee, action config, outcomes)
- `workflow_step_outcomes` — outcome edges between steps (next step, context updates)
- `workflow_versions` — version snapshots for in-flight instance pinning

Extended columns on `workflows`: builder metadata.
Extended columns on `workflow_instances`: `workflow_version_id` for version pinning.

### 1.6 RLS Policies

All tables:
- Service role: full access (edge functions use service role internally after JWT verification).
- Authenticated users: read own tasks (`assignee_id = auth.uid()`), read workflow_instances they participate in, read task_events for their tasks.
- Admin role: read all rows across all tables.
- Builder tables (`workflow_steps`, `workflow_step_outcomes`, `workflow_versions`): admin-only read/write.
- Write operations go through edge functions only (no direct client writes).

---

## 2. Workflow Engine (Edge Functions)

### 2.1 Architecture

Workflow definitions support two modes:
1. **Code-sourced:** definitions in `supabase/functions/shared/workflow-definitions.ts` (WORKFLOW_REGISTRY). Used for test workflows and the ad read pipeline.
2. **Data-sourced:** definitions built from `workflow_steps` + `workflow_step_outcomes` DB rows via `buildDefinitionFromDB()`. Used by the visual builder (Phase 3A).

Resolution order: `resolveWorkflowDefinition()` checks code registry first, then DB.

Five edge functions:

| Function | Purpose | Auth |
|----------|---------|------|
| `workflow-start` | Start a workflow instance | User JWT |
| `workflow-complete-task` | Complete a task + advance | User JWT |
| `workflow-update-task` | Hold / resume / snooze / reassign / skip | User JWT |
| `workflow-list-actions` | List registered action handler slugs (for builder) | Admin JWT |
| `workflow-cleanup-test` | Delete test_mode instances (simulator cleanup) | Admin JWT |

### 2.2 Workflow Definition Shape

```typescript
interface WorkflowStep {
  stepKey: string;
  titleTemplate: string;             // Handlebars-style: "Review proposal: {{campaign_name}}"
  descriptionTemplate?: string;
  assignee: string | AssigneeResolver; // Static user ID or (context) => userId
  relatedEntity?: {
    type: string;
    resolver: (context) => string;
  };
  action: TaskAction;
  condition?: (context) => boolean;   // If false, step is skipped
  dynamicFanOut?: DynamicFanOutConfig; // Per-item fan-out (e.g. one task per deliverable)
  onComplete: (context, payload) => NextStepResult;
  // NextStepResult = { next: string | string[] | null, contextUpdates?: object }
}

interface WorkflowDefinition {
  slug: string;
  name: string;
  description: string;
  steps: Record<string, WorkflowStep>;
  firstStep: string;
}
```

### 2.3 Shared Engine (`workflow-engine.ts`)

Key functions:
- `createTaskFromStep()` — resolves assignee/title/condition, creates task + event + notification
- `createDynamicFanOutTasks()` — per-item fan-out with deduplication
- `checkFanIn()` — activates pending tasks when all `depends_on` complete
- `checkInstanceCompletion()` — marks instance complete when no active/pending/on_hold tasks remain
- `advanceWorkflow()` — creates next step(s): single, multi (fan-out), or null (terminate)
- `notifyUser()` / `notifyAdmins()` — notification helpers
- `logEvent()` — task_events audit trail
- `getUserFromJwt()` — JWT auth with admin role lookup

### 2.4 Action Types

```typescript
type TaskAction =
  | { type: 'complete', label: string }
  | { type: 'modal', label: string, modalKey: string }
  | { type: 'navigate', label: string, tab: string, target?: string }
  | { type: 'custom' }  // Handled inline by the UI (e.g. ReviewProposalCard)
```

### 2.5 Action Registry

`supabase/functions/shared/action-registry.ts` maps handler slugs to TypeScript functions for data-driven workflows. Current handlers: `accept_proposal`, `decline_proposal`, `review_proposal`, `set_video_event`.

---

## 3. My Tasks Page

### 3.1 Placement

Page: `src/pages/MyTasks.js` (~991 lines)

Sidebar nav item below Dashboard. Nav key: `my_tasks`. Visible to all roles.
Badge count in sidebar showing active + on_hold tasks for the current user (via `myTaskCount` in AuthContext).

### 3.2 Data Fetching

- Main query: `tasks` table, `assignee_id = user.id`, `status IN ['active', 'on_hold']`, joined with `workflow_instances` for context.
- Completed tasks query: `status = 'complete'`, `completed_at >= 24h ago`.
- Snoozed tasks partitioned client-side from the active set.
- Realtime subscription on `tasks` table filtered by `assignee_id`.
- `useVisibilityRefresh` hook for tab re-focus.

### 3.3 Component Tree

```
MyTasks
  TaskList
    TaskCard (one per task)
      TaskCardHeader (title, status badge, age)
      ReviewProposalCard (inline for review_proposal step — shows sponsor, items, pay)
      TaskCardExpanded (description toggle)
      TaskCardActions
        PrimaryActionButton (from step action config)
        HoldButton → HoldModal
        SnoozeButton → SnoozeDropdown
  SnoozedSection (collapsed, shows snoozed tasks with wake time)
  CompletedTodaySection (collapsed, shows tasks completed in last 24h)
  HoldModal (overlay with reason input)
```

### 3.4 Task Card Design

- Default card: `background: rgba(255,255,255,0.03)`, `border: 1px solid rgba(255,255,255,0.06)`, `borderRadius: 10`.
- On-hold card: `borderLeft: 3px solid #eab308` (yellow), hold reason shown as muted yellow line.
- Snoozed card: `opacity: 0.5`, snooze time shown.
- Complete animation: fade + slide-up over 300ms.

### 3.5 Client-Side Step Actions

`src/lib/workflowSteps.js` exports `STEP_ACTIONS` lookup and `getStepAction(stepKey)`.

Current actions:
- `review_proposal`: type 'custom' (inline ReviewProposalCard with accept/decline)
- `collect_brief`: type 'navigate' to 'deliverables' tab
- `write_ad_reads`: type 'complete'
- `connect_to_video`: type 'modal', modalKey 'pick_video_event'
- Test workflow steps: type 'complete'

Falls back to `DEFAULT_ACTION` for unknown step keys.

### 3.6 Modals

- **HoldModal** — "What's blocking this?" text input, calls `workflow-update-task` action=hold
- **PickVideoEventModal** (`src/lib/workflowModals.js`) — connects deliverables to calendar video events

### 3.7 Snooze Dropdown

Presets: 1h, 4h, tomorrow 9am, next Monday 9am.
Calls `workflow-update-task` action=snooze. Snoozed tasks filtered to collapsed section.

---

## 4. Notifications

Uses the existing `notifications` table.

| Trigger | Type | Recipient |
|---------|------|-----------|
| Task assigned | `task_assigned` | assignee |
| Task held | `task_held` | all admins |
| Task resumed | `task_resumed` | assignee |
| Task reassigned | `task_reassigned` | new assignee |

AuthContext `myTaskCount` state + Realtime subscription drives the sidebar badge.
Bell icon uses existing `unreadNotificationCount` — workflow notifications appear automatically.

---

## 5. Files

### Created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260528000000_workflow_system.sql` | Phase 1 schema: 4 tables + indexes + RLS |
| `supabase/migrations/20260529100000_workflow_builder_schema.sql` | Phase 3A schema: builder tables + version pinning |
| `supabase/functions/workflow-start/index.ts` | Start a workflow instance |
| `supabase/functions/workflow-complete-task/index.ts` | Complete a task + advance |
| `supabase/functions/workflow-update-task/index.ts` | Hold / resume / snooze / reassign / skip |
| `supabase/functions/workflow-list-actions/index.ts` | List action handler slugs for builder |
| `supabase/functions/workflow-cleanup-test/index.ts` | Delete test_mode instances |
| `supabase/functions/shared/workflow-definitions.ts` | Workflow definitions (code + data-sourced) |
| `supabase/functions/shared/workflow-engine.ts` | Shared engine logic |
| `supabase/functions/shared/action-registry.ts` | Handler slug → function map for data-driven workflows |
| `src/pages/MyTasks.js` | My Tasks page |
| `src/lib/workflowSteps.js` | Client-side step action lookup |
| `src/lib/workflowModals.js` | Modal registry (PickVideoEventModal) |

### Modified

| File | Change |
|------|--------|
| `src/pages/AppLayout.js` | Import MyTasks, add nav item + sidebar badge, add render condition |
| `src/contexts/AuthContext.js` | `myTaskCount` state + `fetchMyTaskCount` + Realtime subscription on `tasks` |

---

## 6. Resolved Questions

1. **Admin user ID for hold notifications:** Resolved — `notifyAdmins()` queries `profiles` where `role = 'admin'`. Future-proof.
2. **Workflow definitions versioning:** Resolved — Phase 3A adds `workflow_versions` table. Data-sourced workflows pin version at instance start. Code-sourced workflows always use current definition.
3. **Task card entity summaries:** Resolved — snapshots stored in task `title` and `description` at creation time. ReviewProposalCard fetches live data for the proposal step specifically.
4. **Snoozed task wake-up:** Resolved — client-side filtering on page load. No server cron needed.

---

## 7. What's Next

### Phase 3A: Visual Workflow Builder
- Schema deployed (workflow_steps, workflow_step_outcomes, workflow_versions)
- `workflow-list-actions` edge function ready
- `buildDefinitionFromDB` / `buildDefinitionFromSnapshot` functions ready
- **Remaining:** Builder UI page (Apple Shortcuts-style canvas, already started per recent commits)

### Future Phases
- Comments / discussion threads on tasks
- File attachments on tasks
- Recurring workflows (scheduled triggers)
- Workflow analytics (avg completion time, bottleneck detection)
- Non-admin task assignees with scoped visibility
