// supabase/functions/run-automations/index.ts
// Executes automation rules. Two invocation modes:
//   1. Schedule mode (cron): checks enabled schedule automations against current time
//   2. Event mode (HTTP POST): receives { event, source, payload } and runs matching automations
// Deploy: supabase functions deploy run-automations --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin tier = admin + director (mirrors the DB is_admin() helper and the
// client-side isAdminTier). Directors are restricted in the UI, not here.
const ADMIN_TIER = ["admin", "director"];

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

// Like resolveTemplate but reports whether any referenced variable was absent.
// Used for dedup keys: a key with an unresolved variable cannot guarantee
// idempotency, so callers skip the fire rather than collapse it to a colliding
// partial key (e.g. 'clip_{{video_id}}' -> 'clip_' for every payload).
function resolveTemplateStrict(
  template: string,
  context: Record<string, unknown>,
): { text: string; missing: boolean } {
  let missing = false;
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = context[key];
    if (val == null) {
      missing = true;
      return "";
    }
    return String(val);
  });
  return { text, missing };
}

// Hours to ADD to America/Los_Angeles local time to reach UTC: 7 during PDT,
// 8 during PST. Computed live from the zone so schedules don't drift across DST.
function laUtcOffsetHours(d: Date): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "shortOffset",
  })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value || "GMT-8";
  const m = name.match(/GMT([+-]\d+)/);
  return m ? -parseInt(m[1], 10) : 8;
}

// Resolve a schedule's target UTC hour. Prefer hour_pt (PT intent, converted
// live for DST); fall back to legacy time_utc rows. Schedules are hour-granular
// (cron fires at minute 0), so only the hour is significant.
function targetUtcHour(
  config: Record<string, unknown>,
  nowUtc: Date,
): number {
  if (config.hour_pt != null) {
    const hp = Number(config.hour_pt);
    return ((hp + laUtcOffsetHours(nowUtc)) % 24 + 24) % 24;
  }
  const timeStr = (config.time_utc as string) || "00:00";
  return Number(String(timeStr).split(":")[0]) || 0;
}

// Pacific-time calendar helpers. Schedules express day/date intent in PT (e.g.
// "payroll on the 1st and 15th"), so the day-of-month / day-of-week / dedup date
// must be computed in America/Los_Angeles, not UTC — otherwise any schedule
// whose firing hour lands after PT midnight in UTC is off by a day. (The firing
// HOUR itself stays UTC because config stores time_utc.)
function ptDayString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
function ptDayOfMonth(d: Date = new Date()): number {
  return parseInt(ptDayString(d).slice(8, 10), 10);
}
function ptDayOfWeek(d: Date = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

// Build schedule context variables (PT-anchored)
function getScheduleContext(): Record<string, unknown> {
  const now = new Date();
  return {
    today: ptDayString(now),
    day_of_month: String(ptDayOfMonth(now)),
    day_of_week: String(ptDayOfWeek(now)),
  };
}

// Check if a schedule automation should fire at the current UTC time
function shouldFireSchedule(
  config: Record<string, unknown>,
  nowUtc: Date,
): boolean {
  const currentDay = ptDayOfMonth(nowUtc); // PT calendar day (config.days is PT intent)
  const currentHour = nowUtc.getUTCHours();
  const targetHour = targetUtcHour(config, nowUtc);

  const type = config.type as string;

  if (type === "days_of_month") {
    const days = config.days as number[];
    return days.includes(currentDay) && currentHour === targetHour;
  }

  if (type === "daily") {
    return currentHour === targetHour;
  }

  if (type === "weekly") {
    const dayOfWeek = (config.day_of_week as number) ?? 1; // default Monday
    return ptDayOfWeek(nowUtc) === dayOfWeek && currentHour === targetHour;
  }

  return false;
}

// Execute a single automation's actions
async function executeAutomation(
  admin: ReturnType<typeof createClient>,
  automation: Record<string, unknown>,
  triggerPayload: Record<string, unknown>,
): Promise<{ status: string; actions_taken: unknown[]; error_message?: string; dedupResolved?: string | null; alreadyLogged?: boolean }> {
  const actions = automation.actions as Array<Record<string, unknown>>;
  const dedupTemplate = automation.dedup_key as string | null;
  const automationId = automation.id as string;
  const requiresConfirmation = automation.requires_confirmation === true;
  const confirmationAdminId = automation.confirmation_admin_id as string | null;
  const actionsTaken: unknown[] = [];

  // Resolve dedup key. If the template references a variable absent from the
  // payload, the key can't guarantee idempotency (it would collapse to a value
  // that collides across distinct triggers), so skip the fire entirely rather
  // than risk firing duplicates on retry or wrongly deduping unrelated events.
  let dedupResolved: string | null = null;
  if (dedupTemplate) {
    const { text, missing } = resolveTemplateStrict(dedupTemplate, triggerPayload);
    if (missing) {
      return {
        status: "skipped",
        actions_taken: [],
        error_message: `Dedup key "${dedupTemplate}" has unresolved variable(s); skipping to avoid duplicate/incorrect fire`,
      };
    }
    dedupResolved = text;
  }

  // Check dedup: skip if a previous successful OR pending_confirmation run with
  // same automation_id + dedup_key exists. Pending counts because we don't want
  // to stack multiple confirmation tasks for the same trigger.
  if (dedupResolved) {
    const { data: existing } = await admin
      .from("automation_runs")
      .select("id")
      .eq("automation_id", automationId)
      .eq("dedup_key", dedupResolved)
      .in("status", ["success", "pending_confirmation"])
      .limit(1);

    if (existing && existing.length > 0) {
      return { status: "skipped", actions_taken: [], error_message: `Dedup: automation already ran for "${dedupResolved}"` };
    }
  }

  // Admin-confirmation gate: defer action execution until an admin approves.
  if (requiresConfirmation) {
    const gateResult = await createConfirmationGate(
      admin,
      automation,
      triggerPayload,
      dedupResolved,
      confirmationAdminId,
    );
    return gateResult;
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
        dedupResolved,
      };
    }
  }

  return { status: "success", actions_taken: actionsTaken, dedupResolved };
}

// Build a human-readable preview of the deferred actions for the confirmation task description.
function describeActions(
  actions: Array<Record<string, unknown>>,
  triggerPayload: Record<string, unknown>,
): string {
  if (!actions || actions.length === 0) return "(no actions configured)";
  const lines = actions.map((a, i) => {
    const cfg = (a.config || {}) as Record<string, unknown>;
    if (a.type === "create_task") {
      const title = cfg.title ? resolveTemplate(String(cfg.title), triggerPayload) : "(untitled)";
      const assignee = cfg.assignee_type === "all_admins"
        ? "all admins"
        : cfg.assignee_type === "specific"
        ? "specific user"
        : cfg.assignee_type === "context"
        ? "context user"
        : "unknown";
      return `${i + 1}. Create task "${title}" → ${assignee}`;
    }
    if (a.type === "send_notification") {
      const title = cfg.title ? resolveTemplate(String(cfg.title), triggerPayload) : "(untitled)";
      return `${i + 1}. Send notification "${title}"`;
    }
    return `${i + 1}. ${a.type}`;
  });
  return lines.join("\n");
}

// Create the confirmation gate: insert pending automation_run + assigned confirmation task(s).
async function createConfirmationGate(
  admin: ReturnType<typeof createClient>,
  automation: Record<string, unknown>,
  triggerPayload: Record<string, unknown>,
  dedupResolved: string | null,
  confirmationAdminId: string | null,
): Promise<{ status: string; actions_taken: unknown[]; error_message?: string; dedupResolved?: string | null; alreadyLogged: boolean }> {
  const automationId = automation.id as string;
  const automationName = (automation.name as string) || "Automation";
  const actions = (automation.actions as Array<Record<string, unknown>>) || [];

  // Insert the pending run row up front so dedup blocks repeat fires.
  const { data: runRow, error: runErr } = await admin
    .from("automation_runs")
    .insert({
      automation_id: automationId,
      trigger_payload: triggerPayload,
      actions_taken: [],
      status: "pending_confirmation",
      dedup_key: dedupResolved,
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return {
      status: "error",
      actions_taken: [],
      error_message: `Failed to log pending confirmation: ${runErr?.message || "unknown"}`,
      dedupResolved,
      alreadyLogged: false,
    };
  }

  // Resolve assignees: chosen admin, else all admins.
  let assigneeIds: string[] = [];
  if (confirmationAdminId) {
    assigneeIds = [confirmationAdminId];
  } else {
    const { data: admins } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    assigneeIds = (admins || []).map((a: { id: string }) => a.id);
  }

  if (assigneeIds.length === 0) {
    // Roll back the pending row so the admin can re-fire after configuring an admin.
    await admin.from("automation_runs").update({
      status: "error",
      error_message: "No admin assignee available for confirmation",
    }).eq("id", runRow.id);
    return {
      status: "error",
      actions_taken: [],
      error_message: "No admin assignee available for confirmation",
      dedupResolved,
      alreadyLogged: true,
    };
  }

  const description = `Approve to fire this automation. Decline to cancel.\n\nActions:\n${describeActions(actions, triggerPayload)}`;

  for (const aId of assigneeIds) {
    const { error } = await admin.from("tasks").insert({
      automation_id: automationId,
      confirmation_run_id: runRow.id,
      step_key: "confirm_automation",
      title: `Confirm: ${automationName}`,
      description,
      assignee_id: aId,
      status: "active",
      position: 0,
      dedup_key: dedupResolved,
    });
    if (error) {
      console.error(`Failed to insert confirmation task for ${aId}: ${error.message}`);
    }
  }

  return {
    status: "pending_confirmation",
    actions_taken: [],
    dedupResolved,
    alreadyLogged: true,
  };
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

  // Create a task for each assignee. Idempotent per (automation, dedup_key,
  // assignee): if a previous run created this assignee's task but failed on a
  // later assignee, the retry skips the ones already made instead of duplicating.
  for (const aId of assigneeIds) {
    if (dedupKey) {
      const { data: existingTask } = await admin
        .from("tasks")
        .select("id")
        .eq("automation_id", automationId)
        .eq("dedup_key", dedupKey)
        .eq("assignee_id", aId)
        .limit(1);
      if (existingTask && existingTask.length > 0) continue;
    }

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

    // The pre-check above is a fast path; the upsert closes the race where two
    // concurrent runs both pass the check. Unique index on
    // (automation_id, dedup_key, assignee_id) makes the duplicate a no-op.
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
  result: { status: string; actions_taken: unknown[]; error_message?: string; dedupResolved?: string | null; alreadyLogged?: boolean },
) {
  if (!result.alreadyLogged) {
    await admin.from("automation_runs").insert({
      automation_id: automationId,
      trigger_payload: triggerPayload,
      actions_taken: result.actions_taken,
      status: result.status,
      error_message: result.error_message || null,
      dedup_key: result.dedupResolved || null,
    });
  }

  const updates: Record<string, unknown> = {
    last_run_at: new Date().toISOString(),
    last_error: result.status === "error" ? result.error_message : null,
  };

  await admin
    .from("automations")
    .update(updates)
    .eq("id", automationId);

  // Atomic run_count bump via RPC. Surface failures instead of swallowing —
  // a missing/broken RPC silently zero-counts every run. Skip for
  // pending_confirmation runs — approve-automation increments on resolution.
  if (result.status !== "pending_confirmation") {
    const { error: rpcErr } = await admin.rpc("increment_automation_run_count", {
      automation_uuid: automationId,
    });
    if (rpcErr) {
      console.error(`increment_automation_run_count failed for ${automationId}: ${rpcErr.message}`);
    }
  }
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
    if (!ADMIN_TIER.includes(profile?.role)) {
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
    // Only allow event-mode invocations from cron (or service-role internal
    // callers that present the CRON_SECRET). Admin JWTs hitting this path
    // could otherwise hand-fire arbitrary events like 'new_video' and
    // synthesize tasks that look like they came from real triggers.
    if (!isCron) {
      return jsonResp({ error: "Event mode requires CRON_SECRET" }, 403);
    }

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
