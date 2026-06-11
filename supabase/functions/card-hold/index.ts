// card-hold
// Admin-only hold / unhold for a Unified Content Kanban card.
// Hold: requires reason. Sets projects.on_hold=true + hold_reason; pauses
// any open tasks (status pending|active) → on_hold.
// Unhold: clears flag; restores on_hold tasks → pending.
//
// Body: { project_id, action: 'hold'|'unhold', reason? }
// Deploy: supabase functions deploy card-hold --no-verify-jwt

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

async function getCaller(req: Request): Promise<{ userId: string; role: string } | null> {
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
  return { userId: user.id, role: profile?.role || "" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller) return jsonResp({ error: "Unauthorized" }, 401);
  if (caller.role !== "admin") return jsonResp({ error: "Admin only" }, 403);

  let body: { project_id?: string; action?: string; reason?: string };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }

  const { project_id, action, reason } = body;
  if (!project_id) return jsonResp({ error: "project_id required" }, 400);
  if (action !== "hold" && action !== "unhold") {
    return jsonResp({ error: "action must be 'hold' or 'unhold'" }, 400);
  }

  const admin = getAdminClient();

  if (action === "hold") {
    if (!reason || !reason.trim()) {
      return jsonResp({ error: "reason required when holding" }, 400);
    }
    const trimmed = reason.trim();
    const { error: projErr } = await admin
      .from("projects")
      .update({ on_hold: true, hold_reason: trimmed, updated_at: new Date().toISOString() })
      .eq("id", project_id);
    if (projErr) return jsonResp({ error: `Failed to hold project: ${projErr.message}` }, 500);

    const { data: paused } = await admin
      .from("tasks")
      .update({ status: "on_hold", hold_reason: trimmed })
      .eq("related_entity_type", "project")
      .eq("related_entity_id", project_id)
      .in("status", ["pending", "active"])
      .select("id");

    return jsonResp({ project_id, action, reason: trimmed, paused_tasks: (paused || []).length });
  }

  // unhold
  const { error: projErr } = await admin
    .from("projects")
    .update({ on_hold: false, hold_reason: null, updated_at: new Date().toISOString() })
    .eq("id", project_id);
  if (projErr) return jsonResp({ error: `Failed to unhold project: ${projErr.message}` }, 500);

  const { data: restored } = await admin
    .from("tasks")
    .update({ status: "pending", hold_reason: null })
    .eq("related_entity_type", "project")
    .eq("related_entity_id", project_id)
    .eq("status", "on_hold")
    .is("completed_at", null)
    .select("id");

  return jsonResp({ project_id, action, restored_tasks: (restored || []).length });
});
