// supabase/functions/assign-task/index.ts
// Admin-only helper for the Assignments page. Creates one-off (direct) tasks —
// `tasks` rows with no workflow behind them — and can cancel them.
//
// Operations:
//   { op: "create", title, assignee_ids: string[], due_date?, notes?, link_url?,
//     film_queue_item_id? }
//     → Inserts one task per assignee (status 'active', no workflow_instance_id)
//       and notifies each one. Returns the created task ids.
//       film_queue_item_id optionally points the task at a slate item: the DB
//       triggers mark that item filmed on link and done on completion. One
//       assignment per item, so it requires exactly one assignee.
//   { op: "cancel", task_id }
//     → Deletes a direct task (only if it has no workflow_instance_id).
//
// Deploy: supabase functions deploy assign-task --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
  notifyUser,
  logEvent,
  maybeCreateSprintCards,
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
  if (!auth.isAdmin) return jsonResp({ error: "Admin only" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const op = (body.op as string) || "create";
  const admin = getAdminClient();

  if (op === "create") {
    const title = ((body.title as string) || "").trim();
    const assigneeIds = Array.isArray(body.assignee_ids)
      ? (body.assignee_ids as string[]).filter(Boolean)
      : [];
    const dueDate = (body.due_date as string) || null;
    const notes = ((body.notes as string) || "").trim() || null;
    const linkUrl = ((body.link_url as string) || "").trim() || null;
    const navTarget = ((body.nav_target as string) || "").trim() || null;
    // "Report Hours to Complete" — assignee must report hours before the task
    // can be closed; those hours are paid in Payroll at their hourly rate.
    const requiresHours = body.requires_hours === true;
    // Optional slate item this task edits (see film_queue_item_id triggers).
    const filmQueueItemId = ((body.film_queue_item_id as string) || "").trim() || null;

    // Optional template: reuse a workflow block's action/modal as a one-off.
    // Whitelisted so a client can't set an arbitrary step_key.
    const TEMPLATE_KEYS = ["write_ad_reads", "collect_brief", "connect_to_video", "background_research", "research"];
    // Entity-based templates link to a deliverable/campaign record. Others
    // (e.g. background_research) carry a link_url instead of a related entity.
    // "research" is the project-kanban Research stage task (spawned from the
    // Set Research Scope modal): tied to a project AND carrying a research
    // doc link. Completing all of a project's 'research' tasks auto-advances
    // the card to Write (see workflow-complete-task).
    const ENTITY_TEMPLATES = ["write_ad_reads", "collect_brief", "connect_to_video", "research"];
    const reqStepKey = (body.step_key as string) || "direct_task";
    const stepKey = TEMPLATE_KEYS.includes(reqStepKey) ? reqStepKey : "direct_task";
    const isEntityTemplate = ENTITY_TEMPLATES.includes(stepKey);
    const relType = isEntityTemplate ? ((body.related_entity_type as string) || null) : null;
    const relId = isEntityTemplate ? ((body.related_entity_id as string) || null) : null;

    if (!title) return jsonResp({ error: "title is required" }, 400);
    if (assigneeIds.length === 0) {
      return jsonResp({ error: "at least one assignee is required" }, 400);
    }
    if (isEntityTemplate && !relId) {
      return jsonResp({ error: "a record must be selected for this template" }, 400);
    }
    // Background Research must carry a doc link. Project 'research' tasks
    // usually do too (from the Set Research Scope modal), but the "who's
    // already researching" skip flow assigns them without one — a link is
    // optional there, so only enforce it for background_research.
    if (stepKey === "background_research" && !linkUrl) {
      return jsonResp({ error: "a research doc is required for Background Research" }, 400);
    }
    // A slate item carries exactly one assignment — it can't fan out, and the
    // item has to actually be open for one. (slate_items_for_assignment() is
    // is_staff()-gated, so it's no use here: the service role has no auth.uid().
    // The link-guard trigger is still the backstop; this is the friendly error.)
    if (filmQueueItemId) {
      if (assigneeIds.length > 1) {
        return jsonResp({ error: "a slate item takes a single assignee" }, 400);
      }
      const { data: item } = await admin
        .from("film_queue_items")
        .select("id, state, sheet:beat_sheets(status)")
        .eq("id", filmQueueItemId)
        .maybeSingle();
      const sheetStatus = (item?.sheet as { status?: string } | null)?.status;
      if (!item || item.state === "done" || sheetStatus !== "approved") {
        return jsonResp({ error: "that slate item isn't open for an editing assignment" }, 400);
      }
      const [{ count: caCount }, { count: taskCount }] = await Promise.all([
        admin.from("contractor_assignments")
          .select("id", { count: "exact", head: true })
          .eq("film_queue_item_id", filmQueueItemId),
        admin.from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("film_queue_item_id", filmQueueItemId),
      ]);
      if ((caCount || 0) + (taskCount || 0) > 0) {
        return jsonResp({ error: "that slate item already has an editing assignment" }, 400);
      }
    }

    const rows = assigneeIds.map((uid) => ({
      workflow_instance_id: null,
      step_key: stepKey,
      title,
      description: notes,
      assignee_id: uid,
      status: "active",
      due_date: dueDate,
      link_url: linkUrl,
      nav_target: navTarget,
      related_entity_type: relType,
      related_entity_id: relId,
      film_queue_item_id: filmQueueItemId,
      requires_hours: requiresHours,
      created_by: auth.userId,
      position: 0,
    }));

    const { data: created, error } = await admin
      .from("tasks")
      .insert(rows)
      .select("id, assignee_id");
    if (error) {
      return jsonResp({ error: `Failed to create tasks: ${error.message}` }, 500);
    }

    for (const t of created || []) {
      await logEvent(admin, t.id, "created", auth.userId, { direct: true });
      if (t.assignee_id) {
        await notifyUser(admin, t.assignee_id, "New task assigned", title, t.id);
        // Route to Sprint Board for opted-in users (same as workflow tasks).
        await maybeCreateSprintCards(admin, [t.assignee_id], t.id, title);
      }
    }

    return jsonResp({ created_task_ids: (created || []).map((t) => t.id) });
  }

  if (op === "cancel") {
    const taskId = body.task_id as string;
    if (!taskId) return jsonResp({ error: "task_id is required" }, 400);

    // Only direct tasks can be cancelled here — never touch workflow tasks.
    const { data: task } = await admin
      .from("tasks")
      .select("id, workflow_instance_id")
      .eq("id", taskId)
      .single();
    if (!task) return jsonResp({ error: "Task not found" }, 404);
    if (task.workflow_instance_id) {
      return jsonResp({ error: "Not a direct task" }, 400);
    }

    const { error } = await admin.from("tasks").delete().eq("id", taskId);
    if (error) {
      return jsonResp({ error: `Failed to cancel task: ${error.message}` }, 500);
    }
    return jsonResp({ cancelled: taskId });
  }

  return jsonResp({ error: `Unknown op: ${op}` }, 400);
});
