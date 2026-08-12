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

      // Reverse sync: update linked sprint card to holding.
      const { data: holdCards } = await admin
        .from("personal_tasks")
        .select("id, status")
        .eq("task_id", taskId);
      if (holdCards) {
        for (const card of holdCards) {
          if (card.status !== "holding") {
            await admin
              .from("personal_tasks")
              .update({ status: "holding" })
              .eq("id", card.id);
          }
        }
      }

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

      // Reverse sync: update linked sprint card to in_progress.
      const { data: resumeCards } = await admin
        .from("personal_tasks")
        .select("id, status")
        .eq("task_id", taskId);
      if (resumeCards) {
        for (const card of resumeCards) {
          if (card.status !== "in_progress") {
            await admin
              .from("personal_tasks")
              .update({ status: "in_progress" })
              .eq("id", card.id);
          }
        }
      }

      await logEvent(admin, taskId, "resumed", auth.userId);
      await notifyUser(admin, task.assignee_id, "Task resumed", task.title, taskId);

      return jsonResp({ ok: true, status: "active" });
    }

    // ─── Decline ─────────────────────────────────────────────
    case "decline": {
      if (!isOwner && !isAdmin) {
        return jsonResp({ error: "Not authorized" }, 403);
      }
      if (task.status !== "active" && task.status !== "on_hold") {
        return jsonResp({ error: `Cannot decline a ${task.status} task` }, 400);
      }
      const declineReason = (body.reason as string) || "";

      await admin
        .from("tasks")
        .update({
          status: "declined",
          hold_reason: declineReason.trim() || null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", taskId);

      await logEvent(admin, taskId, "declined", auth.userId, {
        reason: declineReason.trim() || null,
      });

      // Let the admins know — they decide whether to reassign or drop it.
      // (We deliberately do NOT advance/complete the workflow on a decline.)
      await notifyAdmins(
        admin,
        "Task declined",
        `"${task.title}"${declineReason.trim() ? ` — ${declineReason.trim()}` : ""}`,
        taskId,
      );

      return jsonResp({ ok: true, status: "declined" });
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
      const plannedDate = (body.planned_date as string) || null;

      const update: Record<string, unknown> = { snoozed_until: until };
      if (plannedDate) update.planned_date = plannedDate;

      await admin
        .from("tasks")
        .update(update)
        .eq("id", taskId);

      await logEvent(admin, taskId, "snoozed", auth.userId, { until, planned_date: plannedDate });

      return jsonResp({ ok: true, snoozed_until: until, planned_date: plannedDate });
    }

    // ─── Unsnooze ────────────────────────────────────────────
    case "unsnooze": {
      if (!isOwner && !isAdmin) {
        return jsonResp({ error: "Not authorized" }, 403);
      }

      await admin
        .from("tasks")
        .update({ snoozed_until: null, planned_date: null })
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

      // Fan-in / completion checks only apply to workflow tasks. Standalone
      // tasks (e.g. a project's research_scope task) have no instance — skip
      // them, or the null instanceId would run loose queries over all
      // standalone tasks. Skipping a research_scope task never advances the
      // card anyway; only the 'research' step tasks trigger that.
      let activated: string[] = [];
      if (task.workflow_instance_id) {
        activated = await checkFanIn(admin, task.workflow_instance_id, auth.userId);
        await checkInstanceCompletion(admin, task.workflow_instance_id);
      }

      return jsonResp({ ok: true, status: "skipped", activated_task_ids: activated });
    }

    // ─── Correct reported hours (admin only) ─────────────────
    // Backs the editable hours cell in Payroll: the assignee reports at
    // completion, an admin can fix the number afterward. Pass null to clear.
    case "set_hours": {
      if (!isAdmin) {
        return jsonResp({ error: "Admin only" }, 403);
      }
      const raw = body.hours_spent;
      let hours: number | null = null;
      if (raw !== null && raw !== undefined && raw !== "") {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0 || n > 500) {
          return jsonResp({ error: "hours_spent must be a number between 0 and 500" }, 400);
        }
        hours = Math.round(n * 4) / 4;
      }

      const { error: hoursErr } = await admin
        .from("tasks")
        .update({
          hours_spent: hours,
          hours_reported_at: hours === null ? null : new Date().toISOString(),
        })
        .eq("id", taskId);
      if (hoursErr) {
        return jsonResp({ error: hoursErr.message }, 500);
      }

      return jsonResp({ ok: true, hours_spent: hours });
    }

    // ─── Toggle whether this task counts toward the My Tasks tab badge ───
    case "set_badge_count": {
      if (!isOwner && !isAdmin) {
        return jsonResp({ error: "Not authorized" }, 403);
      }
      const countInBadge = body.count_in_badge !== false; // default true
      const { error: badgeErr } = await admin
        .from("tasks")
        .update({ count_in_badge: countInBadge })
        .eq("id", taskId);
      if (badgeErr) {
        return jsonResp({ error: badgeErr.message }, 500);
      }
      // No task_events log — this is a personal display preference, not a
      // workflow state change (and its event_type isn't in the allowed set).
      return jsonResp({ ok: true, count_in_badge: countInBadge });
    }

    // ─── Set context (merge keys into workflow_instances.context) ───
    case "set_context": {
      if (!isOwner && !isAdmin) {
        return jsonResp({ error: "Not authorized" }, 403);
      }
      const patch = (body.context as Record<string, unknown>) || null;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        return jsonResp({ error: "context object is required" }, 400);
      }

      const { data: inst, error: instErr } = await admin
        .from("workflow_instances")
        .select("context")
        .eq("id", task.workflow_instance_id)
        .single();
      if (instErr || !inst) {
        return jsonResp({ error: "Workflow instance not found" }, 404);
      }

      const merged = { ...(inst.context || {}), ...patch };
      const { error: updErr } = await admin
        .from("workflow_instances")
        .update({ context: merged })
        .eq("id", task.workflow_instance_id);
      if (updErr) {
        return jsonResp({ error: updErr.message }, 500);
      }

      return jsonResp({ ok: true, context: merged });
    }

    default:
      return jsonResp({ error: `Unknown action: ${action}` }, 400);
  }
});
