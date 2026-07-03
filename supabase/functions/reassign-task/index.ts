// supabase/functions/reassign-task/index.ts
// Reassign an existing `tasks` row to a different user AND reconcile sprint
// routing — the piece a plain `tasks.assignee_id` update misses.
//
// Background: card-move / workflow-engine decide at *creation* time whether a
// task becomes a Sprint card (personal_tasks row) or a plain My Tasks entry,
// based on the assignee's profiles.route_tasks_to_sprint flag. A later
// reassignment that just flips assignee_id never re-runs that decision, so a
// task created for a non-routed editor lands in a sprint-routed user's My Tasks
// instead of their Sprint Board (and vice-versa). This function fixes that:
//   - removes any sprint card(s) tied to the task (the old owner's),
//   - sets the new assignee,
//   - if the new assignee is sprint-routed, creates a fresh sprint card and
//     bumps status pending → active (so the Sprint Done gate works); otherwise
//     leaves it as a My Tasks entry and notifies them.
//
// Self-contained (mirrors card-move's style) so it has no shared-module deps.
//
// Body: { task_id: string, new_assignee_id: string | null }
// Deploy: supabase functions deploy reassign-task --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getCaller(req: Request): Promise<{ userId: string; isAdmin: boolean } | null> {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller) return jsonResp({ error: "Unauthorized" }, 401);
  if (!caller.isAdmin) return jsonResp({ error: "Admin only" }, 403);

  let body: { task_id?: string; new_assignee_id?: string | null };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }

  const taskId = (body.task_id || "").trim();
  const newAssigneeId = body.new_assignee_id ? String(body.new_assignee_id).trim() : null;
  if (!taskId) return jsonResp({ error: "task_id is required" }, 400);

  const admin = getAdminClient();

  // Load the task.
  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .select("id, title, status, assignee_id, related_entity_type, related_entity_id")
    .eq("id", taskId)
    .single();
  if (taskErr || !task) return jsonResp({ error: "Task not found" }, 404);

  // Decide routing for the new assignee.
  let routed = false;
  if (newAssigneeId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("route_tasks_to_sprint")
      .eq("id", newAssigneeId)
      .single();
    routed = !!profile?.route_tasks_to_sprint;
  }

  const isProject = task.related_entity_type === "project";
  const isComplete = task.status === "complete";

  // Update assignee (+ promote status when we create a sprint card so the
  // Sprint Done handler / workflow-complete-task active-only gate pass).
  const patch: Record<string, unknown> = { assignee_id: newAssigneeId };
  if (routed && !isComplete && task.status === "pending") {
    patch.status = "active";
  }
  const { error: updErr } = await admin.from("tasks").update(patch).eq("id", taskId);
  if (updErr) return jsonResp({ error: `Failed to reassign: ${updErr.message}` }, 500);

  // Update succeeded — now safe to remove any sprint card(s) tied to this task.
  // They belong to the previous assignee (or a previous routing state). Routing
  // is the only thing that sets personal_tasks.task_id, so clearing wholesale is
  // safe. Doing this only after the update ensures a failed update leaves the
  // sprint card intact (no destructive rollback needed).
  await admin.from("personal_tasks").delete().eq("task_id", taskId);

  let sprintCardCreated = false;
  if (newAssigneeId && routed && !isComplete) {
    // Sprint-routed: create a fresh sprint card in the new owner's active sprint.
    // No My Tasks notification — MyTasks dedupes tasks that have a sprint card.
    const { data: sprint } = await admin
      .from("sprints")
      .select("id")
      .eq("user_id", newAssigneeId)
      .eq("status", "active")
      .maybeSingle();

    await admin.from("personal_tasks").insert({
      created_by: newAssigneeId,
      content: task.title,
      status: "in_progress",
      position: Date.now() % 100000,
      task_id: taskId,
      project_id: isProject ? task.related_entity_id : null,
      sprint_id: sprint?.id || null,
    });
    sprintCardCreated = true;
  } else if (newAssigneeId && !isComplete) {
    // Default path: plain My Tasks entry — notify the new assignee.
    await admin.from("notifications").insert({
      user_id: newAssigneeId,
      type: "task_assigned",
      title: `Task assigned: ${task.title}`,
      body: task.title,
      link_tab: "my_tasks",
      link_target: taskId,
      is_read: false,
    });
  }

  // Audit trail (best-effort).
  await admin.from("task_events").insert({
    task_id: taskId,
    event_type: "reassigned",
    actor_id: caller.userId,
    payload: { new_assignee_id: newAssigneeId, routed, sprint_card: sprintCardCreated },
  });

  return jsonResp({ task_id: taskId, new_assignee_id: newAssigneeId, routed, sprint_card: sprintCardCreated });
});
