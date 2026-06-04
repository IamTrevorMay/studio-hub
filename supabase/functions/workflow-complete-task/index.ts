// Complete a task or sign off on a sign-off task.
// Body: { task_id, action?: 'sign_off', payload? }
// Deploy: supabase functions deploy workflow-complete-task --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
  logEvent,
  loadColumns,
  findColumn,
  nextColumn,
  enterColumn,
  isColumnDone,
  completeInstance,
  signOffTask,
  type Instance,
} from "../shared/workflow-engine.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const auth = await getUserFromJwt(req);
  if (!auth) return jsonResp({ error: "Unauthorized" }, 401);

  let body: { task_id?: string; action?: string; payload?: Record<string, unknown> };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }
  const { task_id, action, payload } = body;
  if (!task_id) return jsonResp({ error: "task_id required" }, 400);

  const admin = getAdminClient();

  // Fetch task + card.
  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .select("*, workflow_instance:workflow_instances(*)")
    .eq("id", task_id)
    .single();

  if (taskErr || !task) return jsonResp({ error: "Task not found" }, 404);

  if (task.status !== "active") {
    return jsonResp({ error: `Task is ${task.status}, not active` }, 400);
  }

  // ─── Sign-off path ──────────────────────────────────────────
  if (action === "sign_off" || (task.requires_sign_off && !action)) {
    if (!task.requires_sign_off) {
      return jsonResp({ error: "Task does not require sign-off" }, 400);
    }

    // Verify user has a sign-off row.
    const { data: soRow } = await admin
      .from("task_sign_offs")
      .select("id")
      .eq("task_id", task_id)
      .eq("user_id", auth.userId)
      .single();
    if (!soRow && !auth.isAdmin) {
      return jsonResp({ error: "Not authorized to sign off on this task" }, 403);
    }

    // Build instance.
    const inst = task.workflow_instance;
    if (!inst) {
      return jsonResp({ error: "Task has no workflow instance" }, 400);
    }

    const columns = await loadColumns(admin, inst.workflow_id);
    const instance: Instance = {
      id: inst.id,
      workflow_id: inst.workflow_id,
      title: inst.title,
      status: inst.status,
      context: inst.context || {},
      current_step_key: inst.current_step_key,
      assignee_overrides: inst.assignee_overrides || {},
      test_mode: inst.test_mode || false,
    };

    const result = await signOffTask(admin, task_id, auth.userId, instance, columns);
    return jsonResp({
      signed_off: result.signed_off,
      task_complete: result.task_complete,
      card_advanced: result.card_advanced,
      advanced_to: result.advanced_to,
      next_task_ids: result.next_task_ids,
    });
  }

  // ─── Regular complete path (non-sign-off tasks) ─────────────
  if (task.requires_sign_off) {
    return jsonResp({ error: "This task requires sign-off, use action: 'sign_off'" }, 400);
  }

  // Auth check for regular tasks.
  if (task.assignee_id !== auth.userId && !auth.isAdmin) {
    return jsonResp({ error: "Not authorized to complete this task" }, 403);
  }

  // Mark complete.
  const { error: updErr } = await admin
    .from("tasks")
    .update({
      status: "complete",
      completion_payload: payload || {},
      completed_at: new Date().toISOString(),
    })
    .eq("id", task_id);
  if (updErr) return jsonResp({ error: `Update failed: ${updErr.message}` }, 500);
  await logEvent(admin, task_id, "completed", auth.userId, payload || {});

  // Standalone task — done.
  if (!task.workflow_instance_id) {
    return jsonResp({ completed: task_id, next_task_ids: [] });
  }

  const inst = task.workflow_instance;
  if (!inst || inst.status !== "active") {
    return jsonResp({ completed: task_id, next_task_ids: [], note: "card not active" });
  }

  // Check if column is done.
  const columnDone = await isColumnDone(admin, inst.id, task.step_key);
  if (!columnDone) {
    return jsonResp({ completed: task_id, next_task_ids: [], column_done: false });
  }

  // Advance to next column.
  const columns = await loadColumns(admin, inst.workflow_id);
  const current = findColumn(columns, task.step_key);
  if (!current) {
    return jsonResp({ completed: task_id, next_task_ids: [], note: "current column missing" });
  }
  const next = nextColumn(columns, current.step_key);
  if (!next) {
    // Last column complete — finish card.
    await completeInstance(admin, inst.id);
    return jsonResp({ completed: task_id, next_task_ids: [], card_complete: true });
  }

  const instance: Instance = {
    id: inst.id,
    workflow_id: inst.workflow_id,
    title: inst.title,
    status: inst.status,
    context: inst.context || {},
    current_step_key: inst.current_step_key,
    assignee_overrides: inst.assignee_overrides || {},
    test_mode: inst.test_mode || false,
  };
  const { taskIds, blocked } = await enterColumn(admin, instance, next, auth.userId);

  return jsonResp({
    completed: task_id,
    next_task_ids: taskIds,
    advanced_to: next.step_key,
    blocked,
  });
});
