// archive-published-cards
// Daily cron. Archives Publish-column cards whose updated_at is older than
// 7 days. A card published today stays visible for a full week; on day 8
// it archives.
//
// Auth: x-cron-secret header OR ?secret= query param, matching CRON_SECRET.
// Schedule (UTC): every day at 08:00 (= 00:00 PST / 01:00 PDT).
// Deploy: supabase functions deploy archive-published-cards --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, content-type",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  // Auth via CRON_SECRET.
  const url = new URL(req.url);
  const provided = req.headers.get("x-cron-secret") || url.searchParams.get("secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || provided !== expected) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const admin = getAdminClient();
  const cutoffIso = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // Find candidates: typed projects, status=publish, not yet archived, last touched >7d ago.
  const { data: candidates, error: selectErr } = await admin
    .from("projects")
    .select("id, name, updated_at")
    .eq("status", "publish")
    .is("archived_at", null)
    .not("type", "is", null)
    .lt("updated_at", cutoffIso);

  if (selectErr) {
    return jsonResp({ error: `Select failed: ${selectErr.message}` }, 500);
  }

  if (!candidates || candidates.length === 0) {
    return jsonResp({ cutoff: cutoffIso, archived: 0, ids: [] });
  }

  const ids = candidates.map((c) => c.id);
  const nowIso = new Date().toISOString();
  const { error: updErr } = await admin
    .from("projects")
    .update({ archived_at: nowIso })
    .in("id", ids);

  if (updErr) {
    return jsonResp({ error: `Update failed: ${updErr.message}` }, 500);
  }

  return jsonResp({ cutoff: cutoffIso, archived: ids.length, ids });
});
