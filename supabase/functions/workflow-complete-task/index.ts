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
    // Standalone tasks (no workflow instance) may be "pending" — allow completing them.
    if (task.status === "pending" && !task.workflow_instance_id) {
      // ok — treat as completable
    } else {
      return jsonResp({ error: `Task is ${task.status}, not active` }, 400);
    }
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

  // Reverse sync: if a sprint card is linked, mark it done.
  const { data: linkedCards } = await admin
    .from("personal_tasks")
    .select("id, status")
    .eq("task_id", task_id);
  if (linkedCards && linkedCards.length > 0) {
    for (const card of linkedCards) {
      if (card.status !== "done") {
        await admin
          .from("personal_tasks")
          .update({ status: "done", completed_at: new Date().toISOString() })
          .eq("id", card.id);
      }
    }
  }

  // Standalone task — done (possibly auto-advance a project).
  if (!task.workflow_instance_id) {
    if (task.related_entity_type === "project" && task.related_entity_id && task.step_key) {
      // Check if all tasks for this project+stage are now complete.
      const { data: openTasks } = await admin
        .from("tasks")
        .select("id")
        .eq("related_entity_type", "project")
        .eq("related_entity_id", task.related_entity_id)
        .eq("step_key", task.step_key)
        .in("status", ["pending", "active", "on_hold"])
        .limit(1);

      if (!openTasks || openTasks.length === 0) {
        // All stage tasks done — call card-move to advance the project.
        const STAGES = ["queue","research","write","pre_production","film","review","edit","post_production","publish"];
        const currentIdx = STAGES.indexOf(task.step_key);
        if (currentIdx >= 0 && currentIdx < STAGES.length - 1) {
          const nextStage = STAGES[currentIdx + 1];
          try {
            const moveResp = await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/card-move`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  project_id: task.related_entity_id,
                  target_stage: nextStage,
                }),
              },
            );
            const moveResult = await moveResp.json();
            return jsonResp({
              completed: task_id,
              next_task_ids: moveResult.new_task_ids || [],
              advanced_to: moveResult.target_stage,
              project_advanced: true,
            });
          } catch (e) {
            console.error("card-move call failed:", e);
          }
        }
      }
    }
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
