// Shared workflow engine helpers used by all workflow-* edge functions

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getWorkflowDefinition,
  resolveTemplate,
  type WorkflowStep,
  type WorkflowDefinition,
} from "./workflow-definitions.ts";

// ─── Types ─────────────────────────────────────────────────────

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

// ─── Admin client factory ──────────────────────────────────────

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

// ─── Notification helper ───────────────────────────────────────

export async function notifyUser(
  admin: SupabaseClient,
  userId: string,
  title: string,
  body: string,
  taskId: string,
) {
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

export async function notifyAdmins(
  admin: SupabaseClient,
  title: string,
  body: string,
  taskId: string,
) {
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

// ─── Event logger ──────────────────────────────────────────────

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

// ─── Create a task from a step definition ──────────────────────

export async function createTaskFromStep(
  admin: SupabaseClient,
  step: WorkflowStep,
  instanceId: string,
  context: Record<string, unknown>,
  position: number,
  actorId: string,
  dependsOnTaskIds: string[] = [],
): Promise<TaskRow | null> {
  // Evaluate condition — skip if false
  if (step.condition && !step.condition(context)) {
    return null;
  }

  // Resolve assignee
  const assigneeId = typeof step.assignee === "function"
    ? step.assignee(context)
    : step.assignee;

  // Resolve title and description
  const title = resolveTemplate(step.titleTemplate, context);
  const description = step.descriptionTemplate
    ? resolveTemplate(step.descriptionTemplate, context)
    : null;

  // Resolve related entity
  let relatedEntityType: string | null = null;
  let relatedEntityId: string | null = null;
  if (step.relatedEntity) {
    relatedEntityType = step.relatedEntity.type;
    relatedEntityId = step.relatedEntity.resolver(context);
  }

  // Determine initial status
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

  // Log creation event
  await logEvent(admin, task.id, "created", actorId);

  // Notify assignee (only if task is immediately active)
  if (status === "active" && assigneeId) {
    await notifyUser(admin, assigneeId, "New task assigned", title, task.id);
  }

  return task as TaskRow;
}

// ─── Fan-in checker ────────────────────────────────────────────
// After completing a task, check if any pending tasks in the same
// instance have all their depends_on tasks completed. If so, flip
// them to active and notify the assignee.

export async function checkFanIn(
  admin: SupabaseClient,
  instanceId: string,
  actorId: string,
): Promise<string[]> {
  // Get all pending tasks with dependencies
  const { data: pendingTasks } = await admin
    .from("tasks")
    .select("*")
    .eq("workflow_instance_id", instanceId)
    .eq("status", "pending");

  if (!pendingTasks || pendingTasks.length === 0) return [];

  const activatedIds: string[] = [];

  for (const task of pendingTasks) {
    if (!task.depends_on || task.depends_on.length === 0) continue;

    // Check if all dependencies are complete or skipped
    const { data: deps } = await admin
      .from("tasks")
      .select("id, status")
      .in("id", task.depends_on);

    if (!deps) continue;

    const allDone = deps.every(
      (d) => d.status === "complete" || d.status === "skipped",
    );

    if (allDone) {
      await admin
        .from("tasks")
        .update({ status: "active" })
        .eq("id", task.id);

      await logEvent(admin, task.id, "created", actorId, { reason: "fan_in_resolved" });

      if (task.assignee_id) {
        await notifyUser(admin, task.assignee_id, "New task assigned", task.title, task.id);
      }

      activatedIds.push(task.id);
    }
  }

  return activatedIds;
}

// ─── Check if workflow instance is complete ────────────────────

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

// ─── Resolve next step(s) after completion ─────────────────────

export async function advanceWorkflow(
  admin: SupabaseClient,
  definition: WorkflowDefinition,
  instanceId: string,
  context: Record<string, unknown>,
  nextStepKeys: string | string[] | null,
  currentPosition: number,
  actorId: string,
): Promise<string[]> {
  if (nextStepKeys === null) {
    // Workflow complete — check if all tasks are done
    await checkInstanceCompletion(admin, instanceId);
    return [];
  }

  const keys = Array.isArray(nextStepKeys) ? nextStepKeys : [nextStepKeys];
  const createdTaskIds: string[] = [];
  const fanInTargets: Record<string, string[]> = {};

  for (let i = 0; i < keys.length; i++) {
    const stepKey = keys[i];
    const step = definition.steps[stepKey];
    if (!step) {
      console.error(`Step ${stepKey} not found in workflow ${definition.slug}`);
      continue;
    }

    // Check if this step has fan-in dependencies
    let dependsOnTaskIds: string[] = [];
    if (step.dependsOnSteps && step.dependsOnSteps.length > 0) {
      // Find the task IDs for the dependency step keys in this instance
      const { data: depTasks } = await admin
        .from("tasks")
        .select("id, step_key")
        .eq("workflow_instance_id", instanceId)
        .in("step_key", step.dependsOnSteps);

      dependsOnTaskIds = (depTasks || []).map((t) => t.id);

      // Check if a pending task for this step already exists (another fan-out branch
      // may have already created it)
      const { data: existing } = await admin
        .from("tasks")
        .select("id")
        .eq("workflow_instance_id", instanceId)
        .eq("step_key", stepKey);

      if (existing && existing.length > 0) {
        // Already exists — don't duplicate. Fan-in check will activate it.
        continue;
      }
    }

    const task = await createTaskFromStep(
      admin,
      step,
      instanceId,
      context,
      currentPosition + 1 + i,
      actorId,
      dependsOnTaskIds,
    );

    if (task) {
      createdTaskIds.push(task.id);
    } else if (!step.condition || step.condition(context)) {
      // Task creation failed for a non-conditional step
      console.error(`Failed to create task for step ${stepKey}`);
    } else {
      // Step was skipped due to condition — advance past it
      const skipResult = step.onComplete(context, {});
      if (skipResult.contextUpdates) {
        Object.assign(context, skipResult.contextUpdates);
        await admin
          .from("workflow_instances")
          .update({ context })
          .eq("id", instanceId);
      }
      const subIds = await advanceWorkflow(
        admin, definition, instanceId, context,
        skipResult.next, currentPosition + 1 + i, actorId,
      );
      createdTaskIds.push(...subIds);
    }
  }

  // Run fan-in check in case newly created tasks unblocked something
  const fanInActivated = await checkFanIn(admin, instanceId, actorId);
  createdTaskIds.push(...fanInActivated);

  return createdTaskIds;
}
