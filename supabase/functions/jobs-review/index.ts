// supabase/functions/jobs-review/index.ts
// Admin-only review actions for job applications.
//   set_status   — change pipeline status (new/reviewing/interview)
//   accept       — mark accepted, send contractor invite, start onboarding
//   decline      — mark declined, email the applicant
//   onboarding_update — persist checklist changes
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
    const { error } = await admin
      .from("job_applications")
      .update({ status, reviewer_id: user.id })
      .eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status });
  }

  if (action === "decline") {
    const id = body.application_id as string;
    if (!id) return json({ error: "application_id required" }, 400);
    const { data: app } = await admin
      .from("job_applications")
      .select("applicant_name, applicant_email, listing:job_listings(title)")
      .eq("id", id)
      .single();
    await admin
      .from("job_applications")
      .update({ status: "declined", reviewer_id: user.id, decided_at: now })
      .eq("id", id);
    if (app?.applicant_email) {
      const role = (app as { listing?: { title?: string } }).listing?.title || "the role";
      const safeFirst = escapeHtml(String(app.applicant_name || "").split(" ")[0] || "there");
      const safeRole = escapeHtml(role);
      await sendEmail(
        app.applicant_email,
        `Update on your application — ${role}`,
        `<p>Hi ${safeFirst},</p>
         <p>Thank you for your interest in <strong>${safeRole}</strong> and for taking the time to apply. After careful review, we've decided not to move forward at this time.</p>
         <p>We genuinely appreciate it and encourage you to apply for future roles that fit.</p>
         <p>— The Mayday Team</p>`,
      );
    }
    return json({ ok: true, status: "declined" });
  }

  if (action === "accept") {
    const id = body.application_id as string;
    if (!id) return json({ error: "application_id required" }, 400);
    const { data: app } = await admin
      .from("job_applications")
      .select("applicant_name, applicant_email")
      .eq("id", id)
      .single();
    if (!app) return json({ error: "Application not found" }, 404);

    await admin
      .from("job_applications")
      .update({ status: "accepted", reviewer_id: user.id, decided_at: now })
      .eq("id", id);

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
      const checklist = inviteError
        ? DEFAULT_CHECKLIST
        : DEFAULT_CHECKLIST.map((c, i) => (i === 0 ? { ...c, done: false } : c));
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

  return json({ error: `Unknown action: ${action}` }, 400);
});
