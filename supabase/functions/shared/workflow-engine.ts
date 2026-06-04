// Kanban workflow engine.
// Workflow = board, workflow_steps rows = columns (ordered by position),
// workflow_instance = card. When a card enters a column, one task row is
// created per resolved assignee. Card advances when all tasks in the
// current column are complete.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ─────────────────────────────────────────────────────

export interface Column {
  id: string;
  workflow_id: string;
  step_key: string;
  title_template: string;
  position: number;
  default_assignee_ids: string[];
}

export interface Instance {
  id: string;
  workflow_id: string;
  title: string | null;
  status: string;
  context: Record<string, unknown>;
  current_step_key: string | null;
  assignee_overrides: Record<string, string[]>;
  test_mode: boolean;
}

// ─── Admin client ──────────────────────────────────────────────

export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ─── Auth helper ───────────────────────────────────────────────

export async function getUserFromJwt(
  req: Request,
): Promise<{ userId: string; isAdmin: boolean } | null> {
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

// ─── CORS ──────────────────────────────────────────────────────

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Notification + event helpers ──────────────────────────────

export async function notifyUser(
  admin: SupabaseClient,
  userId: string,
  title: string,
  body: string,
  taskId: string,
  testMode = false,
) {
  if (testMode) return;
  await admin.from("notifications").insert({
    user_id: userId,
    type: "task_assigned",
    title,
    body,
    link_tab: "my_tasks",
    link_target: taskId,
    is_read: false,
  });
}

export async function logEvent(
  admin: SupabaseClient,
  taskId: string,
  eventType: string,
  actorId: string,
  payload: Record<string, unknown> = {},
) {
  await admin.from("task_events").insert({
    task_id: taskId,
    event_type: eventType,
    actor_id: actorId,
    payload,
  });
}

// ─── Column lookups ────────────────────────────────────────────

export async function loadColumns(
  admin: SupabaseClient,
  workflowId: string,
): Promise<Column[]> {
  const { data, error } = await admin
    .from("workflow_steps")
    .select("id, workflow_id, step_key, title_template, position, default_assignee_ids")
    .eq("workflow_id", workflowId)
    .order("position", { ascending: true });
  if (error) throw new Error(`loadColumns: ${error.message}`);
  return (data || []).map((c) => ({
    ...c,
    default_assignee_ids: c.default_assignee_ids || [],
  })) as Column[];
}

export function findColumn(
  columns: Column[],
  stepKey: string | null,
): Column | null {
  if (!stepKey) return null;
  return columns.find((c) => c.step_key === stepKey) || null;
}

export function nextColumn(
  columns: Column[],
  stepKey: string,
): Column | null {
  const i = columns.findIndex((c) => c.step_key === stepKey);
  if (i < 0 || i >= columns.length - 1) return null;
  return columns[i + 1];
}

// ─── Resolve assignees for a card in a column ──────────────────

export function resolveAssignees(instance: Instance, column: Column): string[] {
  const override = instance.assignee_overrides?.[column.step_key];
  if (Array.isArray(override) && override.length > 0) return override;
  return column.default_assignee_ids || [];
}

// ─── Enter a column (create N tasks, or block) ─────────────────

export async function enterColumn(
  admin: SupabaseClient,
  instance: Instance,
  column: Column,
  actorId: string,
): Promise<{ taskIds: string[]; blocked: boolean }> {
  const assignees = resolveAssignees(instance, column);
  const cardTitle = instance.title || "Untitled card";
  const taskTitle = `${cardTitle} — ${column.title_template || column.step_key}`;

  // Empty column = halt card.
  if (assignees.length === 0) {
    await admin
      .from("workflow_instances")
      .update({ status: "blocked", current_step_key: column.step_key })
      .eq("id", instance.id);
    return { taskIds: [], blocked: true };
  }

  // Update card pointer to this column + ensure status active.
  await admin
    .from("workflow_instances")
    .update({ current_step_key: column.step_key, status: "active" })
    .eq("id", instance.id);

  // Insert one task per assignee.
  const rows = assignees.map((uid, i) => ({
    workflow_instance_id: instance.id,
    step_key: column.step_key,
    title: taskTitle,
    description: null,
    assignee_id: uid,
    status: "active",
    position: column.position * 100 + i,
  }));

  const { data: created, error } = await admin
    .from("tasks")
    .insert(rows)
    .select("id, assignee_id, title");

  if (error) throw new Error(`enterColumn insert: ${error.message}`);

  const taskIds: string[] = [];
  for (const t of created || []) {
    await logEvent(admin, t.id, "created", actorId, { column: column.step_key });
    if (t.assignee_id) {
      await notifyUser(admin, t.assignee_id, "New task assigned", t.title, t.id, instance.test_mode);
    }
    taskIds.push(t.id);
  }

  return { taskIds, blocked: false };
}

// ─── Skip all open tasks in a column for a card ────────────────

export async function skipOpenTasksInColumn(
  admin: SupabaseClient,
  instanceId: string,
  stepKey: string,
  actorId: string,
): Promise<string[]> {
  const { data: open } = await admin
    .from("tasks")
    .select("id")
    .eq("workflow_instance_id", instanceId)
    .eq("step_key", stepKey)
    .in("status", ["active", "on_hold", "pending"]);

  const ids = (open || []).map((t) => t.id);
  if (ids.length === 0) return [];

  await admin
    .from("tasks")
    .update({ status: "skipped", completed_at: new Date().toISOString() })
    .in("id", ids);

  for (const id of ids) {
    await logEvent(admin, id, "skipped", actorId, { reason: "card_moved" });
  }
  return ids;
}

// ─── Are all tasks in (instance, column) complete/skipped? ─────

export async function isColumnDone(
  admin: SupabaseClient,
  instanceId: string,
  stepKey: string,
): Promise<boolean> {
  const { data: open } = await admin
    .from("tasks")
    .select("id")
    .eq("workflow_instance_id", instanceId)
    .eq("step_key", stepKey)
    .in("status", ["active", "on_hold", "pending"]);
  return !open || open.length === 0;
}

// ─── Mark instance complete ────────────────────────────────────

export async function completeInstance(
  admin: SupabaseClient,
  instanceId: string,
) {
  await admin
    .from("workflow_instances")
    .update({
      status: "complete",
      completed_at: new Date().toISOString(),
      current_step_key: null,
    })
    .eq("id", instanceId);
}
