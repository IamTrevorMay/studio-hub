// supabase/functions/jobs-apply/index.ts
// Public endpoint for the careers board — submit a job application. No auth.
// Uploads an optional résumé (base64) to the private job-resumes bucket,
// inserts the application, notifies admins in-app, and emails a confirmation.
//
// Abuse controls: honeypot, per-IP/email rate limit, Cloudflare Turnstile
// (fails closed unless TURNSTILE_SECRET is set or a dev bypass is enabled),
// duplicate guard, and résumé magic-byte validation. Applicant consent is
// required and recorded.
//
// Deploy: supabase functions deploy jobs-apply --no-verify-jwt

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
const CONSENT_VERSION = Deno.env.get("JOBS_CONSENT_VERSION") || "2026-06";
const SITE = Deno.env.get("SITE_URL") || "https://www.maydaystudio.app";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

// Fill {{vars}} in a template string.
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

// Cloudflare Turnstile. Fails CLOSED when no secret is configured — the only
// bypass is an explicit dev opt-out (ENVIRONMENT=dev or TURNSTILE_DISABLED=true)
// so production never silently skips bot protection.
async function verifyTurnstile(
  token: string | undefined,
  ip: string,
): Promise<"ok" | "fail" | "unconfigured"> {
  const secret = Deno.env.get("TURNSTILE_SECRET");
  if (!secret) {
    const devBypass = Deno.env.get("ENVIRONMENT") === "dev"
      || Deno.env.get("TURNSTILE_DISABLED") === "true";
    return devBypass ? "ok" : "unconfigured";
  }
  if (!token) return "fail";
  try {
    const form = new URLSearchParams({ secret, response: token, remoteip: ip });
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const out = await r.json();
    if (!out.success) console.error("Turnstile rejected:", JSON.stringify(out["error-codes"] || out));
    return out.success ? "ok" : "fail";
  } catch (e) {
    console.error("Turnstile verify failed:", (e as Error).message);
    return "fail";
  }
}

// Sniff the first bytes to confirm an uploaded résumé really is a PDF / DOC /
// DOCX, not a renamed script or image.
function looksLikeDocument(bytes: Uint8Array): boolean {
  const hex = (n: number) => bytes[n];
  // %PDF
  if (hex(0) === 0x25 && hex(1) === 0x50 && hex(2) === 0x44 && hex(3) === 0x46) return true;
  // PK.. (zip → docx/odt)
  if (hex(0) === 0x50 && hex(1) === 0x4b && (hex(2) === 0x03 || hex(2) === 0x05 || hex(2) === 0x07)) return true;
  // OLE compound (legacy .doc): D0 CF 11 E0
  if (hex(0) === 0xd0 && hex(1) === 0xcf && hex(2) === 0x11 && hex(3) === 0xe0) return true;
  return false;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid JSON body" }, 400);
  }

  // Honeypot — bots fill hidden fields. Pretend success, insert nothing.
  if (body.company) return reply({ ok: true });

  const name = String(body.applicant_name || "").trim();
  const email = String(body.applicant_email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim() || null;
  const coverNote = String(body.cover_note || "").trim() || null;
  const listingId = (body.listing_id as string) || null;
  const consent = body.consent === true || body.consent === "true";
  const portfolio = Array.isArray(body.portfolio_links)
    ? (body.portfolio_links as string[]).map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
    : [];
  const answers = Array.isArray(body.answers)
    ? (body.answers as Array<{ question?: string; answer?: string }>)
        .map((x) => ({ question: String(x.question || "").slice(0, 300), answer: String(x.answer || "").slice(0, 2000) }))
        .filter((x) => x.question)
        .slice(0, 30)
    : [];

  if (!name) return reply({ error: "Name is required" }, 400);
  if (!EMAIL_RE.test(email)) return reply({ error: "A valid email is required" }, 400);
  if (!consent) return reply({ error: "Please accept the data-storage consent to apply." }, 400);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";

  // Bot challenge — fails closed if not configured (except explicit dev bypass).
  const turnstile = await verifyTurnstile(body.turnstile_token as string | undefined, ip);
  if (turnstile === "unconfigured") {
    console.error("Turnstile secret missing — rejecting application (captcha not configured).");
    return reply({ error: "Applications are temporarily unavailable. Please try again later." }, 503);
  }
  if (turnstile === "fail") {
    return reply({ error: "Verification failed. Please retry the challenge." }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rate limit: 5 submissions / hour per IP, 3 / 24h per email.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: ipCount } = await admin
    .from("public_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("bucket", "jobs_apply_ip").eq("key", ip).gte("created_at", hourAgo);
  if ((ipCount || 0) >= 5) {
    return reply({ error: "Too many submissions from this network. Please try again later." }, 429);
  }
  const { count: emailCount } = await admin
    .from("public_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("bucket", "jobs_apply_email").eq("key", email).gte("created_at", dayAgo);
  if ((emailCount || 0) >= 3) {
    return reply({ error: "Too many submissions for this email. Please try again later." }, 429);
  }

  // Resolve listing (must be open to accept applications)
  let listingTitle = "the role";
  // Recipients chosen on the listing. Empty (or a general application with no
  // listing) falls back to every admin, the pre-existing behavior.
  let notifyUserIds: string[] = [];
  if (listingId) {
    const { data: listing } = await admin
      .from("job_listings")
      .select("id, title, status, notify_user_ids")
      .eq("id", listingId)
      .single();
    if (!listing || listing.status !== "open") {
      return reply({ error: "This role is no longer accepting applications" }, 400);
    }
    listingTitle = listing.title;
    notifyUserIds = Array.isArray(listing.notify_user_ids) ? listing.notify_user_ids : [];
  }

  // Duplicate guard — one application per (listing, email). Idempotent: report
  // success without inserting again or re-uploading a résumé.
  if (listingId) {
    const { data: dupe } = await admin
      .from("job_applications")
      .select("id")
      .eq("listing_id", listingId)
      .eq("applicant_email", email)
      .limit(1)
      .maybeSingle();
    if (dupe) return reply({ ok: true, duplicate: true });
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
        return reply({ error: "Résumé must be under 5MB" }, 400);
      }
      if (!looksLikeDocument(bytes)) {
        return reply({ error: "Résumé must be a PDF, DOC, or DOCX file." }, 400);
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

  const statusToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
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
      answers,
      status: "new",
      status_token: statusToken,
      consent_at: new Date().toISOString(),
      consent_version: CONSENT_VERSION,
    })
    .select("id")
    .single();

  if (insErr || !application) {
    return reply({ error: `Could not submit application: ${insErr?.message}` }, 500);
  }

  // Audit trail
  await admin.from("job_application_events").insert({
    application_id: application.id,
    type: "created",
    to_status: "new",
  });

  // Record rate-limit entries only on successful submission so failed/empty
  // attempts don't lock the legitimate user out.
  await admin.from("public_rate_limits").insert([
    { bucket: "jobs_apply_ip", key: ip },
    { bucket: "jobs_apply_email", key: email },
  ]);

  // Notify in-app: the listing's chosen recipients, else every admin. Chosen
  // ids are re-checked against admin-tier roles so a demoted or deleted user
  // silently drops out instead of accruing notifications they can't open.
  let recipients: Array<{ id: string }> = [];
  if (notifyUserIds.length) {
    const { data: picked } = await admin
      .from("profiles")
      .select("id")
      .in("id", notifyUserIds)
      .in("role", ["admin", "director", "director_creative", "director_comms"]);
    recipients = picked || [];
  }
  if (!recipients.length) {
    const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
    recipients = admins || [];
  }
  if (recipients.length) {
    await admin.from("notifications").insert(
      recipients.map((a) => ({
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

  // Confirmation email to the applicant — uses the editable template if present.
  const statusUrl = `${SITE}/careers/status/${statusToken}`;
  const vars = {
    first_name: escapeHtml(name.split(" ")[0] || "there"),
    listing_title: escapeHtml(listingTitle),
    status_url: statusUrl,
  };
  const { data: tpl } = await admin
    .from("job_email_templates")
    .select("subject, body_html")
    .eq("key", "confirmation")
    .maybeSingle();
  const subject = tpl ? renderTemplate(tpl.subject, vars) : `We received your application — ${listingTitle}`;
  const html = tpl
    ? renderTemplate(tpl.body_html, vars)
    : `<p>Hi ${vars.first_name},</p>
       <p>Thanks for applying for <strong>${vars.listing_title}</strong>. We've received your application and our team will review it. If it's a fit, we'll be in touch.</p>
       <p>Check your status anytime: <a href="${statusUrl}">${statusUrl}</a></p>
       <p>— The Mayday Team</p>`;
  await sendEmail(email, subject, html);

  return reply({ ok: true, application_id: application.id, status_token: statusToken });
});
