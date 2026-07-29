import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resendSend } from "../shared/resend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Pacific-time day key. Server runs UTC; "due tomorrow" must be computed on the
// PT calendar (due_date is a PT calendar date) regardless of when the cron fires.
function ptDayString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- template map ----------

interface TemplateInput {
  assignment_title?: string;
  person_name?: string;
  message?: string;
  hours?: number;
  period?: string;
}

interface Template {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  cta: { label: string; path: string };
}

function buildTemplate(
  triggerKey: string,
  ctx: TemplateInput,
): Template {
  const title = ctx.assignment_title || "Untitled";
  const person = ctx.person_name || "Someone";
  const safeTitle = escapeHtml(title);
  const safePerson = escapeHtml(person);

  switch (triggerKey) {
    case "fl_assignment_completed":
      return {
        subject: `Assignment completed: ${title}`,
        bodyText: `${person} completed "${title}"`,
        bodyHtml: `${safePerson} completed &ldquo;${safeTitle}&rdquo;`,
        cta: { label: "View Assignment", path: "/freelancers" },
      };
    case "fl_comment":
      return {
        subject: `New comment on: ${title}`,
        bodyText: `${person} commented on "${title}"`,
        bodyHtml: `${safePerson} commented on &ldquo;${safeTitle}&rdquo;`,
        cta: { label: "View Comment", path: "/freelancers" },
      };
    case "fl_stuck": {
      const msg = ctx.message ? `: ${ctx.message}` : "";
      const safeMsg = ctx.message ? `: ${escapeHtml(ctx.message)}` : "";
      return {
        subject: `Contractor stuck: ${title}`,
        bodyText: `${person} is stuck on "${title}"${msg}`,
        bodyHtml: `${safePerson} is stuck on &ldquo;${safeTitle}&rdquo;${safeMsg}`,
        cta: { label: "View Assignment", path: "/freelancers" },
      };
    }
    case "fl_hours_submitted":
      return {
        subject: `Hours submitted by ${person}`,
        bodyText: `${person} submitted ${ctx.hours ?? 0}h for ${ctx.period ?? "unknown period"}`,
        bodyHtml: `${safePerson} submitted <strong>${ctx.hours ?? 0}h</strong> for ${escapeHtml(ctx.period ?? "unknown period")}`,
        cta: { label: "Review Hours", path: "/freelancers" },
      };
    case "fl_comment_on_mine":
      return {
        subject: `New comment on: ${title}`,
        bodyText: `${person} commented on "${title}"`,
        bodyHtml: `${safePerson} commented on &ldquo;${safeTitle}&rdquo;`,
        cta: { label: "View Assignment", path: "/fl_dashboard" },
      };
    case "fl_assignment_due_soon":
      return {
        subject: `Assignment due tomorrow: ${title}`,
        bodyText: `Your assignment "${title}" is due tomorrow`,
        bodyHtml: `Your assignment &ldquo;${safeTitle}&rdquo; is due tomorrow`,
        cta: { label: "View Assignment", path: "/fl_dashboard" },
      };
    default:
      throw new Error(`Unknown trigger_key: ${triggerKey}`);
  }
}

function renderHtml(template: Template, siteUrl: string): string {
  const ctaUrl = `${siteUrl}${template.cta.path}`;
  return `<!doctype html>
<html><body style="font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;background:#f7f7f9;padding:24px;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
    <p style="font-size:15px;margin:0 0 16px;">${template.bodyHtml}</p>
    <p style="margin:0 0 20px;">
      <a href="${ctaUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;">${escapeHtml(template.cta.label)}</a>
    </p>
    <p style="font-size:12px;color:#999;margin:0;">Manage email preferences in Mayday Studio</p>
    <p style="font-size:13px;color:#555;margin:8px 0 0;">— Mayday Studio</p>
  </div>
</body></html>`;
}

function renderText(template: Template, siteUrl: string): string {
  const ctaUrl = `${siteUrl}${template.cta.path}`;
  return `${template.bodyText}\n\n${template.cta.label}: ${ctaUrl}\n\n— Mayday Studio`;
}

// ---------- main handler ----------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
    if (!fromEmail) return json({ error: "RESEND_FROM_EMAIL not set" }, 500);

    const siteUrl = Deno.env.get("SITE_URL") || "https://www.mmcreate.io";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Cron mode ----
    if (body.cron === true) {
      const url = new URL(req.url);
      const cronSecret =
        url.searchParams.get("secret") || req.headers.get("x-cron-secret");
      const expected = Deno.env.get("CRON_SECRET");
      if (!expected || cronSecret !== expected) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (body.trigger_key === "fl_assignment_due_soon") {
        return await handleDueSoonCron(supabase, fromEmail, siteUrl);
      }
      return json({ error: "Unknown cron trigger_key" }, 400);
    }

    // ---- Single send mode (JWT auth) ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { trigger_key, recipient_id, context } = body;
    if (!trigger_key || !context) {
      return json({ error: "trigger_key and context required" }, 400);
    }

    // Handle __all_admins__ for broadcast triggers
    if (recipient_id === "__all_admins__") {
      return await handleAllAdmins(supabase, trigger_key, context, fromEmail, siteUrl);
    }

    if (!recipient_id) return json({ error: "recipient_id required" }, 400);

    // Check preference
    const { data: pref } = await supabase
      .from("email_notification_preferences")
      .select("enabled")
      .eq("user_id", recipient_id)
      .eq("trigger_key", trigger_key)
      .maybeSingle();

    if (!pref || !pref.enabled) {
      return json({ skipped: "not enabled" });
    }

    // Fetch recipient email
    const { data: recipient } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", recipient_id)
      .single();

    if (!recipient?.email) return json({ skipped: "no email" });

    const template = buildTemplate(trigger_key, context);
    await resendSend({
      from: fromEmail,
      to: recipient.email,
      subject: template.subject,
      html: renderHtml(template, siteUrl),
      text: renderText(template, siteUrl),
    });

    return json({ sent: true });
  } catch (err) {
    console.error("send-notification-email error:", err);
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

// ---------- helpers ----------

async function handleAllAdmins(
  supabase: ReturnType<typeof createClient>,
  triggerKey: string,
  context: TemplateInput,
  fromEmail: string,
  siteUrl: string,
) {
  const { data: admins } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("role", "admin");

  if (!admins?.length) return json({ sent: 0, skipped: 0 });

  let sent = 0;
  let skipped = 0;

  for (const admin of admins) {
    const { data: pref } = await supabase
      .from("email_notification_preferences")
      .select("enabled")
      .eq("user_id", admin.id)
      .eq("trigger_key", triggerKey)
      .maybeSingle();

    if (!pref || !pref.enabled) {
      skipped++;
      continue;
    }

    if (!admin.email) { skipped++; continue; }

    const template = buildTemplate(triggerKey, context);
    try {
      await resendSend({
        from: fromEmail,
        to: admin.email,
        subject: template.subject,
        html: renderHtml(template, siteUrl),
        text: renderText(template, siteUrl),
      });
      sent++;
    } catch (e) {
      console.error(`Failed to email admin ${admin.id}:`, e);
      skipped++;
    }
  }

  return json({ sent, skipped });
}

async function handleDueSoonCron(
  supabase: ReturnType<typeof createClient>,
  fromEmail: string,
  siteUrl: string,
) {
  // Find assignments due tomorrow that aren't completed
  const tomorrowStr = ptDayString(new Date(Date.now() + 86400000));

  const { data: assignments } = await supabase
    .from("contractor_assignments")
    .select("id, title, contractor_id, due_date, status")
    .eq("due_date", tomorrowStr)
    .neq("status", "completed")
    .not("contractor_id", "is", null);

  if (!assignments?.length) return json({ sent: 0, skipped: 0, reason: "no assignments due tomorrow" });

  let sent = 0;
  let skipped = 0;

  for (const a of assignments) {
    // Check contractor's preference
    const { data: pref } = await supabase
      .from("email_notification_preferences")
      .select("enabled")
      .eq("user_id", a.contractor_id)
      .eq("trigger_key", "fl_assignment_due_soon")
      .maybeSingle();

    if (!pref || !pref.enabled) { skipped++; continue; }

    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", a.contractor_id)
      .single();

    if (!profile?.email) { skipped++; continue; }

    const template = buildTemplate("fl_assignment_due_soon", { assignment_title: a.title });
    try {
      await resendSend({
        from: fromEmail,
        to: profile.email,
        subject: template.subject,
        html: renderHtml(template, siteUrl),
        text: renderText(template, siteUrl),
      });
      sent++;
    } catch (e) {
      console.error(`Due-soon email failed for assignment ${a.id}:`, e);
      skipped++;
    }
  }

  return json({ sent, skipped });
}
