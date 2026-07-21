// Project pace data for the Mayday Assistant ("Gerald") — every active
// project's stage, dates (deadline / film_date / edit_deadline), checklist
// progress, and current-stage assignees. Pass { project: "name-ish" } to also
// get a detail block for one project (adds latest comments).
//
//   POST /functions/v1/assistant-project-detail  { project?: string }
//   → { projects: [...], detail: {...} | null }
//
// Deploy: supabase functions deploy assistant-project-detail --no-verify-jwt

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

  let wanted = "";
  try {
    const body = await req.json();
    wanted = String(body?.project ?? "").trim().toLowerCase();
  } catch { /* empty body is fine */ }

  const { data: projects, error } = await admin
    .from("projects")
    .select("id, name, type, status, deadline, film_date, edit_deadline, post_time, on_hold, hold_reason")
    .eq("is_archived", false)
    .neq("status", "publish")
    .order("deadline", { ascending: true, nullsFirst: false });
  if (error) return json({ error: error.message }, 500);
  const rows = projects ?? [];
  const ids = rows.map((p) => p.id);

  const [checklistsQ, stageAssignQ] = await Promise.all([
    ids.length
      ? admin.from("project_checklists")
          .select("project_id, stage, is_complete").in("project_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? admin.from("project_stage_assignments")
          .select("project_id, stage, profile:profiles(full_name)").in("project_id", ids)
      : Promise.resolve({ data: [] }),
  ]);
  const checklists = (checklistsQ.data ?? []) as
    { project_id: string; stage: string; is_complete: boolean }[];
  const stageAssigns = (stageAssignQ.data ?? []) as unknown as
    { project_id: string; stage: string; profile: { full_name: string } | null }[];

  const enriched = rows.map((p) => {
    const mine = checklists.filter((c) => c.project_id === p.id);
    const stageItems = mine.filter((c) => c.stage === p.status);
    return {
      ...p,
      stage_checklist: {
        done: stageItems.filter((c) => c.is_complete).length,
        total: stageItems.length,
      },
      total_checklist: {
        done: mine.filter((c) => c.is_complete).length,
        total: mine.length,
      },
      stage_assignees: stageAssigns
        .filter((a) => a.project_id === p.id && a.stage === p.status)
        .map((a) => a.profile?.full_name)
        .filter(Boolean),
    };
  });

  // Optional single-project detail: token-overlap fuzzy match on name.
  let detail: unknown = null;
  if (wanted) {
    const tokens = wanted.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    let best: (typeof enriched)[number] | null = null;
    let bestScore = 0;
    for (const p of enriched) {
      const name = (p.name ?? "").toLowerCase();
      const score = tokens.reduce((s, t) => s + (name.includes(t) ? 1 : 0), 0);
      if (score > bestScore) { best = p; bestScore = score; }
    }
    if (best) {
      const { data: comments } = await admin
        .from("project_comments")
        .select("content, created_at, profile:profiles(full_name)")
        .eq("project_id", best.id)
        .order("created_at", { ascending: false })
        .limit(5);
      detail = {
        ...best,
        comments: ((comments ?? []) as unknown as
          { content: string; created_at: string; profile: { full_name: string } | null }[])
          .map((c) => ({
            author: c.profile?.full_name ?? "someone",
            content: c.content,
            created_at: c.created_at,
          })),
      };
    }
  }

  return json({ generated_at: new Date().toISOString(), projects: enriched, detail });
});
