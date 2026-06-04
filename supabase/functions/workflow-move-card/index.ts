// Move a card to a target column (admin escape hatch).
// Skips any open tasks in the vacated column (including their sign-offs),
// sets current_step_key, then enters target column.
// Body: { instance_id, target_step_key }
// Deploy: supabase functions deploy workflow-move-card --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
  loadColumns,
  findColumn,
  enterColumn,
  skipOpenTasksInColumn,
  completeInstance,
  type Instance,
} from "../shared/workflow-engine.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const auth = await getUserFromJwt(req);
  if (!auth) return jsonResp({ error: "Unauthorized" }, 401);
  if (!auth.isAdmin) return jsonResp({ error: "Admin only" }, 403);

  let body: { instance_id?: string; target_step_key?: string };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }
  const { instance_id, target_step_key } = body;
  if (!instance_id || !target_step_key) {
    return jsonResp({ error: "instance_id + target_step_key required" }, 400);
  }

  const admin = getAdminClient();

  const { data: inst, error: instErr } = await admin
    .from("workflow_instances")
    .select("*")
    .eq("id", instance_id)
    .single();
  if (instErr || !inst) return jsonResp({ error: "Card not found" }, 404);

  const columns = await loadColumns(admin, inst.workflow_id);
  const target = findColumn(columns, target_step_key);
  if (!target) return jsonResp({ error: "Target column not in workflow" }, 400);

  // Skip vacated column's open tasks (and their sign-offs).
  let skipped: string[] = [];
  if (inst.current_step_key && inst.current_step_key !== target_step_key) {
    skipped = await skipOpenTasksInColumn(admin, inst.id, inst.current_step_key, auth.userId);
  }

  // Reopen instance if it was complete (rare but possible via backward move).
  if (inst.status === "complete") {
    await admin
      .from("workflow_instances")
      .update({ status: "active", completed_at: null })
      .eq("id", inst.id);
  }

  const instance: Instance = {
    id: inst.id,
    workflow_id: inst.workflow_id,
    title: inst.title,
    status: "active",
    context: inst.context || {},
    current_step_key: target_step_key,
    assignee_overrides: inst.assignee_overrides || {},
    test_mode: inst.test_mode || false,
  };

  const { taskIds, blocked } = await enterColumn(admin, instance, target, auth.userId);

  return jsonResp({
    moved: instance_id,
    target_step_key,
    new_task_ids: taskIds,
    skipped_task_ids: skipped,
    blocked,
  });
});
