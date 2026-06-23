// Sprint ↔ Tasks sync for non-admin users.
// Ops: create (linked task when card → in_progress), reactivate (un-done),
//       update_title (card content edit → task title).
// Deploy: supabase functions deploy sprint-task-sync --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
} from "../shared/workflow-engine.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const auth = await getUserFromJwt(req);
  if (!auth) return jsonResp({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }

  const op = body.op as string;
  if (!op) return jsonResp({ error: "op is required" }, 400);

  const admin = getAdminClient();

  switch (op) {
    // ─── Create a linked task when card moves to in_progress ───
    case "create": {
      const personalTaskId = body.personal_task_id as string;
      const title = body.title as string;
      if (!personalTaskId) return jsonResp({ error: "personal_task_id required" }, 400);

      // Verify card belongs to caller and has no existing link.
      const { data: card, error: cardErr } = await admin
        .from("personal_tasks")
        .select("id, task_id, created_by")
        .eq("id", personalTaskId)
        .single();

      if (cardErr || !card) return jsonResp({ error: "Card not found" }, 404);
      if (card.created_by !== auth.userId) return jsonResp({ error: "Not your card" }, 403);
      if (card.task_id) return jsonResp({ error: "Card already linked" }, 409);

      // Insert tasks row.
      const { data: task, error: taskErr } = await admin
        .from("tasks")
        .insert({
          title: title || "Sprint task",
          step_key: "sprint",
          workflow_instance_id: null,
          assignee_id: auth.userId,
          created_by: auth.userId,
          status: "active",
        })
        .select("id, title, status, step_key, workflow_instance_id")
        .single();

      if (taskErr || !task) {
        return jsonResp({ error: `Task insert failed: ${taskErr?.message}` }, 500);
      }

      // Link personal_tasks → tasks.
      const { error: linkErr } = await admin
        .from("personal_tasks")
        .update({ task_id: task.id })
        .eq("id", personalTaskId);

      if (linkErr) {
        // Clean up orphaned task.
        await admin.from("tasks").delete().eq("id", task.id);
        return jsonResp({ error: `Link failed: ${linkErr.message}` }, 500);
      }

      return jsonResp({ ok: true, task_id: task.id, task });
    }

    // ─── Reactivate a completed task (card un-done) ────────────
    case "reactivate": {
      const taskId = body.task_id as string;
      if (!taskId) return jsonResp({ error: "task_id required" }, 400);

      const { data: task, error: taskErr } = await admin
        .from("tasks")
        .select("id, status, assignee_id, workflow_instance_id")
        .eq("id", taskId)
        .single();

      if (taskErr || !task) return jsonResp({ error: "Task not found" }, 404);
      if (task.assignee_id !== auth.userId) return jsonResp({ error: "Not your task" }, 403);
      if (task.status !== "complete") return jsonResp({ error: `Task is ${task.status}, not complete` }, 400);
      // Only reactivate sprint-created tasks (no workflow instance).
      if (task.workflow_instance_id) return jsonResp({ error: "Cannot reactivate workflow task" }, 400);

      await admin
        .from("tasks")
        .update({ status: "active", completed_at: null })
        .eq("id", taskId);

      return jsonResp({ ok: true, status: "active" });
    }

    // ─── Sync title from card content edit ─────────────────────
    case "update_title": {
      const taskId = body.task_id as string;
      const title = body.title as string;
      if (!taskId) return jsonResp({ error: "task_id required" }, 400);

      const { data: task, error: taskErr } = await admin
        .from("tasks")
        .select("id, assignee_id")
        .eq("id", taskId)
        .single();

      if (taskErr || !task) return jsonResp({ error: "Task not found" }, 404);
      if (task.assignee_id !== auth.userId) return jsonResp({ error: "Not your task" }, 403);

      await admin
        .from("tasks")
        .update({ title: title || "Sprint task" })
        .eq("id", taskId);

      return jsonResp({ ok: true });
    }

    default:
      return jsonResp({ error: `Unknown op: ${op}` }, 400);
  }
});
