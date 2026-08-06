// supabase/functions/jobs-view/index.ts
// Public, login-free view beacon for the careers board. Records a page view of
// a job listing for funnel analytics. No auth.
//
// Deploy: supabase functions deploy jobs-view --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://maydaystudio.app",
  "https://www.maydaystudio.app",
  // Legacy domain — still 301s to maydaystudio.app, kept until the redirect retires.
  "https://mmcreate.io",
  "https://www.mmcreate.io",
  "http://localhost:3000",
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  let listingId: string | null = null;
  let slug: string | null = null;
  try {
    const body = await req.json();
    listingId = (body.listing_id as string) || null;
    slug = body.slug ? String(body.slug).slice(0, 200) : null;
  } catch {
    return reply({ ok: true }); // never block the page on a bad beacon
  }
  if (!listingId && !slug) return reply({ ok: true });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Coarse viewer hash (IP + UA) for soft dedup — skip if this viewer already
  // logged this listing in the last 30 min. Limits scriptable analytics bloat.
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ua = req.headers.get("user-agent") || "";
  let viewerHash: string | null = null;
  if (ip) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${ua}`));
    viewerHash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);

    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    let q = admin.from("job_listing_views").select("id", { count: "exact", head: true })
      .eq("viewer_hash", viewerHash).gte("created_at", since);
    q = listingId ? q.eq("listing_id", listingId) : q.eq("slug", slug);
    const { count } = await q;
    if (count && count > 0) return reply({ ok: true, deduped: true });
  }

  await admin.from("job_listing_views").insert({ listing_id: listingId, slug, viewer_hash: viewerHash });
  return reply({ ok: true });
});
