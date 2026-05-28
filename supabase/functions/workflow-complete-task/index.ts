// supabase/functions/workflow-complete-task/index.ts
// Completes a task and advances the workflow to the next step(s).
// Supports both code-sourced and data-driven workflows.
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
import {
  getWorkflowDefinition,
  resolveWorkflowDefinition,
} from "../shared/workflow-definitions.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  const auth = await getUserFromJwt(req);
  if (!auth) return jsonResp({ error: "Unauthorized" }, 401);

  let body: {
    task_id?: string;
    payload?: Record<string, unknown>;
    impersonate_user_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const { task_id, payload, impersonate_user_id } = body;
  if (!task_id) return jsonResp({ error: "task_id is required" }, 400);

  const admin = getAdminClient();

  // Fetch the task
  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .select(
      "*, workflow_instance:workflow_instances(id, workflow_id, context, status, version_id, test_mode)",
    )
    .eq("id", task_id)
    .single();

  if (taskErr || !task) {
    return jsonResp({ error: "Task not found" }, 404);
  }

  const instance = task.workflow_instance;
  const testMode = instance?.test_mode || false;

  // Admin impersonation for simulator: if test_mode and admin, allow impersonation
  let effectiveUserId = auth.userId;
  if (impersonate_user_id && auth.isAdmin && testMode) {
    effectiveUserId = impersonate_user_id;
  }

  // Verify ownership (assignee, impersonated user, or admin)
  if (
    task.assignee_id !== auth.userId &&
    task.assignee_id !== effectiveUserId &&
    !auth.isAdmin
  ) {
    return jsonResp({ error: "Not authorized to complete this task" }, 403);
  }

  if (task.status !== "active") {
    return jsonResp({ error: `Task is ${task.status}, not active` }, 400);
  }

  if (!instance || instance.status !== "active") {
    return jsonResp({ error: "Workflow instance is not active" }, 400);
  }

  // Look up the workflow row (with source info for dual-mode)
  const { data: workflow } = await admin
    .from("workflows")
    .select("id, slug, name, description, source, first_step_key, current_version_id")
    .eq("id", instance.workflow_id)
    .single();

  if (!workflow) {
    return jsonResp({ error: "Workflow not found" }, 500);
  }

  // Resolve the definition (dual-mode)
  let definition;
  if (workflow.source === "code") {
    definition = getWorkflowDefinition(workflow.slug);
  } else {
    // Use the instance's pinned version if available
    definition = await resolveWorkflowDefinition(
      admin,
      workflow,
      instance.version_id,
    );
  }

  if (!definition) {
    return jsonResp(
      { error: `Workflow definition "${workflow.slug}" could not be resolved` },
      500,
    );
  }

  const step = definition.steps[task.step_key];
  if (!step) {
    return jsonResp(
      { error: `Step "${task.step_key}" not found in definition` },
      500,
    );
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
    return jsonResp(
      { error: `Failed to update task: ${updateErr.message}` },
      500,
    );
  }

  // Log completion event
  await logEvent(admin, task_id, "completed", auth.userId, payload || {});

  // Run step's onComplete handler
  const ctx = { ...(instance.context || {}) };
  let result;
  try {
    result = await step.onComplete(ctx, payload || {}, admin);
  } catch (err) {
    // Revert task back to active so the user can retry
    await admin
      .from("tasks")
      .update({ status: "active", completion_payload: null, completed_at: null })
      .eq("id", task_id);
    console.error(`onComplete failed for step ${task.step_key}:`, err);
    return jsonResp({ error: `Step handler failed: ${err.message}` }, 500);
  }

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
    testMode,
  );

  // Also run fan-in check (in case this completion unblocks pending tasks
  // that were created by a different branch)
  const fanInActivated = await checkFanIn(
    admin,
    instance.id,
    auth.userId,
    testMode,
  );
  nextTaskIds.push(...fanInActivated);

  // Check if the entire workflow is now complete
  await checkInstanceCompletion(admin, instance.id);

  return jsonResp({ completed: task_id, next_task_ids: nextTaskIds });
});
