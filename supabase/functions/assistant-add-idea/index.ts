// Add a video idea to the Ideas board on behalf of the (admin) caller — the
// Mayday Assistant's "add video idea" action. The group (category) is REQUIRED:
// Gerald asks which board column before calling. Lands at the bottom of that
// column, exactly like the Ideas page's own add flow.
//
//   POST /functions/v1/assistant-add-idea
//   { text: string, category: "mayday_videos"|"tm_baseball_videos"|
//     "short_form_only"|"podcast_only", context?: string }
//   → { id }
//
// Deploy: supabase functions deploy assistant-add-idea --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CATEGORIES = new Set([
  "mayday_videos", "tm_baseball_videos", "short_form_only", "podcast_only",
]);

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

  let text = "", category = "", context = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").trim();
    category = String(body?.category ?? "").trim();
    context = String(body?.context ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!text || text.length > 500) return json({ error: "text required (≤500 chars)" }, 400);
  if (!CATEGORIES.has(category)) {
    return json({ error: `category must be one of: ${[...CATEGORIES].join(", ")}` }, 400);
  }

  const { data: last } = await admin
    .from("write_ideas").select("position")
    .eq("category", category)
    .order("position", { ascending: false }).limit(1).maybeSingle();

  const { data, error } = await admin
    .from("write_ideas")
    .insert({
      text,
      category,
      context: context || null,
      checked: false,
      position: (last?.position ?? 0) + 1,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ id: data.id });
});
