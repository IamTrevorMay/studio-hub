// Workflow status for the Mayday Assistant (V6 Phase 5) — "What's Henry on
// right now?" and "Where does each project stand?" Read-only.
//
//   POST /functions/v1/assistant-workflow-status
//   { person?: string }   — optional name/nickname filter for the team list
//   → { team: [{ name, nickname, task, workflow_step, since, status_note }],
//       projects: [{ name, status, deadline, on_hold, hold_reason }] }
//
// Deploy: supabase functions deploy assistant-workflow-status --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Self-contained auth (same contract as shared/workflow-engine.getUserFromJwt).
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: profile } = await admin
    .from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return json({ error: "Admin only" }, 403);

  let person = "";
  try {
    const body = await req.json().catch(() => ({}));
    person = String(body?.person ?? "").trim();
  } catch { /* empty body is fine */ }

  const [tasksQ, projectsQ] = await Promise.all([
    admin.from("tasks")
      .select("title, step_key, created_at, assignee_id, profiles:assignee_id (full_name, nickname, status_note)")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(50),
    admin.from("projects")
      .select("name, status, deadline, on_hold, hold_reason")
      .eq("is_archived", false)
      .order("sort_order", { ascending: true })
      .limit(25),
  ]);
  if (tasksQ.error) return json({ error: tasksQ.error.message }, 500);
  if (projectsQ.error) return json({ error: projectsQ.error.message }, 500);

  type Prof = { full_name: string | null; nickname: string | null; status_note: string | null };
  let team = (tasksQ.data ?? []).map((t) => {
    const p = (t.profiles ?? {}) as Prof;
    return {
      name: p.full_name ?? "Unassigned",
      nickname: p.nickname ?? null,
      task: t.title,
      workflow_step: t.step_key,
      since: t.created_at,
      status_note: p.status_note ?? null,
    };
  });
  if (person) {
    const q = person.toLowerCase();
    team = team.filter((t) =>
      t.name.toLowerCase().includes(q) || (t.nickname ?? "").toLowerCase().includes(q));
  }

  return json({ team, projects: projectsQ.data ?? [] });
});
