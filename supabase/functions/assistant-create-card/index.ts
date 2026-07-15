// Create a sprint/personal task card on behalf of the (admin) caller — the
// Mayday Assistant's "make it a Sprint card" action from Gerald (V6 Phase 4).
// Inserts into personal_tasks as the caller; the card lands in the inbox column
// and flows through Studio's own board from there.
//
//   POST /functions/v1/assistant-create-card
//   { title: string, detail?: string, due_date?: "YYYY-MM-DD",
//     category?: string, priority?: "1"|"3"|"6"|"10"|"15" }
//   → { id }
//
// Deploy: supabase functions deploy assistant-create-card --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CATEGORIES = new Set([
  "administration", "communication", "creative", "production",
  "business_development", "software", "ad", "social",
]);
const PRIORITIES = new Set(["1", "3", "6", "10", "15"]);

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

  // Self-contained auth (same contract as shared/workflow-engine.getUserFromJwt):
  // valid session JWT + profiles.role === 'admin'.
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

  let title = "", detail = "", dueDate = "", category = "", priority = "";
  try {
    const body = await req.json();
    title = String(body?.title ?? "").trim();
    detail = String(body?.detail ?? "").trim();
    dueDate = String(body?.due_date ?? "").trim();
    category = String(body?.category ?? "").trim();
    priority = String(body?.priority ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!title || title.length > 300) return json({ error: "title required" }, 400);
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return json({ error: "due_date must be YYYY-MM-DD" }, 400);
  }

  const { data, error } = await admin
    .from("personal_tasks")
    .insert({
      created_by: user.id,
      content: detail ? `${title} — ${detail}`.slice(0, 500) : title,
      status: "inbox",
      due_date: dueDate || null,
      category: CATEGORIES.has(category) ? category : "administration",
      priority: PRIORITIES.has(priority) ? priority : null,
    })
    .select("id")
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ id: data.id });
});
