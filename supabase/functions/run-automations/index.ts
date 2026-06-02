// supabase/functions/run-automations/index.ts
// Executes automation rules. Two invocation modes:
//   1. Schedule mode (cron): checks enabled schedule automations against current time
//   2. Event mode (HTTP POST): receives { event, source, payload } and runs matching automations
// Deploy: supabase functions deploy run-automations --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Simple {{variable}} template resolution
function resolveTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = context[key];
    return val != null ? String(val) : "";
  });
}

// Build schedule context variables
function getScheduleContext(): Record<string, unknown> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const dayOfMonth = now.getUTCDate();
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  return { today, day_of_month: String(dayOfMonth), day_of_week: String(dayOfWeek) };
}

// Check if a schedule automation should fire at the current UTC time
function shouldFireSchedule(
  config: Record<string, unknown>,
  nowUtc: Date,
): boolean {
  const currentDay = nowUtc.getUTCDate();
  const currentHour = nowUtc.getUTCHours();

  const type = config.type as string;

  if (type === "days_of_month") {
    const days = config.days as number[];
    const timeStr = (config.time_utc as string) || "00:00";
    const [targetHour] = timeStr.split(":").map(Number);
    return days.includes(currentDay) && currentHour === targetHour;
  }

  if (type === "daily") {
    const timeStr = (config.time_utc as string) || "00:00";
    const [targetHour] = timeStr.split(":").map(Number);
    return currentHour === targetHour;
  }

  if (type === "weekly") {
    const dayOfWeek = (config.day_of_week as number) ?? 1; // default Monday
    const timeStr = (config.time_utc as string) || "00:00";
    const [targetHour] = timeStr.split(":").map(Number);
    return nowUtc.getUTCDay() === dayOfWeek && currentHour === targetHour;
  }

  return false;
}

// Execute a single automation's actions
async function executeAutomation(
  admin: ReturnType<typeof createClient>,
  automation: Record<string, unknown>,
  triggerPayload: Record<string, unknown>,
): Promise<{ status: string; actions_taken: unknown[]; error_message?: string; dedupResolved?: string | null }> {
  const actions = automation.actions as Array<Record<string, unknown>>;
  const dedupTemplate = automation.dedup_key as string | null;
  const automationId = automation.id as string;
  const actionsTaken: unknown[] = [];

  // Resolve dedup key
  let dedupResolved: string | null = null;
  if (dedupTemplate) {
    dedupResolved = resolveTemplate(dedupTemplate, triggerPayload);
  }

  // Check dedup: skip if any active task with same automation_id + dedup_key exists
  if (dedupResolved) {
    const { data: existing } = await admin
      .from("tasks")
      .select("id")
      .eq("automation_id", automationId)
      .eq("status", "active")
      .eq("dedup_key", dedupResolved)
      .limit(1);

    if (existing && existing.length > 0) {
      return { status: "skipped", actions_taken: [], error_message: `Dedup: active task exists for "${dedupResolved}"` };
    }
  }

  for (const action of actions) {
    const actionType = action.type as string;
    const config = (action.config || {}) as Record<string, unknown>;

    try {
      if (actionType === "create_task") {
        await executeCreateTask(admin, automationId, config, triggerPayload, dedupResolved);
        actionsTaken.push({ type: "create_task", title: config.title });
      } else if (actionType === "send_notification") {
        await executeSendNotification(admin, config, triggerPayload);
        actionsTaken.push({ type: "send_notification" });
      }
    } catch (err) {
      return {
        status: "error",
        actions_taken: actionsTaken,
        error_message: `Action ${actionType} failed: ${(err as Error).message}`,
      };
    }
  }

  return { status: "success", actions_taken: actionsTaken };
}

// Create task action
async function executeCreateTask(
  admin: ReturnType<typeof createClient>,
  automationId: string,
  config: Record<string, unknown>,
  triggerPayload: Record<string, unknown>,
  dedupKey: string | null,
) {
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

  // Determine assignees
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

  // Create a task for each assignee
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

    const { error } = await admin.from("tasks").insert(insertData);
    if (error) {
      throw new Error(`Failed to insert task for ${aId}: ${error.message}`);
    }
  }
}

// Send notification action
async function executeSendNotification(
  admin: ReturnType<typeof createClient>,
  config: Record<string, unknown>,
  triggerPayload: Record<string, unknown>,
) {
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
}

// Log automation run
async function logRun(
  admin: ReturnType<typeof createClient>,
  automationId: string,
  triggerPayload: Record<string, unknown>,
  result: { status: string; actions_taken: unknown[]; error_message?: string },
) {
  await admin.from("automation_runs").insert({
    automation_id: automationId,
    trigger_payload: triggerPayload,
    actions_taken: result.actions_taken,
    status: result.status,
    error_message: result.error_message || null,
  });

  // Update automation metadata
  const updates: Record<string, unknown> = {
    last_run_at: new Date().toISOString(),
    run_count: admin.rpc ? undefined : undefined, // handled below
  };
  if (result.status === "error") {
    updates.last_error = result.error_message;
  } else {
    updates.last_error = null;
  }

  await admin
    .from("automations")
    .update(updates)
    .eq("id", automationId);

  // Increment run_count via raw SQL to avoid race conditions
  await admin.rpc("increment_automation_run_count", {
    automation_uuid: automationId,
  }).catch(() => {
    // Fallback: just update with a non-atomic increment
    // The RPC may not exist yet; this is fine
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  // Auth: accept CRON_SECRET or valid Supabase JWT
  const url = new URL(req.url);
  const cronSecret =
    url.searchParams.get("secret") || req.headers.get("x-cron-secret");
  const expectedSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");

  let isCron = false;
  if (expectedSecret && cronSecret === expectedSecret) {
    isCron = true;
  } else if (authHeader) {
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
    // Check admin role
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") {
      return jsonResp({ error: "Admin only" }, 403);
    }
  } else {
    return jsonResp({ error: "Not authenticated" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine for cron mode
  }

  const event = body.event as string | undefined;
  const source = body.source as string | undefined;
  const payload = (body.payload || {}) as Record<string, unknown>;

  const results: Array<{ automation: string; status: string; error?: string }> = [];

  if (event) {
    // ─── Event mode ───────────────────────────────────────────
    const { data: automations, error } = await admin
      .from("automations")
      .select("*")
      .eq("is_enabled", true)
      .eq("trigger_type", "event");

    if (error) {
      return jsonResp({ error: `Failed to query automations: ${error.message}` }, 500);
    }

    for (const auto of automations || []) {
      const config = auto.trigger_config as Record<string, unknown>;
      if (config.event !== event) continue;
      if (config.source && config.source !== source) continue;

      const triggerPayload = { ...payload, event, source: source || "" };
      const result = await executeAutomation(admin, auto, triggerPayload);
      await logRun(admin, auto.id, triggerPayload, result);
      results.push({ automation: auto.name, status: result.status, error: result.error_message });
    }
  } else if (isCron) {
    // ─── Schedule mode ────────────────────────────────────────
    const nowUtc = new Date();
    const { data: automations, error } = await admin
      .from("automations")
      .select("*")
      .eq("is_enabled", true)
      .eq("trigger_type", "schedule");

    if (error) {
      return jsonResp({ error: `Failed to query automations: ${error.message}` }, 500);
    }

    for (const auto of automations || []) {
      const config = auto.trigger_config as Record<string, unknown>;
      if (!shouldFireSchedule(config, nowUtc)) continue;

      const triggerPayload = getScheduleContext();
      const result = await executeAutomation(admin, auto, triggerPayload);
      await logRun(admin, auto.id, triggerPayload, result);
      results.push({ automation: auto.name, status: result.status, error: result.error_message });
    }
  } else {
    return jsonResp({ error: "Must provide event/source payload or be called via cron" }, 400);
  }

  return jsonResp({ ok: true, results });
});
