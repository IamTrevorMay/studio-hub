import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const cronSecret =
      url.searchParams.get("secret") || req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET");
    if (!expectedSecret || cronSecret !== expectedSecret) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const assignmentId = body.assignment_id;
    if (!assignmentId || typeof assignmentId !== "string") {
      return jsonResponse({ error: "assignment_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: assignment, error: aErr } = await supabase
      .from("contractor_assignments")
      .select("id, title, contractor_id, status, asset_url")
      .eq("id", assignmentId)
      .single();

    if (aErr || !assignment) {
      return jsonResponse({ error: "Assignment not found" }, 404);
    }
    if (!assignment.contractor_id) {
      return jsonResponse({ skipped: "no contractor assigned" });
    }
    if (assignment.status === "completed") {
      return jsonResponse({ skipped: "assignment already completed" });
    }

    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", assignment.contractor_id)
      .single();

    if (pErr || !profile?.email) {
      return jsonResponse({ skipped: "no email on contractor profile" });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
    if (!resendKey || !fromEmail) {
      return jsonResponse(
        { error: "RESEND_API_KEY or RESEND_FROM_EMAIL not configured" },
        500,
      );
    }

    const siteUrl = Deno.env.get("SITE_URL") || "https://www.maydaystudio.app";
    const deepLink = `${siteUrl}/fl_dashboard?assignment=${encodeURIComponent(
      assignment.id,
    )}`;

    const firstName = (profile.full_name || "").split(" ")[0] || "there";
    const assetUrl = (assignment.asset_url || "").trim();
    const subject = `New assignment: ${assignment.title}`;
    const textLines = [
      `Hi ${firstName},`,
      "",
      `You have a new assignment from Mayday Studio: "${assignment.title}".`,
      "",
      `View it here: ${deepLink}`,
    ];
    if (assetUrl) {
      textLines.push("", `Asset: ${assetUrl}`);
    }
    textLines.push("", "— Mayday Studio");
    const text = textLines.join("\n");

    const assetHtml = assetUrl
      ? `<p style="margin:0 0 20px;">
      <a href="${escapeHtml(assetUrl)}" style="display:inline-block;background:rgba(99,102,241,0.12);color:#4f46e5;text-decoration:none;padding:8px 14px;border-radius:8px;font-weight:500;font-size:13px;border:1px solid rgba(99,102,241,0.3);">Open asset link</a>
    </p>`
      : "";

    const html = `
<!doctype html>
<html><body style="font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;background:#f7f7f9;padding:24px;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
    <p style="font-size:15px;margin:0 0 12px;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size:15px;margin:0 0 16px;">You have a new assignment from Mayday Studio:</p>
    <p style="font-size:18px;font-weight:600;margin:0 0 20px;">${escapeHtml(assignment.title)}</p>
    <p style="margin:0 0 16px;">
      <a href="${deepLink}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;">View assignment</a>
    </p>
    ${assetHtml}
    <p style="font-size:13px;color:#555;margin:0;">— Mayday Studio</p>
  </div>
</body></html>`.trim();

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [profile.email],
        subject,
        text,
        html,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(
        `Resend error for ${profile.email} / assignment ${assignment.id}: ${resp.status} ${errText}`,
      );
      return jsonResponse({ error: "Failed to send email", status: resp.status }, 502);
    }

    return jsonResponse({ sent: true, to: profile.email });
  } catch (err) {
    console.error("notify-fl-assignment error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
