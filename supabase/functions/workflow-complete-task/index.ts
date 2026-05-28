// supabase/functions/workflow-complete-task/index.ts
// Completes a task and advances the workflow to the next step(s).
// Deploy: supabase functions deploy workflow-complete-task --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
  logEvent,
  advanceWorkflow,
  checkFanIn,
  checkInstanceCompletion,
} from "../shared/workflow-engine.ts";
import { getWorkflowDefinition } from "../shared/workflow-definitions.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  const auth = await getUserFromJwt(req);
  if (!auth) return jsonResp({ error: "Unauthorized" }, 401);

  let body: { task_id?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const { task_id, payload } = body;
  if (!task_id) return jsonResp({ error: "task_id is required" }, 400);

  const admin = getAdminClient();

  // Fetch the task
  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .select("*, workflow_instance:workflow_instances(id, workflow_id, context, status)")
    .eq("id", task_id)
    .single();

  if (taskErr || !task) {
    return jsonResp({ error: "Task not found" }, 404);
  }

  // Verify ownership (assignee or admin)
  if (task.assignee_id !== auth.userId && !auth.isAdmin) {
    return jsonResp({ error: "Not authorized to complete this task" }, 403);
  }

  if (task.status !== "active") {
    return jsonResp({ error: `Task is ${task.status}, not active` }, 400);
  }

  const instance = task.workflow_instance;
  if (!instance || instance.status !== "active") {
    return jsonResp({ error: "Workflow instance is not active" }, 400);
  }

  // Look up the workflow definition
  const { data: workflow } = await admin
    .from("workflows")
    .select("slug")
    .eq("id", instance.workflow_id)
    .single();

  if (!workflow) {
    return jsonResp({ error: "Workflow not found" }, 500);
  }

  const definition = getWorkflowDefinition(workflow.slug);
  if (!definition) {
    return jsonResp({ error: `Workflow definition "${workflow.slug}" not found` }, 500);
  }

  const step = definition.steps[task.step_key];
  if (!step) {
    return jsonResp({ error: `Step "${task.step_key}" not found in definition` }, 500);
  }

  // Mark task complete
  const { error: updateErr } = await admin
    .from("tasks")
    .update({
      status: "complete",
      completion_payload: payload || {},
      completed_at: new Date().toISOString(),
    })
    .eq("id", task_id);

  if (updateErr) {
    return jsonResp({ error: `Failed to update task: ${updateErr.message}` }, 500);
  }

  // Log completion event
  await logEvent(admin, task_id, "completed", auth.userId, payload || {});

  // Run step's onComplete handler
  const ctx = { ...(instance.context || {}) };
  const result = step.onComplete(ctx, payload || {});

  // Apply context updates
  if (result.contextUpdates) {
    Object.assign(ctx, result.contextUpdates);
    await admin
      .from("workflow_instances")
      .update({ context: ctx })
      .eq("id", instance.id);
  }

  // Advance to next step(s)
  const nextTaskIds = await advanceWorkflow(
    admin,
    definition,
    instance.id,
    ctx,
    result.next,
    task.position,
    auth.userId,
  );

  // Also run fan-in check (in case this completion unblocks pending tasks
  // that were created by a different branch)
  const fanInActivated = await checkFanIn(admin, instance.id, auth.userId);
  nextTaskIds.push(...fanInActivated);

  // Check if the entire workflow is now complete
  await checkInstanceCompletion(admin, instance.id);

  return jsonResp({ completed: task_id, next_task_ids: nextTaskIds });
});
