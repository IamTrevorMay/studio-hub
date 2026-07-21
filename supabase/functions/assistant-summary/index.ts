// Read-only admin snapshot for the Mayday Assistant ("Gerald") at
// assist.mmcreate.io. Returns active projects, the caller's current
// sprint (goals + points), upcoming deliverable/task deadlines, and
// calendar events within a 14-day window.
//
//   POST /functions/v1/assistant-summary  {}
//
// Response mirrors Mayday-Assist web/lib/studioTypes.ts — keep in sync.
//
// V1 gap: recurring calendar events are expanded client-side in Studio
// (Calendar.js recurrence_rule), so occurrences whose base row falls
// outside the window are missed here.
//
// Deploy: supabase functions deploy assistant-summary --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS is restricted to the assistant origins (unlike the shared "*"
// headers) because this function aggregates admin-level data.
const ALLOWED_ORIGINS = new Set([
  "https://assist.mmcreate.io",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3100",
]);

function cors(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://assist.mmcreate.io",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function resp(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

const WINDOW_DAYS = 14;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return resp(req, { error: "Method not allowed" }, 405);

  // Self-contained auth (same contract as shared/workflow-engine.getUserFromJwt):
  // valid session JWT + profiles.role === 'admin'. Inlined 2026-07-20 so the
  // function deploys standalone, without the workflow-engine dependency chain.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return resp(req, { error: "Unauthorized" }, 401);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return resp(req, { error: "Unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: callerProfile } = await admin
    .from("profiles").select("role").eq("id", user.id).single();
  if (callerProfile?.role !== "admin") return resp(req, { error: "Admin only" }, 403);
  const auth = { userId: user.id };
  const now = new Date();
  const nowIso = now.toISOString();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + WINDOW_DAYS);
  const horizonStr = horizon.toISOString().slice(0, 10); // date columns (YYYY-MM-DD)
  const horizonIso = horizon.toISOString(); // timestamp columns

  try {
    // No lower bound on due dates: overdue items are exactly what an
    // assistant should surface. The horizon caps volume ahead.
    const [projectsQ, sprintQ, deliverablesQ, tasksQ, eventsQ, inboxQ] = await Promise.all([
      admin.from("projects")
        .select("id, name, status, deadline")
        .eq("is_archived", false)
        .neq("status", "publish")
        .order("deadline", { ascending: true, nullsFirst: false }),
      admin.from("sprints")
        .select("id, start_date, end_date, status, velocity")
        .eq("user_id", auth.userId)
        .eq("status", "active")
        .maybeSingle(),
      admin.from("sponsor_deliverables")
        .select("id, title, status, due_date, deliverable_type, sponsors(name), sponsor_campaigns(name)")
        .neq("status", "posted")
        // Delivered is a separate flag from the status pipeline — a delivered
        // deliverable must drop out of the snapshot so Gerald clears its task.
        // not-is-true (vs neq true) keeps rows where delivered is null.
        .not("delivered", "is", true)
        .not("due_date", "is", null)
        .lte("due_date", horizonStr)
        .order("due_date", { ascending: true })
        .limit(25),
      admin.from("personal_tasks")
        .select("id, content, status, due_date, priority")
        .eq("created_by", auth.userId)
        .not("status", "in", "(done,archived)")
        .not("due_date", "is", null)
        .lte("due_date", horizonStr)
        .order("due_date", { ascending: true })
        .limit(25),
      admin.from("calendar_events")
        .select("id, title, start_date, end_date, all_day, event_type")
        .gte("start_date", nowIso)
        .lte("start_date", horizonIso)
        .order("start_date", { ascending: true })
        .limit(25),
      // Inbox/backlog cards (2026-07-20): unsorted work with NO due date —
      // the due-date task query above can never see these.
      admin.from("personal_tasks")
        .select("id, content, status, category, priority, due_date")
        .eq("created_by", auth.userId)
        .in("status", ["inbox", "backlog"])
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    const firstError = projectsQ.error || sprintQ.error || deliverablesQ.error
      || tasksQ.error || eventsQ.error || inboxQ.error;
    if (firstError) throw firstError;

    let sprint = null;
    if (sprintQ.data) {
      const [goalsQ, ptsQ] = await Promise.all([
        admin.from("sprint_goals")
          .select("text, is_complete, position")
          .eq("sprint_id", sprintQ.data.id)
          .order("position"),
        admin.from("personal_tasks")
          .select("status, priority")
          .eq("sprint_id", sprintQ.data.id),
      ]);
      const pts = (t: { priority: string | null }) => parseInt(t.priority ?? "") || 0;
      const rows = ptsQ.data ?? [];
      sprint = {
        ...sprintQ.data,
        goals: goalsQ.data ?? [],
        points: {
          total: rows.reduce((s, t) => s + pts(t), 0),
          completed: rows
            .filter((t) => t.status === "done" || t.status === "archived")
            .reduce((s, t) => s + pts(t), 0),
        },
      };
    }

    type DeliverableRow = {
      id: string; title: string; status: string; due_date: string;
      deliverable_type: string | null;
      sponsors: { name: string } | null;
      sponsor_campaigns: { name: string } | null;
    };

    return resp(req, {
      generated_at: nowIso,
      window_days: WINDOW_DAYS,
      projects: projectsQ.data ?? [],
      sprint,
      deliverables: ((deliverablesQ.data ?? []) as unknown as DeliverableRow[]).map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        due_date: d.due_date,
        deliverable_type: d.deliverable_type,
        sponsor: d.sponsors?.name ?? null,
        campaign: d.sponsor_campaigns?.name ?? null,
      })),
      tasks: tasksQ.data ?? [],
      inbox_backlog: inboxQ.data ?? [],
      events: eventsQ.data ?? [],
    });
  } catch (err) {
    console.error("assistant-summary error:", err);
    return resp(req, { error: "Internal error" }, 500);
  }
});
