// supabase/functions/workflow-cleanup-test/index.ts
// Cleans up all test-mode data for a workflow instance.
// Admin-only endpoint.
// Deploy: supabase functions deploy workflow-cleanup-test --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
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

  let body: { instance_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const { instance_id } = body;
  if (!instance_id) {
    return jsonResp({ error: "instance_id is required" }, 400);
  }

  const admin = getAdminClient();

  // Verify the instance exists and is in test mode
  const { data: instance, error: instErr } = await admin
    .from("workflow_instances")
    .select("id, test_mode")
    .eq("id", instance_id)
    .single();

  if (instErr || !instance) {
    return jsonResp({ error: "Instance not found" }, 404);
  }

  if (!instance.test_mode) {
    return jsonResp(
      { error: "Cannot clean up a non-test instance" },
      400,
    );
  }

  // Delete task_events for all tasks in this instance
  const { data: tasks } = await admin
    .from("tasks")
    .select("id")
    .eq("workflow_instance_id", instance_id);

  const taskIds = (tasks || []).map((t: { id: string }) => t.id);

  if (taskIds.length > 0) {
    await admin
      .from("task_events")
      .delete()
      .in("task_id", taskIds);
  }

  // Delete all tasks for this instance
  await admin
    .from("tasks")
    .delete()
    .eq("workflow_instance_id", instance_id);

  // Delete the instance itself
  await admin
    .from("workflow_instances")
    .delete()
    .eq("id", instance_id);

  return jsonResp({
    deleted: {
      instance_id,
      task_count: taskIds.length,
    },
  });
});
