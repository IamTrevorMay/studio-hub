// supabase/functions/jobs-review/index.ts
// Admin-only review actions for job applications.
//   set_status   — change pipeline status (new/reviewing/interview)
//   accept       — mark accepted, send contractor invite, start onboarding
//   decline      — mark declined, email the applicant
//   schedule_interview — create a Google Calendar event, move to interview
//   onboarding_update — persist checklist changes
//   delete_data  — permanently erase an applicant's résumé + record (GDPR)
//
// Deploy: supabase functions deploy jobs-review --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

const SITE = Deno.env.get("SITE_URL") || "https://www.mmcreate.io";

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

// deno-lint-ignore no-explicit-any
async function logEvent(admin: any, applicationId: string, e: Record<string, unknown>) {
  await admin.from("job_application_events").insert({ application_id: applicationId, ...e });
}

// Return a valid Google access token for a user, refreshing if near expiry.
// Mirrors google-calendar-fetch's getValidToken.
// deno-lint-ignore no-explicit-any
async function getGoogleToken(admin: any, userId: string): Promise<{ token: string; email: string } | null> {
  const { data: conn } = await admin
    .from("google_calendar_connections")
    .select("access_token, refresh_token, token_expires_at, google_email")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn) return null;

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 5 * 60 * 1000) {
    return { token: conn.access_token, email: conn.google_email };
  }
  // Refresh
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const tok = await res.json();
  const newExpiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
  await admin
    .from("google_calendar_connections")
    .update({ access_token: tok.access_token, token_expires_at: newExpiry, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  return { token: tok.access_token, email: conn.google_email };
}

const DEFAULT_CHECKLIST = [
  { label: "Invite accepted", done: false },
  { label: "Contract signed", done: false },
  { label: "Drive folder ready", done: false },
  { label: "Added to channels", done: false },
  { label: "First assignment", done: false },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return json({ error: "Admin only" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const action = String(body.action || "");
  const now = new Date().toISOString();

  if (action === "save_notes") {
    const id = body.application_id as string;
    const reviewer_notes = (body.reviewer_notes as string | null) ?? null;
    if (!id) return json({ error: "application_id required" }, 400);
    const { error } = await admin
      .from("job_applications")
      .update({ reviewer_notes, reviewer_id: user.id })
      .eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "set_status") {
    const id = body.application_id as string;
    const status = body.status as string;
    if (!id || !["new", "reviewing", "interview"].includes(status)) {
      return json({ error: "Invalid status" }, 400);
    }
    const { data: prev } = await admin.from("job_applications").select("status").eq("id", id).single();
    const { error } = await admin
      .from("job_applications")
      .update({ status, reviewer_id: user.id })
      .eq("id", id);
    if (error) return json({ error: error.message }, 500);
    await logEvent(admin, id, { type: "status_change", from_status: prev?.status, to_status: status, actor_id: user.id });
    return json({ ok: true, status });
  }

  if (action === "decline") {
    const id = body.application_id as string;
    if (!id) return json({ error: "application_id required" }, 400);
    const { data: app } = await admin
      .from("job_applications")
      .select("applicant_name, applicant_email, status, status_token, listing:job_listings(title)")
      .eq("id", id)
      .single();
    await admin
      .from("job_applications")
      .update({ status: "declined", reviewer_id: user.id, decided_at: now })
      .eq("id", id);
    await logEvent(admin, id, { type: "declined", from_status: app?.status, to_status: "declined", actor_id: user.id });
    if (app?.applicant_email) {
      const role = (app as { listing?: { title?: string } }).listing?.title || "the role";
      const vars = {
        first_name: escapeHtml(String(app.applicant_name || "").split(" ")[0] || "there"),
        listing_title: escapeHtml(role),
        status_url: `${SITE}/careers/status/${app.status_token || ""}`,
      };
      const { data: tpl } = await admin
        .from("job_email_templates").select("subject, body_html").eq("key", "decline").maybeSingle();
      const subject = tpl ? renderTemplate(tpl.subject, vars) : `Update on your application — ${role}`;
      const html = tpl ? renderTemplate(tpl.body_html, vars)
        : `<p>Hi ${vars.first_name},</p>
           <p>Thank you for your interest in <strong>${vars.listing_title}</strong> and for taking the time to apply. After careful review, we've decided not to move forward at this time.</p>
           <p>We genuinely appreciate it and encourage you to apply for future roles that fit.</p>
           <p>— The Mayday Team</p>`;
      await sendEmail(app.applicant_email, subject, html);
    }
    return json({ ok: true, status: "declined" });
  }

  if (action === "accept") {
    const id = body.application_id as string;
    if (!id) return json({ error: "application_id required" }, 400);
    const { data: app } = await admin
      .from("job_applications")
      .select("applicant_name, applicant_email, listing:job_listings(onboarding_checklist)")
      .eq("id", id)
      .single();
    if (!app) return json({ error: "Application not found" }, 404);
    const templateRaw = (app as { listing?: { onboarding_checklist?: Array<{ label: string }> } }).listing?.onboarding_checklist;
    const template = Array.isArray(templateRaw) && templateRaw.length
      ? templateRaw.map((c) => ({ label: String(c.label || ''), done: false })).filter((c) => c.label)
      : null;

    const { data: prevAccept } = await admin.from("job_applications").select("status").eq("id", id).single();
    await admin
      .from("job_applications")
      .update({ status: "accepted", reviewer_id: user.id, decided_at: now })
      .eq("id", id);
    await logEvent(admin, id, { type: "accepted", from_status: prevAccept?.status, to_status: "accepted", actor_id: user.id });

    // Send the contractor invite (reuses the existing onboarding flow).
    let inviteError: string | null = null;
    const { error: invErr } = await admin.auth.admin.inviteUserByEmail(app.applicant_email, {
      data: { role: "freelancer", title: app.applicant_name },
      redirectTo: Deno.env.get("SITE_URL") || "https://www.mmcreate.io",
    });
    if (invErr) inviteError = invErr.message;

    // Log the invitation (AuthPage looks this up on accept)
    let invitationId: string | null = null;
    const { data: invRow } = await admin
      .from("invitations")
      .insert({
        email: app.applicant_email.toLowerCase().trim(),
        invited_by: user.id,
        role: "freelancer",
        title: app.applicant_name,
      })
      .select("id")
      .single();
    if (invRow) invitationId = invRow.id;

    // Start the onboarding checklist (idempotent per application)
    const { data: existing } = await admin
      .from("job_onboarding")
      .select("id")
      .eq("application_id", id)
      .maybeSingle();
    if (!existing) {
      const checklist = template ?? (inviteError
        ? DEFAULT_CHECKLIST
        : DEFAULT_CHECKLIST.map((c, i) => (i === 0 ? { ...c, done: false } : c)));
      await admin.from("job_onboarding").insert({
        application_id: id,
        invitation_id: invitationId,
        checklist,
      });
    }

    return json({ ok: true, status: "accepted", invite_warning: inviteError });
  }

  if (action === "onboarding_update") {
    const onboardingId = body.onboarding_id as string;
    const checklist = body.checklist as Array<{ label: string; done: boolean }>;
    if (!onboardingId || !Array.isArray(checklist)) {
      return json({ error: "onboarding_id and checklist required" }, 400);
    }
    const allDone = checklist.length > 0 && checklist.every((c) => c.done);
    const { error } = await admin
      .from("job_onboarding")
      .update({ checklist, status: allDone ? "complete" : "in_progress", updated_at: now })
      .eq("id", onboardingId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, complete: allDone });
  }

  // Schedule an interview: create a Google Calendar event on the reviewing
  // admin's calendar (applicant invited), move status to interview, email them.
  if (action === "schedule_interview") {
    const id = body.application_id as string;
    const interviewAt = body.interview_at as string;
    const durationMin = Math.min(Math.max(parseInt(String(body.duration_min || "30"), 10) || 30, 10), 240);
    if (!id || !interviewAt) return json({ error: "application_id and interview_at required" }, 400);
    const startMs = Date.parse(interviewAt);
    if (isNaN(startMs)) return json({ error: "Invalid interview_at" }, 400);

    const { data: app } = await admin
      .from("job_applications")
      .select("applicant_name, applicant_email, status, status_token, listing:job_listings(title)")
      .eq("id", id)
      .single();
    if (!app) return json({ error: "Application not found" }, 404);

    const google = await getGoogleToken(admin, user.id);
    if (!google) {
      return json({ error: "Connect your Google Calendar in Settings before scheduling interviews." }, 400);
    }

    // Prefer an 'interview' calendar mapping, else the admin's primary calendar.
    const { data: mapping } = await admin
      .from("google_calendar_mappings")
      .select("google_calendar_id")
      .eq("user_id", user.id)
      .eq("event_type", "interview")
      .maybeSingle();
    const calendarId = mapping?.google_calendar_id || "primary";

    const role = (app as { listing?: { title?: string } }).listing?.title || "the role";
    const endIso = new Date(startMs + durationMin * 60 * 1000).toISOString();
    const event = {
      summary: `Interview — ${app.applicant_name} (${role})`,
      description: `Interview for ${role}.\nApplicant: ${app.applicant_name} <${app.applicant_email}>`,
      start: { dateTime: new Date(startMs).toISOString() },
      end: { dateTime: endIso },
      attendees: [
        { email: app.applicant_email },
        ...(google.email ? [{ email: google.email }] : []),
      ],
    };

    const gRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${google.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(event),
      },
    );
    if (!gRes.ok) {
      const errText = await gRes.text();
      console.error("Calendar insert failed:", errText);
      return json({ error: "Could not create the calendar event. Check your Google connection." }, 502);
    }
    const created = await gRes.json();

    await admin
      .from("job_applications")
      .update({
        status: "interview",
        reviewer_id: user.id,
        interview_at: new Date(startMs).toISOString(),
        interview_event_id: created.id || null,
        interview_calendar_id: calendarId,
      })
      .eq("id", id);
    await logEvent(admin, id, {
      type: "interview_scheduled",
      from_status: app.status,
      to_status: "interview",
      actor_id: user.id,
      meta: { interview_at: new Date(startMs).toISOString(), duration_min: durationMin },
    });

    // Email the applicant
    if (app.applicant_email) {
      const interviewTime = new Date(startMs).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles", dateStyle: "full", timeStyle: "short",
      });
      const vars = {
        first_name: escapeHtml(String(app.applicant_name || "").split(" ")[0] || "there"),
        listing_title: escapeHtml(role),
        interview_time: escapeHtml(`${interviewTime} PT`),
        status_url: `${SITE}/careers/status/${app.status_token || ""}`,
      };
      const { data: tpl } = await admin
        .from("job_email_templates").select("subject, body_html").eq("key", "interview").maybeSingle();
      const subject = tpl ? renderTemplate(tpl.subject, vars) : `Interview invitation — ${role}`;
      const html = tpl ? renderTemplate(tpl.body_html, vars)
        : `<p>Hi ${vars.first_name},</p>
           <p>We'd like to interview you for <strong>${vars.listing_title}</strong>, scheduled for <strong>${vars.interview_time}</strong>. A calendar invite is on its way.</p>
           <p>— The Mayday Team</p>`;
      await sendEmail(app.applicant_email, subject, html);
    }

    return json({ ok: true, status: "interview", event_id: created.id });
  }

  // GDPR/CCPA: permanently erase an applicant's data (résumé + row, cascades
  // onboarding). Used by the "Delete applicant data" admin control.
  if (action === "delete_data") {
    const id = body.application_id as string;
    if (!id) return json({ error: "application_id required" }, 400);
    const { data: app } = await admin
      .from("job_applications")
      .select("resume_path")
      .eq("id", id)
      .single();
    if (app?.resume_path) {
      const { error: rmErr } = await admin.storage.from("job-resumes").remove([app.resume_path]);
      if (rmErr) console.error("Résumé delete failed:", rmErr.message);
    }
    const { error } = await admin.from("job_applications").delete().eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, deleted: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
