// supabase/functions/approve-automation/index.ts
// Resolves an admin-confirmation gate task created by run-automations.
//
// POST { task_id: uuid, outcome: 'approve' | 'reject' }
// - On approve: re-executes the original automation's actions using the stored
//   trigger_payload, then marks the run as 'success' and the task as 'complete'.
// - On reject: marks the run as 'error' and the task as 'declined'.
//
// Auth: requires admin JWT (and the requesting admin must be the assignee of
// the task, or any admin if assigned to all_admins).
// Deploy: supabase functions deploy approve-automation --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = context[key];
    return val != null ? String(val) : "";
  });
}

// Mirrors executeCreateTask / executeSendNotification in run-automations.
// Returns actions_taken or throws on first action failure.
async function runActions(
  admin: ReturnType<typeof createClient>,
  automationId: string,
  actions: Array<Record<string, unknown>>,
  triggerPayload: Record<string, unknown>,
  dedupKey: string | null,
): Promise<unknown[]> {
  const actionsTaken: unknown[] = [];

  for (const action of actions) {
    const actionType = action.type as string;
    const config = (action.config || {}) as Record<string, unknown>;

    if (actionType === "create_task") {
      const title = resolveTemplate(
        (config.title as string) || "Automation Task",
        triggerPayload,
      );
      const description = config.description
        ? resolveTemplate(config.description as string, triggerPayload)
        : null;
      const stepKey = (config.step_key as string) || "automation";
      const linkUrl = config.link_url
        ? resolveTemplate(config.link_url as string, triggerPayload)
        : null;
      const assigneeType = (config.assignee_type as string) || "all_admins";
      const assigneeId = config.assignee_id as string | null;
      const dueDate = config.due_date
        ? resolveTemplate(config.due_date as string, triggerPayload)
        : null;
      const navTarget = config.nav_target
        ? resolveTemplate(config.nav_target as string, triggerPayload)
        : null;

      let assigneeIds: string[] = [];
      if (assigneeType === "all_admins") {
        const { data: admins } = await admin
          .from("profiles")
          .select("id")
          .eq("role", "admin");
        assigneeIds = (admins || []).map((a: { id: string }) => a.id);
      } else if (assigneeType === "specific" && assigneeId) {
        assigneeIds = [assigneeId];
      } else if (assigneeType === "context" && config.assignee_context_key) {
        const resolvedId = triggerPayload[config.assignee_context_key as string];
        if (resolvedId) assigneeIds = [String(resolvedId)];
      }

      for (const aId of assigneeIds) {
        const insertData: Record<string, unknown> = {
          automation_id: automationId,
          step_key: stepKey,
          title,
          description,
          assignee_id: aId,
          status: "active",
          position: 0,
        };
        if (linkUrl) insertData.link_url = linkUrl;
        if (dueDate) insertData.due_date = dueDate;
        if (navTarget) insertData.nav_target = navTarget;
        if (dedupKey) insertData.dedup_key = dedupKey;

        // Idempotent on (automation_id, dedup_key, assignee_id): a retry after a
        // partial failure, or a concurrent execution, won't duplicate the task.
        const { error } = dedupKey
          ? await admin.from("tasks").upsert(insertData, {
              onConflict: "automation_id,dedup_key,assignee_id",
              ignoreDuplicates: true,
            })
          : await admin.from("tasks").insert(insertData);
        if (error) {
          throw new Error(`Failed to insert task for ${aId}: ${error.message}`);
        }
      }
      actionsTaken.push({ type: "create_task", title });
    } else if (actionType === "send_notification") {
      const title = resolveTemplate(
        (config.title as string) || "Automation Notification",
        triggerPayload,
      );
      const body = config.body
        ? resolveTemplate(config.body as string, triggerPayload)
        : null;
      const recipientType = (config.recipient_type as string) || "all_admins";
      const recipientId = config.recipient_id as string | null;

      let recipientIds: string[] = [];
      if (recipientType === "all_admins") {
        const { data: admins } = await admin
          .from("profiles")
          .select("id")
          .eq("role", "admin");
        recipientIds = (admins || []).map((a: { id: string }) => a.id);
      } else if (recipientType === "specific" && recipientId) {
        recipientIds = [recipientId];
      }

      for (const rId of recipientIds) {
        await admin.from("notifications").insert({
          user_id: rId,
          type: "automation",
          title,
          body,
        });
      }
      actionsTaken.push({ type: "send_notification" });
    }
  }

  return actionsTaken;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResp({ error: "Not authenticated" }, 401);
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return jsonResp({ error: "Not authenticated" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return jsonResp({ error: "Admin only" }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const taskId = body.task_id as string | undefined;
  const outcome = body.outcome as string | undefined;

  if (!taskId || !outcome) {
    return jsonResp({ error: "task_id and outcome required" }, 400);
  }
  if (outcome !== "approve" && outcome !== "reject") {
    return jsonResp({ error: "outcome must be 'approve' or 'reject'" }, 400);
  }

  // Load the task and verify it is a confirmation task.
  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .select("id, assignee_id, step_key, status, confirmation_run_id, automation_id")
    .eq("id", taskId)
    .single();
  if (taskErr || !task) {
    return jsonResp({ error: "Task not found" }, 404);
  }
  if (task.step_key !== "confirm_automation") {
    return jsonResp({ error: "Not a confirmation task" }, 400);
  }
  if (task.status !== "active" && task.status !== "on_hold") {
    return jsonResp({ error: `Task already resolved (status: ${task.status})` }, 400);
  }
  if (!task.confirmation_run_id) {
    return jsonResp({ error: "Task missing confirmation_run_id" }, 400);
  }
  // Each admin resolves their OWN confirmation task. For all_admins gates every
  // admin gets their own task; for a specific gate only the chosen admin does.
  // Either way, don't let one admin resolve a confirmation assigned to another.
  if (task.assignee_id && task.assignee_id !== user.id) {
    return jsonResp({ error: "Confirmation is assigned to another admin" }, 403);
  }

  // Load the pending run + automation.
  const { data: run, error: runErr } = await admin
    .from("automation_runs")
    .select("id, automation_id, trigger_payload, dedup_key, status")
    .eq("id", task.confirmation_run_id)
    .single();
  if (runErr || !run) {
    return jsonResp({ error: "Pending run not found" }, 404);
  }
  // Atomically claim the pending run before doing anything. Two admins acting on
  // the same all_admins confirmation gate (or a double-click) otherwise both pass
  // a passive status check and execute the actions twice. Only the update that
  // actually flips pending_confirmation -> running proceeds.
  const { data: claimed, error: claimErr } = await admin
    .from("automation_runs")
    .update({ status: "running" })
    .eq("id", run.id)
    .eq("status", "pending_confirmation")
    .select("id")
    .maybeSingle();
  if (claimErr) {
    return jsonResp({ error: `Failed to claim run: ${claimErr.message}` }, 500);
  }
  if (!claimed) {
    return jsonResp({ error: `Run no longer pending (status: ${run.status})` }, 400);
  }

  const { data: automation, error: automationErr } = await admin
    .from("automations")
    .select("id, name, actions")
    .eq("id", run.automation_id)
    .single();
  if (automationErr || !automation) {
    // Release the claim so the gate stays actionable.
    await admin.from("automation_runs").update({ status: "pending_confirmation" }).eq("id", run.id);
    return jsonResp({ error: "Automation not found" }, 404);
  }

  const nowIso = new Date().toISOString();

  // Resolve all sibling confirmation tasks for the same run (when assigned to
  // all_admins, multiple tasks were created; the first to act wins).
  const { data: siblingTasks } = await admin
    .from("tasks")
    .select("id, assignee_id")
    .eq("confirmation_run_id", run.id)
    .eq("status", "active");

  if (outcome === "approve") {
    let actionsTaken: unknown[] = [];
    try {
      actionsTaken = await runActions(
        admin,
        automation.id,
        (automation.actions as Array<Record<string, unknown>>) || [],
        (run.trigger_payload as Record<string, unknown>) || {},
        run.dedup_key,
      );
    } catch (err) {
      const errMsg = (err as Error).message;
      // Revert to pending_confirmation (not error) and leave the task active so
      // the admin can actually retry — a terminal 'error' status would make the
      // gate un-reapprovable. Task inserts are idempotent (unique dedup index),
      // so a retry after a partial failure won't duplicate already-created tasks.
      await admin
        .from("automation_runs")
        .update({ status: "pending_confirmation", error_message: errMsg, actions_taken: actionsTaken })
        .eq("id", run.id);
      await admin
        .from("automations")
        .update({ last_run_at: nowIso, last_error: errMsg })
        .eq("id", automation.id);
      return jsonResp({ error: `Action failed: ${errMsg}` }, 500);
    }

    // Mark run success
    await admin
      .from("automation_runs")
      .update({ status: "success", actions_taken: actionsTaken })
      .eq("id", run.id);

    // Bump automation counters
    await admin
      .from("automations")
      .update({ last_run_at: nowIso, last_error: null })
      .eq("id", automation.id);
    const { error: rpcErr } = await admin.rpc("increment_automation_run_count", {
      automation_uuid: automation.id,
    });
    if (rpcErr) {
      console.error(`increment_automation_run_count failed: ${rpcErr.message}`);
    }

    // Complete the acting task; mark siblings skipped.
    await admin
      .from("tasks")
      .update({
        status: "complete",
        completed_at: nowIso,
        completion_payload: { outcome: "approve", actions_taken: actionsTaken },
      })
      .eq("id", task.id);

    const siblingIds = (siblingTasks || []).map((t: { id: string }) => t.id).filter((id) => id !== task.id);
    if (siblingIds.length > 0) {
      await admin
        .from("tasks")
        .update({ status: "skipped", completed_at: nowIso, completion_payload: { outcome: "superseded", resolver_task_id: task.id } })
        .in("id", siblingIds);
    }

    return jsonResp({ ok: true, status: "success", actions_taken: actionsTaken });
  }

  // outcome === 'reject'
  const errMsg = "Declined by admin";
  await admin
    .from("automation_runs")
    .update({ status: "error", error_message: errMsg })
    .eq("id", run.id);
  await admin
    .from("automations")
    .update({ last_run_at: nowIso, last_error: errMsg })
    .eq("id", automation.id);

  await admin
    .from("tasks")
    .update({
      status: "declined",
      completed_at: nowIso,
      completion_payload: { outcome: "reject" },
    })
    .eq("id", task.id);

  const siblingIds = (siblingTasks || []).map((t: { id: string }) => t.id).filter((id) => id !== task.id);
  if (siblingIds.length > 0) {
    await admin
      .from("tasks")
      .update({ status: "skipped", completed_at: nowIso, completion_payload: { outcome: "superseded", resolver_task_id: task.id } })
      .in("id", siblingIds);
  }

  return jsonResp({ ok: true, status: "declined" });
});
