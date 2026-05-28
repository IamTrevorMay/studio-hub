// supabase/functions/workflow-update-task/index.ts
// Hold, resume, snooze, unsnooze, reassign, or skip a task.
// Deploy: supabase functions deploy workflow-update-task --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
  logEvent,
  notifyUser,
  notifyAdmins,
  checkFanIn,
  checkInstanceCompletion,
} from "../shared/workflow-engine.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  const auth = await getUserFromJwt(req);
  if (!auth) return jsonResp({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const taskId = body.task_id as string;
  const action = body.action as string;
  if (!taskId || !action) {
    return jsonResp({ error: "task_id and action are required" }, 400);
  }

  const admin = getAdminClient();

  // Fetch task
  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (taskErr || !task) {
    return jsonResp({ error: "Task not found" }, 404);
  }

  const isOwner = task.assignee_id === auth.userId;
  const isAdmin = auth.isAdmin;

  switch (action) {
    // ─── Hold ────────────────────────────────────────────────
    case "hold": {
      if (!isOwner && !isAdmin) {
        return jsonResp({ error: "Not authorized" }, 403);
      }
      if (task.status !== "active") {
        return jsonResp({ error: `Cannot hold a ${task.status} task` }, 400);
      }
      const reason = (body.reason as string) || "";
      if (!reason.trim()) {
        return jsonResp({ error: "reason is required for hold" }, 400);
      }

      await admin
        .from("tasks")
        .update({ status: "on_hold", hold_reason: reason.trim() })
        .eq("id", taskId);

      await logEvent(admin, taskId, "held", auth.userId, { reason: reason.trim() });

      // Notify all admins
      await notifyAdmins(
        admin,
        "Task put on hold",
        `"${task.title}" — ${reason.trim()}`,
        taskId,
      );

      return jsonResp({ ok: true, status: "on_hold" });
    }

    // ─── Resume ──────────────────────────────────────────────
    case "resume": {
      if (!isOwner && !isAdmin) {
        return jsonResp({ error: "Not authorized" }, 403);
      }
      if (task.status !== "on_hold") {
        return jsonResp({ error: `Cannot resume a ${task.status} task` }, 400);
      }

      await admin
        .from("tasks")
        .update({ status: "active", hold_reason: null })
        .eq("id", taskId);

      await logEvent(admin, taskId, "resumed", auth.userId);

      return jsonResp({ ok: true, status: "active" });
    }

    // ─── Snooze ──────────────────────────────────────────────
    case "snooze": {
      if (!isOwner && !isAdmin) {
        return jsonResp({ error: "Not authorized" }, 403);
      }
      const until = body.until as string;
      if (!until || isNaN(Date.parse(until))) {
        return jsonResp({ error: "Valid until ISO timestamp is required" }, 400);
      }

      await admin
        .from("tasks")
        .update({ snoozed_until: until })
        .eq("id", taskId);

      await logEvent(admin, taskId, "snoozed", auth.userId, { until });

      return jsonResp({ ok: true, snoozed_until: until });
    }

    // ─── Unsnooze ────────────────────────────────────────────
    case "unsnooze": {
      if (!isOwner && !isAdmin) {
        return jsonResp({ error: "Not authorized" }, 403);
      }

      await admin
        .from("tasks")
        .update({ snoozed_until: null })
        .eq("id", taskId);

      await logEvent(admin, taskId, "snoozed", auth.userId, { action: "unsnooze" });

      return jsonResp({ ok: true, snoozed_until: null });
    }

    // ─── Reassign (admin only) ───────────────────────────────
    case "reassign": {
      if (!isAdmin) {
        return jsonResp({ error: "Admin only" }, 403);
      }
      const newAssigneeId = body.assignee_id as string;
      if (!newAssigneeId) {
        return jsonResp({ error: "assignee_id is required" }, 400);
      }

      const oldAssigneeId = task.assignee_id;
      await admin
        .from("tasks")
        .update({ assignee_id: newAssigneeId })
        .eq("id", taskId);

      await logEvent(admin, taskId, "reassigned", auth.userId, {
        from: oldAssigneeId,
        to: newAssigneeId,
      });

      // Notify new assignee
      await notifyUser(admin, newAssigneeId, "Task reassigned to you", task.title, taskId);

      return jsonResp({ ok: true, assignee_id: newAssigneeId });
    }

    // ─── Skip (admin only) ───────────────────────────────────
    case "skip": {
      if (!isAdmin) {
        return jsonResp({ error: "Admin only" }, 403);
      }
      if (task.status === "complete" || task.status === "skipped") {
        return jsonResp({ error: `Task is already ${task.status}` }, 400);
      }

      await admin
        .from("tasks")
        .update({ status: "skipped", completed_at: new Date().toISOString() })
        .eq("id", taskId);

      await logEvent(admin, taskId, "skipped", auth.userId);

      // Run fan-in check — skipping a task may unblock pending tasks
      const activated = await checkFanIn(admin, task.workflow_instance_id, auth.userId);
      await checkInstanceCompletion(admin, task.workflow_instance_id);

      return jsonResp({ ok: true, status: "skipped", activated_task_ids: activated });
    }

    default:
      return jsonResp({ error: `Unknown action: ${action}` }, 400);
  }
});
