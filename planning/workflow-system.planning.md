# Workflow System — Phase 1 Spec

## Overview

A task delegation engine for Mayday Studio. Every multi-step process is modeled as a chain of dependent tasks. Each person sees only what's currently theirs. Completing a step advances the workflow and assigns the next task automatically.

This phase builds the engine and UI surface. No specific workflows yet (Phase 2).

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

Seeded in code via migration, not user-created in Phase 1.

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

**Constraints:**
- Index on `(assignee_id, status)` for the My Tasks query.
- Index on `(workflow_instance_id, status)` for engine lookups.

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

### 1.5 RLS Policies

All four tables:
- Service role: full access (edge functions use service role internally after JWT verification).
- Authenticated users: read own tasks (`assignee_id = auth.uid()`), read workflow_instances they participate in, read task_events for their tasks.
- Admin role: read all rows across all tables.
- Write operations go through edge functions only (no direct client writes).

---

## 2. Workflow Engine (Edge Functions)

### 2.1 Architecture

Workflow definitions live in a shared module: `supabase/functions/shared/workflow-definitions.ts`. Each definition is a plain object — no DB round-trip needed to resolve steps.

Three edge functions handle all mutations:

| Function | Endpoint | Auth |
|----------|----------|------|
| `workflow-start` | POST | User JWT |
| `workflow-complete-task` | POST | User JWT |
| `workflow-update-task` | POST | User JWT |

### 2.2 Workflow Definition Shape

```typescript
interface WorkflowStep {
  stepKey: string;
  titleTemplate: string;             // Handlebars-style: "Review proposal: {{campaign_name}}"
  descriptionTemplate?: string;
  assignee: string | AssigneeResolver; // Static user ID or (context) => userId
  relatedEntity?: {
    type: string;                     // "campaign", "deliverable", etc.
    resolver: (context) => string;    // Returns entity ID from context
  };
  action: TaskAction;                 // See 2.5
  condition?: (context) => boolean;   // If false, step is skipped
  onComplete: (context, payload) => NextStepResult;
  // NextStepResult = { next: string | string[] | null, contextUpdates?: object }
  // string   = single next stepKey
  // string[] = fan-out to multiple stepKeys
  // null     = workflow complete
}

interface WorkflowDefinition {
  slug: string;
  name: string;
  description: string;
  steps: Record<string, WorkflowStep>;  // Keyed by stepKey
  firstStep: string;                     // Starting stepKey
}
```

### 2.3 `workflow-start`

**Input:** `{ slug: string, context: object }`

**Logic:**
1. Validate JWT, get `user.id`.
2. Look up workflow definition by slug.
3. Create `workflow_instances` row (status=active, context=input context, started_by=user.id).
4. Resolve the first step: evaluate condition, resolve assignee, resolve title template.
5. If condition is false, skip to the step's `onComplete` with no payload, repeat for next step.
6. Create `tasks` row (status=active, position=0).
7. Create `task_events` row (event_type=created).
8. Insert into `notifications` table for the assignee (`type='task_assigned'`, `link_tab='my_tasks'`, `link_target=task.id`).
9. Return `{ instance_id, task_id }`.

### 2.4 `workflow-complete-task`

**Input:** `{ task_id: string, payload?: object }`

**Logic:**
1. Validate JWT, get `user.id`.
2. Fetch task, verify `assignee_id = user.id` and `status = 'active'`.
3. Update task: `status='complete'`, `completion_payload=payload`, `completed_at=now()`.
4. Create `task_events` row (event_type=completed, payload).
5. Look up the workflow definition and the current step.
6. Call `step.onComplete(instanceContext, payload)` to get `NextStepResult`.
7. Apply `contextUpdates` to the instance's `context` jsonb.
8. **If `next` is null:** mark instance as complete.
9. **If `next` is a string:** create one task for that step (same flow as start: resolve assignee/title/condition, create task + event + notification).
10. **If `next` is a string[]:** fan-out — create a task for each step key. All get `status='active'`.
11. **Fan-in check:** after completing any task, query all tasks in this instance with `status='pending'`. For each, check if every ID in `depends_on` has `status='complete'`. If yes, flip to `active`, create notification.
12. Return `{ next_task_ids: [...] }`.

### 2.5 `workflow-update-task`

**Input:** `{ task_id: string, action: string, ...params }`

**Actions:**

| Action | Params | Logic |
|--------|--------|-------|
| `hold` | `reason: string` | Set status=on_hold, hold_reason. Create event. Notify Trevor (hardcode admin user ID or query profiles where role=admin). |
| `resume` | — | Set status=active, clear hold_reason. Create event. |
| `snooze` | `until: ISO string` | Set snoozed_until. Create event. Task stays active but UI filters it. |
| `unsnooze` | — | Clear snoozed_until. Create event. |
| `reassign` | `assignee_id: string` | Update assignee_id. Create event. Notify new assignee. |
| `skip` | — | Set status=skipped. Create event. Run fan-in check (same as complete). |

All actions require JWT. `hold`, `resume`, `snooze`, `unsnooze` require `assignee_id = user.id` OR admin role. `reassign` and `skip` require admin role.

### 2.6 Task Action Types

Each step declares how its primary button behaves:

```typescript
type TaskAction =
  | { type: 'complete', label: string }
  // Simple: click button -> completeTask(taskId, {})
  | { type: 'modal', label: string, modalKey: string }
  // Opens a modal (identified by modalKey). Modal submit calls completeTask(taskId, modalPayload).
  | { type: 'navigate', label: string, tab: string, target?: string }
  // Navigates to a page. That page has a button wired to completeTask.
```

---

## 3. My Tasks Page

### 3.1 Placement

New page: `src/pages/MyTasks.js`

Added to sidebar nav below Dashboard. Nav key: `my_tasks`. Visible to all roles.

Badge count in sidebar (next to label) showing number of active + on_hold tasks for the current user.

### 3.2 Data Fetching

```javascript
// Active tasks (not snoozed)
supabase
  .from('tasks')
  .select('*, workflow_instance:workflow_instances(id, workflow_id, context, status)')
  .eq('assignee_id', user.id)
  .in('status', ['active', 'on_hold'])
  .or('snoozed_until.is.null,snoozed_until.lte.' + new Date().toISOString())
  .order('created_at', { ascending: true });
```

Realtime subscription on `tasks` table filtered by `assignee_id = user.id` for live updates.

### 3.3 Component Tree

```
MyTasks
  TaskList
    TaskCard (one per task)
      TaskCardHeader (title, status badge, snooze indicator)
      TaskCardSummary (one-line related entity summary, collapsed by default)
      TaskCardExpanded (full description, entity link — toggled by expand button)
      TaskCardActions
        PrimaryActionButton (label + behavior from step definition)
        HoldButton -> HoldModal (text input: "What's the question?")
        SnoozeButton -> SnoozeDropdown (1h / 4h / tomorrow / next week)
  SnoozedSection (collapsed, shows snoozed tasks with "wake" time)
  CompletedTodaySection (collapsed, shows tasks completed in last 24h)
```

### 3.4 Task Card Design

Follows existing app styling: inline `style={{}}`, dark theme (#0f0f1a base, #6366f1 accent).

- Default card: `background: rgba(255,255,255,0.03)`, `border: 1px solid rgba(255,255,255,0.06)`, `borderRadius: 10`.
- On-hold card: `borderLeft: 3px solid #eab308` (yellow), hold reason shown as a muted yellow line below the title.
- Snoozed card: `opacity: 0.5`, snooze time shown.
- Complete animation: card fades out + slides up over 300ms, then removed from list.

### 3.5 Primary Action Button

The button label and behavior come from the workflow step definition. The My Tasks page needs to know which step each task belongs to, so it can look up the action config.

**Approach:** The step definitions are shared code (imported from `shared/workflow-definitions.ts`). We'll create a client-side mirror: `src/lib/workflowSteps.js` that exports a lookup map of `stepKey -> { action }`. This avoids duplicating templates/assignees (which are server-only concerns) while giving the UI the action config it needs.

```javascript
// src/lib/workflowSteps.js
export const STEP_ACTIONS = {
  review_proposal: { type: 'navigate', label: 'Review Proposal', tab: 'deliverables', target: 'context.proposal_id' },
  assign_editor:   { type: 'modal', label: 'Assign to Editor', modalKey: 'assign_editor' },
  mark_ad_reads:   { type: 'complete', label: 'Mark Ad Reads Complete' },
  // ... added per workflow in Phase 2
};
```

### 3.6 Hold Modal

Small modal overlay:
- Title: "Put task on hold"
- Text input: "What's blocking this?" (required)
- Submit: calls `workflow-update-task` with action=hold
- Result: task card gets yellow border, hold reason visible

### 3.7 Snooze Dropdown

Popover from snooze button with preset options:
- 1 hour
- 4 hours
- Tomorrow 9am
- Next Monday 9am

Calls `workflow-update-task` with action=snooze, `until` = computed ISO timestamp. Snoozed tasks move to a collapsed "Snoozed" section at the bottom.

---

## 4. Notifications

Uses the existing `notifications` table.

| Trigger | Notification type | Recipient | link_tab | link_target |
|---------|-------------------|-----------|----------|-------------|
| Task assigned | `task_assigned` | assignee | `my_tasks` | task.id |
| Task held | `task_held` | all admins | `my_tasks` | task.id |
| Task resumed | `task_resumed` | assignee | `my_tasks` | task.id |
| Task reassigned | `task_reassigned` | new assignee | `my_tasks` | task.id |

AuthContext already fetches `unreadNotificationCount` from the `notifications` table. No changes needed to the bell icon — new notifications will show up automatically.

For the My Tasks nav badge (separate from bell), we add a `fetchMyTaskCount` callback to AuthContext following the existing pattern (e.g. `fetchNewAssignmentCount`).

---

## 5. Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/YYYYMMDD_workflow_tables.sql` | Schema: 4 tables + indexes + RLS |
| `supabase/functions/workflow-start/index.ts` | Start a workflow instance |
| `supabase/functions/workflow-complete-task/index.ts` | Complete a task + advance |
| `supabase/functions/workflow-update-task/index.ts` | Hold / resume / snooze / reassign / skip |
| `supabase/functions/shared/workflow-definitions.ts` | Workflow step definitions (server-side) |
| `supabase/functions/shared/workflow-engine.ts` | Shared engine logic (template resolution, fan-in check) |
| `src/pages/MyTasks.js` | My Tasks page |
| `src/lib/workflowSteps.js` | Client-side step action lookup |

## 6. Files to Modify

| File | Change |
|------|--------|
| `src/pages/AppLayout.js` | Import MyTasks, add nav item, add render condition |
| `src/hooks/useNavConfig.js` | Add `my_tasks` to NAV_ITEMS array |
| `src/contexts/AuthContext.js` | Add `myTaskCount` state + `fetchMyTaskCount` callback + Realtime subscription on `tasks` |

---

## 7. Build Order

### Checkpoint 1: Schema
1. Write and push migration for all 4 tables + indexes + RLS policies.
2. Verify with `supabase migration list`.

### Checkpoint 2: Engine
3. Create `shared/workflow-definitions.ts` with one placeholder workflow (for testing).
4. Create `shared/workflow-engine.ts` with template resolver, fan-in checker, notification helper.
5. Create `workflow-start/index.ts`.
6. Create `workflow-complete-task/index.ts`.
7. Create `workflow-update-task/index.ts`.
8. Deploy all three functions.
9. Test via curl: start workflow -> complete task -> verify fan-in -> verify notifications.

### Checkpoint 3: My Tasks page
10. Create `src/lib/workflowSteps.js` with action lookup.
11. Create `src/pages/MyTasks.js` with full component tree.
12. Modify `AppLayout.js` + `useNavConfig.js` to add nav item.
13. Modify `AuthContext.js` to add task count + Realtime subscription.
14. Test: start a workflow via curl, verify task appears on My Tasks page, complete it, verify it advances.

### Checkpoint 4: Polish
15. Complete animation on task cards.
16. Hold modal + snooze dropdown.
17. Snoozed section + completed-today section.
18. End-to-end test of full lifecycle.

---

## 8. Open Questions

1. **Admin user ID for hold notifications:** Hardcode Trevor's profile UUID, or query `profiles` where `role = 'admin'` on each hold? Querying is more future-proof but adds a DB call.

2. **Workflow definitions versioning:** If a workflow definition changes after instances are in-flight, should in-flight instances use the old definition or the new one? Simplest approach: always use current definition (steps are keyed by `step_key`, so as long as keys are stable, in-flight instances work). Flag for Phase 3.

3. **Task card entity summaries:** The one-line summary for a related entity (campaign name, deliverable title, etc.) requires a lookup. Should the task store a snapshot of the entity title at creation time (in `description` or a `metadata` jsonb), or should the UI fetch it live? Snapshot is simpler and avoids N+1 queries.

4. **Snoozed task wake-up:** With user JWT only (no cron), snoozed tasks rely on the client checking `snoozed_until <= now()` on page load. There's no server-side process to "wake" them. This is fine for Phase 1 since the My Tasks query already filters for it.
