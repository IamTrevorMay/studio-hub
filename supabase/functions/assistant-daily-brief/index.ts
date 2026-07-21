// Daily Triton pitching brief for the Mayday Assistant ("Gerald") — the title,
// standalone summary, and the content split into spoken-friendly sections
// (h2 boundaries), so the voice flow can read the summary then offer sections.
// Triton is a separate read-only Supabase project; its anon key already ships
// in the Studio web bundle, so embedding the same key here grants nothing new.
//
//   POST /functions/v1/assistant-daily-brief  { date?: "YYYY-MM-DD" }
//   → { date, title, summary, metadata, sections: [{ heading, text }] }
//
// Deploy: supabase functions deploy assistant-daily-brief --no-verify-jwt
// Env override (optional): TRITON_SUPABASE_URL / TRITON_SUPABASE_ANON_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TRITON_URL = Deno.env.get("TRITON_SUPABASE_URL")
  ?? "https://xgzxfsqwtemlcosglhzr.supabase.co";
const TRITON_KEY = Deno.env.get("TRITON_SUPABASE_ANON_KEY")
  ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhnenhmc3F3dGVtbGNvc2dsaHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MjUwMzksImV4cCI6MjA4NzIwMTAzOX0.moB9yEprm_4libfN-m9bFbKyuCcp5EhQrx0DohsuuaQ";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/** HTML → plain text for TTS (mirrors Research.js's copy-markdown chain). */
function toText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split brief HTML into sections at <h2> boundaries. */
function toSections(html: string): { heading: string; text: string }[] {
  const parts = html.split(/<h2[^>]*>/i);
  const sections: { heading: string; text: string }[] = [];
  // parts[0] is any preamble before the first h2.
  const preamble = toText(parts[0] ?? "");
  if (preamble) sections.push({ heading: "Overview", text: preamble });
  for (const part of parts.slice(1)) {
    const end = part.search(/<\/h2>/i);
    if (end < 0) continue;
    const heading = toText(part.slice(0, end));
    const text = toText(part.slice(end + 5));
    if (heading && text) sections.push({ heading, text });
  }
  return sections;
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

  let date = "";
  try {
    const body = await req.json();
    date = String(body?.date ?? "").trim();
  } catch { /* empty body → latest brief */ }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "date must be YYYY-MM-DD" }, 400);
  }

  const triton = createClient(TRITON_URL, TRITON_KEY);
  let q = triton.from("briefs").select("date, title, summary, content, metadata");
  q = date ? q.eq("date", date) : q.order("date", { ascending: false });
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "no brief found" }, 404);

  return json({
    date: data.date,
    title: data.title,
    summary: data.summary,
    metadata: data.metadata ?? {},
    sections: toSections(String(data.content ?? "")),
  });
});
