// Complete a sprint task or sprint goal on behalf of the (admin) caller — the
// Mayday Assistant's write-back when Trevor closes a Studio-sourced item there.
// Deliverables and project deadlines are intentionally NOT writable: they move
// through Studio's own production pipeline.
//
//   POST /functions/v1/assistant-complete
//   { kind: "task", id: "<personal_tasks.id>" }
//   { kind: "goal", sprint_id: "<sprints.id>", position: <int> }
//
// Deploy: supabase functions deploy assistant-complete --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getUserFromJwt, getAdminClient } from "../shared/workflow-engine.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await getUserFromJwt(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  // Strict admin: this endpoint was admin-only before isAdmin became
  // admin-tier, and directors are not meant to reach it.
  if (!auth.isStrictAdmin) return json({ error: "Admin only" }, 403);

  let kind = "", id = "", sprintId = "", position = -1;
  try {
    const body = await req.json();
    kind = String(body?.kind ?? "");
    id = String(body?.id ?? "");
    sprintId = String(body?.sprint_id ?? "");
    position = Number(body?.position ?? -1);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const admin = getAdminClient();
  try {
    if (kind === "task" && id) {
      // Only the caller's own tasks — the assistant acts as Trevor, not the team.
      const { data, error } = await admin
        .from("personal_tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", id)
        .eq("created_by", auth.userId)
        .neq("status", "done")
        .select("id");
      if (error) throw error;
      return json({ ok: true, updated: data?.length ?? 0 });
    }
    if (kind === "goal" && sprintId && position >= 0) {
      const { data: sprint } = await admin
        .from("sprints").select("id").eq("id", sprintId).eq("user_id", auth.userId).limit(1);
      if (!sprint?.length) return json({ error: "Not your sprint" }, 403);
      const { data, error } = await admin
        .from("sprint_goals")
        .update({ is_complete: true })
        .eq("sprint_id", sprintId)
        .eq("position", position)
        .select("id");
      if (error) throw error;
      return json({ ok: true, updated: data?.length ?? 0 });
    }
    return json({ error: "kind must be task (id) or goal (sprint_id + position)" }, 400);
  } catch (err) {
    console.error("assistant-complete error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
