// supabase/functions/jobs-view/index.ts
// Public, login-free view beacon for the careers board. Records a page view of
// a job listing for funnel analytics. No auth.
//
// Deploy: supabase functions deploy jobs-view --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
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
  await admin.from("job_listing_views").insert({ listing_id: listingId, slug });
  return reply({ ok: true });
});
