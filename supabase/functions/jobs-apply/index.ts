// supabase/functions/jobs-apply/index.ts
// Public endpoint for the careers board — submit a job application. No auth.
// Uploads an optional résumé (base64) to the private job-resumes bucket,
// inserts the application, notifies admins in-app, and emails a confirmation.
//
// Deploy: supabase functions deploy jobs-apply --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendEmail(to: string, subject: string, html: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!key || !from) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
  } catch (e) {
    console.error("Resend send failed:", (e as Error).message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Honeypot — bots fill hidden fields. Pretend success, insert nothing.
  if (body.company) return json({ ok: true });

  const name = String(body.applicant_name || "").trim();
  const email = String(body.applicant_email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim() || null;
  const coverNote = String(body.cover_note || "").trim() || null;
  const listingId = (body.listing_id as string) || null;
  const portfolio = Array.isArray(body.portfolio_links)
    ? (body.portfolio_links as string[]).map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
    : [];

  if (!name) return json({ error: "Name is required" }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "A valid email is required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rate limit: 5 submissions / hour per IP, 3 / 24h per email. Stops bot
  // floods (honeypot only catches the laziest scrapers) and Resend/storage
  // cost abuse.
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: ipCount } = await admin
    .from("public_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("bucket", "jobs_apply_ip").eq("key", ip).gte("created_at", hourAgo);
  if ((ipCount || 0) >= 5) {
    return json({ error: "Too many submissions from this network. Please try again later." }, 429);
  }
  const { count: emailCount } = await admin
    .from("public_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("bucket", "jobs_apply_email").eq("key", email).gte("created_at", dayAgo);
  if ((emailCount || 0) >= 3) {
    return json({ error: "Too many submissions for this email. Please try again later." }, 429);
  }

  // Resolve listing (must be open to accept applications)
  let listingTitle = "the role";
  if (listingId) {
    const { data: listing } = await admin
      .from("job_listings")
      .select("id, title, status")
      .eq("id", listingId)
      .single();
    if (!listing || listing.status !== "open") {
      return json({ error: "This role is no longer accepting applications" }, 400);
    }
    listingTitle = listing.title;
  }

  // Optional résumé upload (base64)
  let resumePath: string | null = null;
  const b64 = body.resume_base64 as string | undefined;
  const fileName = String(body.resume_filename || "resume").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  if (b64) {
    try {
      const raw = b64.includes(",") ? b64.split(",")[1] : b64;
      const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
      if (bytes.length > MAX_RESUME_BYTES) {
        return json({ error: "Résumé must be under 5MB" }, 400);
      }
      const path = `${listingId || "general"}/${crypto.randomUUID()}_${fileName}`;
      const { error: upErr } = await admin.storage.from("job-resumes").upload(path, bytes, {
        contentType: (body.resume_content_type as string) || "application/octet-stream",
        upsert: false,
      });
      if (upErr) console.error("Résumé upload failed:", upErr.message);
      else resumePath = path;
    } catch (e) {
      console.error("Résumé decode failed:", (e as Error).message);
    }
  }

  const { data: application, error: insErr } = await admin
    .from("job_applications")
    .insert({
      listing_id: listingId,
      applicant_name: name,
      applicant_email: email,
      phone,
      resume_path: resumePath,
      portfolio_links: portfolio,
      cover_note: coverNote,
      status: "new",
    })
    .select("id")
    .single();

  if (insErr || !application) {
    return json({ error: `Could not submit application: ${insErr?.message}` }, 500);
  }

  // Record rate-limit entries only on successful submission so failed/empty
  // attempts don't lock the legitimate user out.
  await admin.from("public_rate_limits").insert([
    { bucket: "jobs_apply_ip", key: ip },
    { bucket: "jobs_apply_email", key: email },
  ]);

  // Notify admins in-app
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
  if (admins && admins.length) {
    await admin.from("notifications").insert(
      admins.map((a) => ({
        user_id: a.id,
        type: "job_application",
        title: "New job application",
        body: `${name} applied for ${listingTitle}`,
        link_tab: "jobs",
        link_target: application.id,
        is_read: false,
      })),
    );
  }

  // Confirmation email to the applicant
  await sendEmail(
    email,
    `We received your application — ${listingTitle}`,
    `<p>Hi ${name.split(" ")[0] || "there"},</p>
     <p>Thanks for applying for <strong>${listingTitle}</strong>. We've received your application and our team will review it. If it's a fit, we'll be in touch.</p>
     <p>— The Mayday Team</p>`,
  );

  return json({ ok: true, application_id: application.id });
});
