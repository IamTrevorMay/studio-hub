// Start a workflow instance (= create a kanban card on column 1).
// Body: { slug, title, context?, test_mode?, assignee_overrides? }
// Deploy: supabase functions deploy workflow-start --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
  loadColumns,
  enterColumn,
  type Instance,
} from "../shared/workflow-engine.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const auth = await getUserFromJwt(req);
  if (!auth) return jsonResp({ error: "Unauthorized" }, 401);
  if (!auth.isAdmin) return jsonResp({ error: "Admin only" }, 403);

  let body: {
    slug?: string;
    workflow_id?: string;
    title?: string;
    context?: Record<string, unknown>;
    assignee_overrides?: Record<string, string[]>;
    test_mode?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const { slug, workflow_id, title, context, assignee_overrides, test_mode } = body;
  if (!slug && !workflow_id) {
    return jsonResp({ error: "slug or workflow_id required" }, 400);
  }
  if (!title || !title.trim()) {
    return jsonResp({ error: "title required" }, 400);
  }

  const admin = getAdminClient();

  // Resolve workflow.
  const q = admin.from("workflows").select("id, slug, name, is_active");
  const { data: workflow, error: wfErr } = workflow_id
    ? await q.eq("id", workflow_id).single()
    : await q.eq("slug", slug!).eq("is_active", true).single();

  if (wfErr || !workflow) {
    return jsonResp({ error: "Workflow not found or inactive" }, 404);
  }

  // Load columns.
  const columns = await loadColumns(admin, workflow.id);
  if (columns.length === 0) {
    return jsonResp({ error: "Workflow has no columns" }, 400);
  }

  // Find first non-terminal column.
  const first = columns.find((c) => !c.is_terminal) || columns[0];

  // Create card.
  const { data: created, error: instErr } = await admin
    .from("workflow_instances")
    .insert({
      workflow_id: workflow.id,
      status: "active",
      title: title.trim(),
      context: context || {},
      assignee_overrides: assignee_overrides || {},
      started_by: auth.userId,
      test_mode: !!test_mode,
    })
    .select("*")
    .single();

  if (instErr || !created) {
    return jsonResp({ error: `Insert failed: ${instErr?.message}` }, 500);
  }

  const instance: Instance = {
    id: created.id,
    workflow_id: created.workflow_id,
    title: created.title,
    status: created.status,
    context: created.context || {},
    current_step_key: created.current_step_key,
    assignee_overrides: created.assignee_overrides || {},
    test_mode: created.test_mode || false,
  };

  // Enter first column.
  const { taskIds, blocked } = await enterColumn(admin, instance, first, auth.userId);

  return jsonResp({
    instance_id: instance.id,
    task_ids: taskIds,
    blocked,
    current_step_key: first.step_key,
  });
});
