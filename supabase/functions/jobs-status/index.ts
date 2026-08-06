// supabase/functions/jobs-status/index.ts
// Public, login-free application status lookup for the careers board. Takes a
// per-application status_token (emailed on apply) and returns a sanitized
// status snapshot. No auth — the token is the capability.
//
// Deploy: supabase functions deploy jobs-status --no-verify-jwt

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

// Applicant-facing labels for each pipeline stage.
const STAGE = {
  new: { label: "Received", note: "Your application is in and waiting for review." },
  reviewing: { label: "Under review", note: "Our team is reviewing your application." },
  interview: { label: "Interview", note: "We'd like to interview you — check your email for details." },
  accepted: { label: "Offer", note: "Great news — we've moved forward with your application." },
  declined: { label: "Closed", note: "We've decided not to move forward at this time. Thank you for applying." },
};

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

  let token = "";
  try {
    const body = await req.json();
    token = String(body.token || "").trim();
  } catch {
    return reply({ error: "Invalid JSON body" }, 400);
  }
  if (!token) return reply({ error: "Missing token" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: app } = await admin
    .from("job_applications")
    .select("applicant_name, status, created_at, interview_at, listing:job_listings(title)")
    .eq("status_token", token)
    .maybeSingle();

  if (!app) return reply({ error: "We couldn't find an application for this link." }, 404);

  const stage = STAGE[app.status as keyof typeof STAGE] || STAGE.new;
  return reply({
    ok: true,
    first_name: String(app.applicant_name || "").split(" ")[0] || "there",
    listing_title: (app as { listing?: { title?: string } }).listing?.title || "the role",
    status: app.status,
    stage_label: stage.label,
    stage_note: stage.note,
    applied_at: app.created_at,
    interview_at: app.interview_at,
  });
});
