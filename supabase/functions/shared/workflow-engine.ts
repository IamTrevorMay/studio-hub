// Kanban workflow engine — sign-off model.
// Workflow = board, workflow_steps rows = columns (ordered by position),
// workflow_instance = card. When a card enters a column, ONE shared task
// is created with a task_sign_offs row per resolved assignee.
// Card advances when all sign-offs are complete.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getWorkflowDefinition,
  resolveTemplate,
  type WorkflowStep,
  type WorkflowDefinition,
} from "./workflow-definitions.ts";

// ─── Types ─────────────────────────────────────────────────────

export interface Column {
  id: string;
  workflow_id: string;
  step_key: string;
  title_template: string;
  description_template: string | null;
  position: number;
  default_assignee_ids: string[];
  entry_action_type: string;
  is_terminal: boolean;
}

export interface Instance {
  id: string;
  workflow_id: string;
  title: string | null;
  status: string;
  context: Record<string, unknown>;
  current_step_key: string | null;
  assignee_overrides: Record<string, string[]>;
  test_mode: boolean;
}

// ─── Admin client ──────────────────────────────────────────────

export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ─── Auth helper ───────────────────────────────────────────────

export async function getUserFromJwt(
  req: Request,
): Promise<{ userId: string; isAdmin: boolean } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return { userId: user.id, isAdmin: profile?.role === "admin" };
}

// ─── CORS ──────────────────────────────────────────────────────

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Notification + event helpers ──────────────────────────────

export async function notifyUser(
  admin: SupabaseClient,
  userId: string,
  title: string,
  body: string,
  taskId: string,
  testMode = false,
) {
  if (testMode) return;
  await admin.from("notifications").insert({
    user_id: userId,
    type: "task_assigned",
    title,
    body,
    link_tab: "my_tasks",
    link_target: taskId,
    is_read: false,
  });
}

export async function logEvent(
  admin: SupabaseClient,
  taskId: string,
  eventType: string,
  actorId: string,
  payload: Record<string, unknown> = {},
) {
  await admin.from("task_events").insert({
    task_id: taskId,
    event_type: eventType,
    actor_id: actorId,
    payload,
  });
}

// ─── Column lookups ────────────────────────────────────────────

export async function loadColumns(
  admin: SupabaseClient,
  workflowId: string,
): Promise<Column[]> {
  const { data, error } = await admin
    .from("workflow_steps")
    .select("id, workflow_id, step_key, title_template, description_template, position, default_assignee_ids, entry_action_type, is_terminal")
    .eq("workflow_id", workflowId)
    .order("position", { ascending: true });
  if (error) throw new Error(`loadColumns: ${error.message}`);
  return (data || []).map((c) => ({
    ...c,
    default_assignee_ids: c.default_assignee_ids || [],
    entry_action_type: c.entry_action_type || "create_task",
    is_terminal: c.is_terminal || false,
    description_template: c.description_template || null,
  })) as Column[];
}

export function findColumn(
  columns: Column[],
  stepKey: string | null,
): Column | null {
  if (!stepKey) return null;
  return columns.find((c) => c.step_key === stepKey) || null;
}

export function nextColumn(
  columns: Column[],
  stepKey: string,
): Column | null {
  const i = columns.findIndex((c) => c.step_key === stepKey);
  if (i < 0 || i >= columns.length - 1) return null;
  return columns[i + 1];
}

// ─── Resolve assignees for a card in a column ──────────────────

export function resolveAssignees(instance: Instance, column: Column): string[] {
  const override = instance.assignee_overrides?.[column.step_key];
  if (Array.isArray(override) && override.length > 0) return override;
  return column.default_assignee_ids || [];
}

// ─── Enter a column (sign-off model) ────────────────────────────

export async function enterColumn(
  admin: SupabaseClient,
  instance: Instance,
  column: Column,
  actorId: string,
): Promise<{ taskIds: string[]; blocked: boolean }> {
  // Terminal column — no task, just park the card.
  if (column.is_terminal) {
    await admin
      .from("workflow_instances")
      .update({
        current_step_key: column.step_key,
        status: "complete",
        completed_at: new Date().toISOString(),
      })
      .eq("id", instance.id);
    return { taskIds: [], blocked: false };
  }

  const assignees = resolveAssignees(instance, column);
  const cardTitle = instance.title || "Untitled card";
  const taskTitle = column.title_template
    ? `${cardTitle} — ${column.title_template}`
    : `${cardTitle} — ${column.step_key}`;

  // Empty column = halt card.
  if (assignees.length === 0) {
    await admin
      .from("workflow_instances")
      .update({ status: "blocked", current_step_key: column.step_key })
      .eq("id", instance.id);
    return { taskIds: [], blocked: true };
  }

  // Update card pointer to this column + ensure status active.
  await admin
    .from("workflow_instances")
    .update({ current_step_key: column.step_key, status: "active" })
    .eq("id", instance.id);

  // Insert ONE shared task with requires_sign_off = true.
  const { data: created, error } = await admin
    .from("tasks")
    .insert({
      workflow_instance_id: instance.id,
      step_key: column.step_key,
      title: taskTitle,
      description: column.description_template || null,
      assignee_id: null,
      status: "active",
      position: column.position * 100,
      requires_sign_off: true,
    })
    .select("id, title")
    .single();

  if (error || !created) throw new Error(`enterColumn insert: ${error?.message}`);

  // Insert sign-off rows for each assignee.
  const signOffRows = assignees.map((uid) => ({
    task_id: created.id,
    user_id: uid,
    signed_off_at: null,
  }));
  const { error: soErr } = await admin
    .from("task_sign_offs")
    .insert(signOffRows);
  if (soErr) throw new Error(`enterColumn sign_offs: ${soErr.message}`);

  // Log + notify each assignee.
  await logEvent(admin, created.id, "created", actorId, { column: column.step_key });
  for (const uid of assignees) {
    await notifyUser(admin, uid, "New task assigned", created.title, created.id, instance.test_mode);
  }

  return { taskIds: [created.id], blocked: false };
}

// ─── Skip all open tasks in a column for a card ────────────────

export async function skipOpenTasksInColumn(
  admin: SupabaseClient,
  instanceId: string,
  stepKey: string,
  actorId: string,
): Promise<string[]> {
  const { data: open } = await admin
    .from("tasks")
    .select("id")
    .eq("workflow_instance_id", instanceId)
    .eq("step_key", stepKey)
    .in("status", ["active", "on_hold", "pending"]);

  const ids = (open || []).map((t) => t.id);
  if (ids.length === 0) return [];

  await admin
    .from("tasks")
    .update({ status: "skipped", completed_at: new Date().toISOString() })
    .in("id", ids);

  // Also clear any pending sign-offs for skipped tasks.
  await admin
    .from("task_sign_offs")
    .delete()
    .in("task_id", ids)
    .is("signed_off_at", null);

  for (const id of ids) {
    await logEvent(admin, id, "skipped", actorId, { reason: "card_moved" });
  }
  return ids;
}

// ─── Are all sign-offs done for the active task in (instance, column)? ─

export async function isColumnDone(
  admin: SupabaseClient,
  instanceId: string,
  stepKey: string,
): Promise<boolean> {
  // Find active task(s) in this column for this card.
  const { data: activeTasks } = await admin
    .from("tasks")
    .select("id, requires_sign_off")
    .eq("workflow_instance_id", instanceId)
    .eq("step_key", stepKey)
    .in("status", ["active", "on_hold", "pending"]);

  if (!activeTasks || activeTasks.length === 0) return true;

  // For sign-off tasks, check if all sign-offs are done.
  for (const task of activeTasks) {
    if (task.requires_sign_off) {
      const { data: pending } = await admin
        .from("task_sign_offs")
        .select("id")
        .eq("task_id", task.id)
        .is("signed_off_at", null);
      if (pending && pending.length > 0) return false;
    }
    // Non-sign-off task still open = not done.
    if (!task.requires_sign_off) return false;
  }
  return true;
}

// ─── Sign off on a task ─────────────────────────────────────────

export async function signOffTask(
  admin: SupabaseClient,
  taskId: string,
  userId: string,
  instance: Instance,
  columns: Column[],
): Promise<{
  signed_off: boolean;
  task_complete: boolean;
  card_advanced: boolean;
  advanced_to: string | null;
  next_task_ids: string[];
}> {
  // 1. Validate user has a pending sign-off for this task.
  const { data: row, error: soErr } = await admin
    .from("task_sign_offs")
    .select("id, signed_off_at")
    .eq("task_id", taskId)
    .eq("user_id", userId)
    .single();

  if (soErr || !row) throw new Error("No sign-off found for this user on this task");
  if (row.signed_off_at) throw new Error("Already signed off");

  // 2. Mark sign-off done.
  await admin
    .from("task_sign_offs")
    .update({ signed_off_at: new Date().toISOString() })
    .eq("id", row.id);

  // 3. Log event.
  await logEvent(admin, taskId, "signed_off", userId, {});

  // 4. Check if all sign-offs are done.
  const { data: pending } = await admin
    .from("task_sign_offs")
    .select("id")
    .eq("task_id", taskId)
    .is("signed_off_at", null);

  const allDone = !pending || pending.length === 0;

  if (!allDone) {
    return { signed_off: true, task_complete: false, card_advanced: false, advanced_to: null, next_task_ids: [] };
  }

  // 5. All sign-offs done → mark task complete.
  await admin
    .from("tasks")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", taskId);
  await logEvent(admin, taskId, "completed", userId, { via: "all_sign_offs" });

  // 6. Get the task to find the step_key.
  const { data: task } = await admin
    .from("tasks")
    .select("step_key")
    .eq("id", taskId)
    .single();
  if (!task) {
    return { signed_off: true, task_complete: true, card_advanced: false, advanced_to: null, next_task_ids: [] };
  }

  // 7. Check if column is done (there might be other tasks).
  const columnDone = await isColumnDone(admin, instance.id, task.step_key);
  if (!columnDone) {
    return { signed_off: true, task_complete: true, card_advanced: false, advanced_to: null, next_task_ids: [] };
  }

  // 8. Advance to next column.
  const current = findColumn(columns, task.step_key);
  if (!current) {
    return { signed_off: true, task_complete: true, card_advanced: false, advanced_to: null, next_task_ids: [] };
  }
  const next = nextColumn(columns, current.step_key);
  if (!next) {
    // Last column — finish card.
    await completeInstance(admin, instance.id);
    return { signed_off: true, task_complete: true, card_advanced: true, advanced_to: null, next_task_ids: [] };
  }

  const { taskIds } = await enterColumn(admin, instance, next, userId);
  return {
    signed_off: true,
    task_complete: true,
    card_advanced: true,
    advanced_to: next.step_key,
    next_task_ids: taskIds,
  };
}

// ─── Reassign task (mid-workflow assignee change) ───────────────

export async function reassignTask(
  admin: SupabaseClient,
  taskId: string,
  instanceId: string,
  stepKey: string,
  newAssigneeIds: string[],
  changedBy: string,
) {
  // 1. Get current sign-offs.
  const { data: current } = await admin
    .from("task_sign_offs")
    .select("user_id, signed_off_at")
    .eq("task_id", taskId);

  const oldIds = (current || []).map((r) => r.user_id);
  const alreadySigned = new Map(
    (current || []).filter((r) => r.signed_off_at).map((r) => [r.user_id, r.signed_off_at]),
  );

  // 2. Delete all existing sign-offs.
  await admin.from("task_sign_offs").delete().eq("task_id", taskId);

  // 3. Insert new sign-offs (preserve completed sign-offs for retained users).
  const rows = newAssigneeIds.map((uid) => ({
    task_id: taskId,
    user_id: uid,
    signed_off_at: alreadySigned.get(uid) || null,
  }));
  if (rows.length > 0) {
    await admin.from("task_sign_offs").insert(rows);
  }

  // 4. Audit trail.
  await admin.from("workflow_card_audit").insert({
    instance_id: instanceId,
    change_type: "assignee_changed",
    column_step_key: stepKey,
    old_value: { assignee_ids: oldIds },
    new_value: { assignee_ids: newAssigneeIds },
    changed_by: changedBy,
  });

  // 5. Notify new assignees (skip those who were already assigned).
  const oldSet = new Set(oldIds);
  const { data: task } = await admin.from("tasks").select("title").eq("id", taskId).single();
  for (const uid of newAssigneeIds) {
    if (!oldSet.has(uid)) {
      await notifyUser(admin, uid, "Task reassigned to you", task?.title || "Untitled", taskId);
    }
  }
}

// ─── Mark instance complete ────────────────────────────────────

export async function completeInstance(
  admin: SupabaseClient,
  instanceId: string,
) {
  await admin
    .from("workflow_instances")
    .update({
      status: "complete",
      completed_at: new Date().toISOString(),
    })
    .eq("id", instanceId);
}

// ─── Legacy types ────────────────────────────────────────────

export interface TaskRow {
  id: string;
  workflow_instance_id: string;
  step_key: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  status: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  position: number;
  depends_on: string[];
  created_at: string;
  completed_at: string | null;
}

// ─── Legacy helpers (used by workflow-update-task, workflow-internal) ──

export async function notifyAdmins(
  admin: SupabaseClient,
  title: string,
  body: string,
  taskId: string,
  testMode = false,
) {
  if (testMode) return;
  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin");
  if (!admins || admins.length === 0) return;
  const rows = admins.map((a) => ({
    user_id: a.id,
    type: "task_held",
    title,
    body,
    link_tab: "my_tasks",
    link_target: taskId,
    is_read: false,
  }));
  await admin.from("notifications").insert(rows);
}

export async function checkFanIn(
  admin: SupabaseClient,
  instanceId: string,
  actorId: string | null,
  testMode = false,
): Promise<string[]> {
  const { data: pendingTasks } = await admin
    .from("tasks")
    .select("*")
    .eq("workflow_instance_id", instanceId)
    .eq("status", "pending");

  if (!pendingTasks || pendingTasks.length === 0) return [];

  const activatedIds: string[] = [];
  for (const task of pendingTasks) {
    if (!task.depends_on || task.depends_on.length === 0) continue;
    const { data: deps } = await admin
      .from("tasks")
      .select("id, status")
      .in("id", task.depends_on);
    if (!deps) continue;
    const allDone = deps.every((d) => d.status === "complete" || d.status === "skipped");
    if (allDone) {
      await admin.from("tasks").update({ status: "active" }).eq("id", task.id);
      await logEvent(admin, task.id, "created", actorId || "system", { reason: "fan_in_resolved" });
      if (task.assignee_id) {
        await notifyUser(admin, task.assignee_id, "New task assigned", task.title, task.id, testMode);
      }
      activatedIds.push(task.id);
    }
  }
  return activatedIds;
}

export async function checkInstanceCompletion(
  admin: SupabaseClient,
  instanceId: string,
) {
  const { data: remaining } = await admin
    .from("tasks")
    .select("id")
    .eq("workflow_instance_id", instanceId)
    .in("status", ["pending", "active", "on_hold"]);

  if (!remaining || remaining.length === 0) {
    await admin
      .from("workflow_instances")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", instanceId);
  }
}

// ─── Legacy task creation (code-source workflows) ──────────────

export async function createTaskFromStep(
  admin: SupabaseClient,
  step: WorkflowStep,
  instanceId: string,
  context: Record<string, unknown>,
  position: number,
  actorId: string,
  dependsOnTaskIds: string[] = [],
  testMode = false,
): Promise<TaskRow | null> {
  if (step.condition && !step.condition(context)) return null;

  const assigneeId = typeof step.assignee === "function"
    ? step.assignee(context)
    : step.assignee;

  const title = resolveTemplate(step.titleTemplate, context);
  const description = step.descriptionTemplate
    ? resolveTemplate(step.descriptionTemplate, context)
    : null;

  let relatedEntityType: string | null = null;
  let relatedEntityId: string | null = null;
  if (step.relatedEntity) {
    relatedEntityType = step.relatedEntity.type;
    relatedEntityId = step.relatedEntity.resolver(context);
  }

  const status = dependsOnTaskIds.length > 0 ? "pending" : "active";

  const { data: task, error } = await admin
    .from("tasks")
    .insert({
      workflow_instance_id: instanceId,
      step_key: step.stepKey,
      title,
      description,
      assignee_id: assigneeId,
      status,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
      position,
      depends_on: dependsOnTaskIds,
    })
    .select("*")
    .single();

  if (error) {
    console.error(`Failed to create task for step ${step.stepKey}:`, error.message);
    return null;
  }

  await logEvent(admin, task.id, "created", actorId);
  if (status === "active" && assigneeId) {
    await notifyUser(admin, assigneeId, "New task assigned", title, task.id, testMode);
  }

  return task as TaskRow;
}

export async function createDynamicFanOutTasks(
  admin: SupabaseClient,
  step: WorkflowStep,
  instanceId: string,
  context: Record<string, unknown>,
  position: number,
  actorId: string,
  dependsOnTaskIds: string[] = [],
  testMode = false,
): Promise<string[]> {
  const config = step.dynamicFanOut!;
  const items = context[config.contextKey] as Array<Record<string, unknown>>;
  if (!items || !Array.isArray(items) || items.length === 0) return [];

  const { data: existing } = await admin
    .from("tasks")
    .select("id, related_entity_id")
    .eq("workflow_instance_id", instanceId)
    .eq("step_key", step.stepKey);
  const existingEntityIds = new Set((existing || []).map((t) => t.related_entity_id));

  const assigneeId = typeof step.assignee === "function"
    ? step.assignee(context) : step.assignee;
  const status = dependsOnTaskIds.length > 0 ? "pending" : "active";
  const createdIds: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entityId = String(item[config.relatedEntityIdKey] || "");
    if (existingEntityIds.has(entityId)) continue;

    const title = resolveTemplate(config.titleTemplate, { ...context, ...item });
    const description = config.descriptionTemplate
      ? resolveTemplate(config.descriptionTemplate, { ...context, ...item }) : null;

    const { data: task, error } = await admin
      .from("tasks")
      .insert({
        workflow_instance_id: instanceId,
        step_key: step.stepKey,
        title,
        description,
        assignee_id: assigneeId,
        status,
        related_entity_type: config.relatedEntityType,
        related_entity_id: entityId,
        position: position + i,
        depends_on: dependsOnTaskIds,
      })
      .select("*")
      .single();

    if (error) { console.error(`Fan-out task failed for ${step.stepKey}[${i}]:`, error.message); continue; }
    await logEvent(admin, task.id, "created", actorId, { fanOut: true });
    if (status === "active" && assigneeId) {
      await notifyUser(admin, assigneeId, "New task assigned", title, task.id, testMode);
    }
    createdIds.push(task.id);
  }
  return createdIds;
}

export async function advanceWorkflow(
  admin: SupabaseClient,
  definition: WorkflowDefinition,
  instanceId: string,
  context: Record<string, unknown>,
  nextStepKeys: string | string[] | null,
  currentPosition: number,
  actorId: string,
  testMode = false,
): Promise<string[]> {
  if (nextStepKeys === null) {
    await checkInstanceCompletion(admin, instanceId);
    return [];
  }

  const keys = Array.isArray(nextStepKeys) ? nextStepKeys : [nextStepKeys];
  const createdTaskIds: string[] = [];

  for (let i = 0; i < keys.length; i++) {
    const stepKey = keys[i];
    const step = definition.steps[stepKey];
    if (!step) { console.error(`Step ${stepKey} not found in ${definition.slug}`); continue; }

    let dependsOnTaskIds: string[] = [];
    if (step.dependsOnSteps && step.dependsOnSteps.length > 0) {
      const { data: depTasks } = await admin
        .from("tasks")
        .select("id, step_key")
        .eq("workflow_instance_id", instanceId)
        .in("step_key", step.dependsOnSteps);
      dependsOnTaskIds = (depTasks || []).map((t) => t.id);

      if (!step.dynamicFanOut) {
        const { data: existing } = await admin
          .from("tasks")
          .select("id")
          .eq("workflow_instance_id", instanceId)
          .eq("step_key", stepKey);
        if (existing && existing.length > 0) continue;
      }
    }

    if (step.dynamicFanOut) {
      const fanOutIds = await createDynamicFanOutTasks(
        admin, step, instanceId, context, currentPosition + 1 + i, actorId, dependsOnTaskIds, testMode,
      );
      createdTaskIds.push(...fanOutIds);
      continue;
    }

    const task = await createTaskFromStep(
      admin, step, instanceId, context, currentPosition + 1 + i, actorId, dependsOnTaskIds, testMode,
    );

    if (task) {
      createdTaskIds.push(task.id);
    } else if (!step.condition || step.condition(context)) {
      console.error(`Failed to create task for step ${stepKey}`);
    } else {
      const skipResult = await step.onComplete(context, {}, admin);
      if (skipResult.contextUpdates) {
        Object.assign(context, skipResult.contextUpdates);
        await admin.from("workflow_instances").update({ context }).eq("id", instanceId);
      }
      const subIds = await advanceWorkflow(
        admin, definition, instanceId, context, skipResult.next, currentPosition + 1 + i, actorId, testMode,
      );
      createdTaskIds.push(...subIds);
    }
  }

  const fanInActivated = await checkFanIn(admin, instanceId, actorId, testMode);
  createdTaskIds.push(...fanInActivated);
  return createdTaskIds;
}
