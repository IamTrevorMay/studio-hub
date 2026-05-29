// supabase/functions/workflow-start/index.ts
// Starts a new workflow instance and creates the first task(s).
// Supports both code-sourced and data-driven workflows.
// Deploy: supabase functions deploy workflow-start --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
  createTaskFromStep,
  advanceWorkflow,
} from "../shared/workflow-engine.ts";
import {
  getWorkflowDefinition,
  resolveWorkflowDefinition,
} from "../shared/workflow-definitions.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  const auth = await getUserFromJwt(req);
  if (!auth) return jsonResp({ error: "Unauthorized" }, 401);

  let body: {
    slug?: string;
    context?: Record<string, unknown>;
    test_mode?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const { slug, context: initialContext, test_mode: testMode } = body;
  if (!slug) return jsonResp({ error: "slug is required" }, 400);

  // Only admins can run test mode
  if (testMode && !auth.isAdmin) {
    return jsonResp({ error: "Only admins can run test mode" }, 403);
  }

  const admin = getAdminClient();

  // Look up the workflow row
  const { data: workflow, error: wfErr } = await admin
    .from("workflows")
    .select("id, slug, name, description, source, first_step_key, current_version_id")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (wfErr || !workflow) {
    return jsonResp(
      { error: `Workflow "${slug}" not found or inactive in database. Seed it first.` },
      404,
    );
  }

  // Resolve the definition (dual-mode: code or data)
  let definition;
  if (workflow.source === "code") {
    definition = getWorkflowDefinition(workflow.slug);
  } else {
    definition = await resolveWorkflowDefinition(admin, workflow);
  }

  if (!definition) {
    return jsonResp(
      { error: `Workflow definition "${slug}" could not be resolved` },
      500,
    );
  }

  // Create the instance
  const ctx = initialContext || {};
  const instancePayload: Record<string, unknown> = {
    workflow_id: workflow.id,
    status: "active",
    context: ctx,
    started_by: auth.userId,
    test_mode: !!testMode,
  };

  // No version pinning — always use live DB rows so builder changes
  // take effect immediately, even for in-flight instances.

  const { data: instance, error: instErr } = await admin
    .from("workflow_instances")
    .insert(instancePayload)
    .select("id")
    .single();

  if (instErr || !instance) {
    return jsonResp(
      { error: `Failed to create instance: ${instErr?.message}` },
      500,
    );
  }

  // Create the first task
  const firstStep = definition.steps[definition.firstStep];
  if (!firstStep) {
    return jsonResp(
      { error: `First step "${definition.firstStep}" not found in definition` },
      500,
    );
  }

  const task = await createTaskFromStep(
    admin,
    firstStep,
    instance.id,
    ctx,
    0,
    auth.userId,
    [],
    !!testMode,
  );

  if (!task) {
    // First step was skipped (condition false) — advance past it
    const skipResult = await firstStep.onComplete(ctx, {}, admin);
    if (skipResult.contextUpdates) {
      Object.assign(ctx, skipResult.contextUpdates);
      await admin
        .from("workflow_instances")
        .update({ context: ctx })
        .eq("id", instance.id);
    }
    const nextIds = await advanceWorkflow(
      admin,
      definition,
      instance.id,
      ctx,
      skipResult.next,
      0,
      auth.userId,
      !!testMode,
    );
    return jsonResp({ instance_id: instance.id, task_ids: nextIds });
  }

  return jsonResp({ instance_id: instance.id, task_id: task.id });
});
