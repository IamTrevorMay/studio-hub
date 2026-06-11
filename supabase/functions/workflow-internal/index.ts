// supabase/functions/workflow-internal/index.ts
// Service-role helper for DB triggers that need to drive workflow operations
// without a user JWT. Authed via ?secret=<CRON_SECRET>.
//
// Operations:
//   { op: "start", slug, context }
//     → Starts a fresh workflow instance and its first task. Refuses if
//       an active instance for the same workflow already references the
//       same dedupe_key inside its context (used by the beat-sheet trigger
//       to avoid double-starting per beat sheet).
//
//   { op: "complete_match", slug, step_key, match_context, payload }
//     → Finds an active task whose workflow_instances.workflow_id matches
//       the slug, whose step_key matches, and whose workflow_instances.context
//       contains every (key, value) pair in match_context. Completes that
//       task with the given payload, advancing the workflow.
//
// Deploy: supabase functions deploy workflow-internal --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getAdminClient,
  corsHeaders,
  jsonResp,
  createTaskFromStep,
  logEvent,
  advanceWorkflow,
  checkFanIn,
  checkInstanceCompletion,
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

  const url = new URL(req.url);
  const provided =
    url.searchParams.get("secret") || req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || provided !== expected) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const op = body.op as string;
  if (!op) return jsonResp({ error: "op is required" }, 400);

  const admin = getAdminClient();

  if (op === "start") {
    // Phase 2 unified-Kanban gate: stop new instance creation while new board is built.
    // Other ops (complete_match, etc.) keep working so in-flight workflows advance.
    if (Deno.env.get("WORKFLOWS_DISABLED") === "true") {
      return jsonResp({ disabled: true, skipped: "Workflow creation temporarily disabled" }, 200);
    }
    const slug = body.slug as string;
    const ctx = (body.context as Record<string, unknown>) || {};
    const dedupeKey = body.dedupe_key as string | undefined;
    if (!slug) return jsonResp({ error: "slug is required" }, 400);

    // Look up the workflow row
    const { data: workflow, error: wfErr } = await admin
      .from("workflows")
      .select(
        "id, slug, name, description, source, first_step_key, current_version_id",
      )
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (wfErr || !workflow) {
      return jsonResp({ error: `Workflow "${slug}" not found or inactive` }, 404);
    }

    // Dedupe: if an active instance for the same workflow already has the
    // dedupe key (e.g. beat_sheet_id) in its context, skip the start.
    if (dedupeKey && ctx[dedupeKey] != null) {
      const { data: existing } = await admin
        .from("workflow_instances")
        .select("id")
        .eq("workflow_id", workflow.id)
        .eq("status", "active")
        .contains("context", { [dedupeKey]: ctx[dedupeKey] })
        .limit(1);
      if (existing && existing.length > 0) {
        return jsonResp({ skipped: "instance already active", instance_id: existing[0].id });
      }
    }

    // Resolve definition (live DB rows)
    const definition = workflow.source === "code"
      ? getWorkflowDefinition(workflow.slug)
      : await resolveWorkflowDefinition(admin, workflow, null);

    if (!definition) {
      return jsonResp({ error: `Workflow definition "${slug}" missing` }, 500);
    }

    // Derive a card title from context (beat_sheet_title, title, or workflow name).
    const cardTitle = (ctx.beat_sheet_title || ctx.title || workflow.name || "Untitled") as string;

    // Create instance with title + current_step_key so the Kanban board can display it.
    const { data: instance, error: instErr } = await admin
      .from("workflow_instances")
      .insert({
        workflow_id: workflow.id,
        status: "active",
        title: cardTitle,
        current_step_key: definition.firstStep,
        context: ctx,
        started_by: null,
        test_mode: false,
      })
      .select("id")
      .single();
    if (instErr || !instance) {
      return jsonResp(
        { error: `Failed to create instance: ${instErr?.message}` },
        500,
      );
    }

    const firstStep = definition.steps[definition.firstStep];
    if (!firstStep) {
      return jsonResp(
        { error: `First step "${definition.firstStep}" missing` },
        500,
      );
    }

    const task = await createTaskFromStep(
      admin,
      firstStep,
      instance.id,
      ctx,
      0,
      null,
      [],
      false,
    );

    if (!task) {
      // First step was skipped — advance past it
      const skip = await firstStep.onComplete(ctx, {}, admin);
      if (skip.contextUpdates) {
        Object.assign(ctx, skip.contextUpdates);
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
        skip.next,
        0,
        null,
        false,
      );
      return jsonResp({ instance_id: instance.id, task_ids: nextIds });
    }

    return jsonResp({ instance_id: instance.id, task_id: task.id });
  }

  if (op === "complete_match") {
    const slug = body.slug as string;
    const stepKey = body.step_key as string;
    const match = (body.match_context as Record<string, unknown>) || {};
    const payload = (body.payload as Record<string, unknown>) || {};
    if (!slug || !stepKey) {
      return jsonResp({ error: "slug and step_key are required" }, 400);
    }

    // Find candidate active tasks with this step_key, belonging to this workflow
    const { data: candidates, error: cErr } = await admin
      .from("tasks")
      .select(
        "id, status, position, workflow_instance_id, workflow_instance:workflow_instances(id, workflow_id, context, status, test_mode, workflow:workflows!inner(id, slug))",
      )
      .eq("step_key", stepKey)
      .eq("status", "active");
    if (cErr) {
      return jsonResp({ error: `Lookup failed: ${cErr.message}` }, 500);
    }

    const matched = (candidates || []).find((t) => {
      const inst = t.workflow_instance;
      if (!inst || inst.status !== "active") return false;
      const wf = inst.workflow;
      if (!wf || wf.slug !== slug) return false;
      const ctx = (inst.context || {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(match)) {
        if (ctx[k] !== v) return false;
      }
      return true;
    });

    if (!matched) {
      return jsonResp({ skipped: "no matching active task" });
    }

    const instance = matched.workflow_instance;
    const ctx = (instance.context || {}) as Record<string, unknown>;

    // Resolve definition
    const { data: workflow } = await admin
      .from("workflows")
      .select(
        "id, slug, name, description, source, first_step_key, current_version_id",
      )
      .eq("id", instance.workflow_id)
      .single();
    if (!workflow) return jsonResp({ error: "Workflow row missing" }, 500);

    const definition = workflow.source === "code"
      ? getWorkflowDefinition(workflow.slug)
      : await resolveWorkflowDefinition(admin, workflow, null);
    if (!definition) {
      return jsonResp({ error: "Definition missing" }, 500);
    }

    const stepDef = definition.steps[stepKey];
    if (!stepDef) {
      return jsonResp({ error: `Step "${stepKey}" missing` }, 500);
    }

    // Complete the task
    await admin
      .from("tasks")
      .update({
        status: "complete",
        completion_payload: payload,
        completed_at: new Date().toISOString(),
      })
      .eq("id", matched.id);

    await logEvent(admin, matched.id, "completed", null, { auto: true, payload });

    // Run onComplete handler + advance
    const result = await stepDef.onComplete(ctx, payload, admin);
    const updatedCtx = { ...ctx, ...(result.contextUpdates || {}) };
    if (result.contextUpdates) {
      await admin
        .from("workflow_instances")
        .update({ context: updatedCtx })
        .eq("id", instance.id);
    }

    const nextIds = await advanceWorkflow(
      admin,
      definition,
      instance.id,
      updatedCtx,
      result.next,
      matched.position,
      null,
      !!instance.test_mode,
    );

    // Fan-in check (may unblock pending tasks)
    const activated = await checkFanIn(admin, instance.id, null);
    await checkInstanceCompletion(admin, instance.id);

    return jsonResp({
      ok: true,
      completed_task_id: matched.id,
      next_task_ids: [...nextIds, ...activated],
    });
  }

  return jsonResp({ error: `Unknown op: ${op}` }, 400);
});
