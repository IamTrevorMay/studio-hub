// Roadmap pulse for the Mayday Assistant ("Gerald") — Business Dev phases,
// milestones, initiative counts by status, and overdue roadmap tasks. Feeds the
// weekly review's launch countdown and the "how's the roadmap?" voice skill.
//
//   POST /functions/v1/assistant-roadmap  {}
//   → { launch_target_date, phases, milestones, initiatives, counts, overdue_tasks }
//
// Deploy: supabase functions deploy assistant-roadmap --no-verify-jwt

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

  const today = new Date().toISOString().slice(0, 10);
  const [settingsQ, phasesQ, milestonesQ, initiativesQ, overdueQ, profilesQ] =
    await Promise.all([
      admin.from("bd_settings").select("launch_target_date").limit(1).maybeSingle(),
      admin.from("bd_phases").select("id, name, launch_target_date, position")
        .is("archived_at", null).order("position"),
      admin.from("bd_milestones").select("id, title, target_date, phase_id")
        .is("retired_at", null).order("target_date"),
      admin.from("bd_initiatives")
        .select("id, title, workstream, status, tag, target_date, priority, owner_id, phase_id, completed_at, updated_at")
        .order("position"),
      admin.from("bd_tasks").select("id, title, due_date, owner_id, initiative_id")
        .is("completed_at", null).not("due_date", "is", null).lt("due_date", today)
        .order("due_date").limit(25),
      admin.from("profiles").select("id, full_name"),
    ]);
  const firstError = settingsQ.error || phasesQ.error || milestonesQ.error
    || initiativesQ.error || overdueQ.error;
  if (firstError) return json({ error: firstError.message }, 500);

  const names = Object.fromEntries(
    (profilesQ.data ?? []).map((p) => [p.id, p.full_name]),
  );
  const withOwner = <T extends { owner_id: string | null }>(r: T) =>
    ({ ...r, owner: r.owner_id ? names[r.owner_id] ?? null : null });

  const initiatives = (initiativesQ.data ?? []).map(withOwner);
  const counts: Record<string, number> = {};
  for (const i of initiatives) counts[i.status] = (counts[i.status] ?? 0) + 1;

  return json({
    generated_at: new Date().toISOString(),
    launch_target_date: settingsQ.data?.launch_target_date ?? null,
    phases: phasesQ.data ?? [],
    milestones: (milestonesQ.data ?? []).map((m) => ({
      ...m, overdue: !!m.target_date && m.target_date < today,
    })),
    counts,
    initiatives,
    overdue_tasks: (overdueQ.data ?? []).map(withOwner),
  });
});
