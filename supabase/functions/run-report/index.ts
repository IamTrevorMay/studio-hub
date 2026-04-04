// supabase/functions/run-report/index.ts
// Deploy with: supabase functions deploy run-report --no-verify-jwt
// Generic report runner: reads a report_config, fetches data, calls Claude, stores result.
// Supports multi-source configs (data_sources array) with legacy single-source fallback.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fetchAllSources,
  fetchRssSource,
  fetchTritonSource,
  fetchSupabaseSource,
  resolvePrompt,
  type SourceResult,
} from "../shared/report-sources.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Claude API Call ─────────────────────────────────────────

async function callClaude(prompt: string): Promise<{ title: string; summary: string; content: string; metadata: Record<string, unknown> }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: prompt + "\n\nIMPORTANT: Return your response as valid JSON with these fields: { \"title\": \"...\", \"summary\": \"1-2 sentence summary\", \"content\": \"full report content as HTML\" }. You may include additional fields. Only return valid JSON, no markdown code fences or extra text.",
        }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Claude API ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data = await resp.json();
    const rawText = data.content?.[0]?.text || "";
    const jsonStr = rawText
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(jsonStr);
    return {
      title: parsed.title || "Untitled Report",
      summary: parsed.summary || "",
      content: parsed.content || jsonStr,
      metadata: (() => {
        const { title, summary, content, ...rest } = parsed;
        return rest;
      })(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Email Delivery via Resend ───────────────────────────────

function buildEmailHtml(reportName: string, date: string, summary: string, content: string): string {
  const formattedDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:32px 24px;">
    <div style="background:#1a1a2e;border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:24px 28px;">
        <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">${reportName}</h1>
        <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.7);">${formattedDate}</p>
      </div>
      ${summary ? `<div style="padding:20px 28px 0;font-size:14px;color:rgba(255,255,255,0.6);line-height:1.5;font-style:italic;">${summary}</div>` : ""}
      <div style="padding:24px 28px;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.7;">
        ${content}
      </div>
    </div>
    <div style="text-align:center;padding:20px 0;font-size:11px;color:rgba(255,255,255,0.2);">
      Powered by Mayday Studio
    </div>
  </div>
</body>
</html>`;
}

async function sendReportEmail(
  adminClient: ReturnType<typeof createClient>,
  config: any,
  report: { title: string; summary: string; content: string },
  date: string,
): Promise<{ sent: number; failed: number }> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  if (!resendKey || !fromEmail) {
    console.warn("RESEND_API_KEY or RESEND_FROM_EMAIL not configured, skipping email delivery");
    return { sent: 0, failed: 0 };
  }

  // Load internal recipients
  const { data: internalRecipients } = await adminClient
    .from("profiles")
    .select("id, email")
    .eq("email_reports_enabled", true);

  // Load external subscribers
  const { data: externalSubscribers } = await adminClient
    .from("newsletter_subscribers")
    .select("id, email, name")
    .eq("confirmed", true)
    .is("unsubscribed_at", null)
    .or(`report_config_id.eq.${config.id},report_config_id.is.null`);

  // Deduplicate by email
  const emailSet = new Set<string>();
  const recipients: { email: string }[] = [];
  for (const r of [...(internalRecipients || []), ...(externalSubscribers || [])]) {
    if (!r.email) continue;
    const lower = r.email.toLowerCase();
    if (emailSet.has(lower)) continue;
    emailSet.add(lower);
    recipients.push({ email: r.email });
  }

  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const reportName = config.name || report.title || "Report";
  const formattedDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const subject = `${reportName} — ${formattedDate}`;
  const html = buildEmailHtml(reportName, date, report.summary, report.content);

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: fromEmail, to: [recipient.email], subject, html }),
      });
      if (resp.ok) sent++;
      else { console.error(`Resend error for ${recipient.email}: ${resp.status}`); failed++; }
    } catch (err) {
      console.error(`Email send error for ${recipient.email}:`, err);
      failed++;
    }
  }

  return { sent, failed };
}

// ─── Fetch sources (multi-source with legacy fallback) ───────

async function getSourceData(
  adminClient: ReturnType<typeof createClient>,
  config: any,
): Promise<SourceResult> {
  // Multi-source (new format)
  if (config.data_sources && Array.isArray(config.data_sources) && config.data_sources.length > 0) {
    return fetchAllSources(adminClient, config.data_sources);
  }

  // Legacy single-source fallback
  switch (config.data_source_type) {
    case "rss":
      return fetchRssSource(adminClient, config.data_source_config || {});
    case "triton_api":
      return fetchTritonSource(config.data_source_config || {});
    case "supabase_query":
      return fetchSupabaseSource(adminClient, config.data_source_config || {});
    default:
      throw new Error(`Unknown source type: ${config.data_source_type}`);
  }
}

// ─── Run a single report config ─────────────────────────────

async function runConfig(
  adminClient: ReturnType<typeof createClient>,
  config: any,
): Promise<{ success: boolean; error?: string; emailsSent?: number; emailsFailed?: number }> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: runRow, error: runErr } = await adminClient
    .from("report_runs")
    .upsert(
      { report_config_id: config.id, date: today, status: "running", error_message: null },
      { onConflict: "report_config_id,date" },
    )
    .select("id")
    .single();

  if (runErr) return { success: false, error: `Failed to create run: ${runErr.message}` };
  const runId = runRow.id;

  try {
    const result = await getSourceData(adminClient, config);
    result.variables.date = today;

    const prompt = resolvePrompt(config.prompt_template, result.variables);
    if (!prompt || prompt.length < 10) {
      throw new Error("Prompt template is empty or too short after variable substitution");
    }

    const report = await callClaude(prompt);

    await adminClient
      .from("report_runs")
      .update({
        status: "completed",
        title: report.title,
        summary: report.summary,
        content: report.content,
        source_count: result.sourceCount,
        metadata: report.metadata,
      })
      .eq("id", runId);

    let emailResult = { sent: 0, failed: 0 };
    if (config.delivery?.email) {
      emailResult = await sendReportEmail(adminClient, config, report, today);
    }

    return { success: true, emailsSent: emailResult.sent, emailsFailed: emailResult.failed };
  } catch (err: any) {
    await adminClient
      .from("report_runs")
      .update({ status: "failed", error_message: err.message || String(err) })
      .eq("id", runId);
    return { success: false, error: err.message || String(err) };
  }
}

// ─── Main Handler ────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const cronSecret = url.searchParams.get("secret") || req.headers.get("x-cron-secret");
  const expectedSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");

  let authenticated = false;
  if (expectedSecret && cronSecret === expectedSecret) {
    authenticated = true;
  } else if (authHeader) {
    try {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (user) authenticated = true;
    } catch {}
  }

  if (!authenticated) return jsonResp({ error: "Unauthorized" }, 401);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch {}

  // Single config run
  if (body.config_id) {
    const { data: config, error } = await adminClient
      .from("report_configs")
      .select("*")
      .eq("id", body.config_id)
      .single();
    if (error || !config) return jsonResp({ error: "Config not found" }, 404);
    const result = await runConfig(adminClient, config);
    return jsonResp(result, result.success ? 200 : 500);
  }

  // Cron: run all enabled configs
  const { data: configs, error: configsErr } = await adminClient
    .from("report_configs")
    .select("*")
    .eq("enabled", true);

  if (configsErr || !configs) return jsonResp({ error: "Failed to load configs" }, 500);
  if (configs.length === 0) return jsonResp({ message: "No enabled report configs", ran: 0 });

  const results: { configId: string; name: string; success: boolean; error?: string }[] = [];
  for (const config of configs) {
    const result = await runConfig(adminClient, config);
    results.push({ configId: config.id, name: config.name, ...result });
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  return jsonResp({ ran: results.length, succeeded, failed, results });
});
