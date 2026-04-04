// supabase/functions/run-report/index.ts
// Deploy with: supabase functions deploy run-report --no-verify-jwt
// Generic report runner: reads a report_config, fetches data, calls Claude, stores result.
// Invoked by cron (body={}) to run all enabled configs, or manually (body={config_id}) for one.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function resolvePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// ─── Source Handlers ─────────────────────────────────────────

interface SourceResult {
  variables: Record<string, string>;
  sourceCount: number;
}

async function fetchRssSource(
  adminClient: ReturnType<typeof createClient>,
  config: { feed_ids?: string[]; time_window_hours?: number },
): Promise<SourceResult> {
  const hours = config.time_window_hours || 48;
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);

  let query = adminClient
    .from("research_articles")
    .select("id, title, description, content, author, pub_date, feed:research_feeds(id, name, source_type)")
    .gte("pub_date", cutoff.toISOString())
    .order("pub_date", { ascending: false })
    .limit(500);

  // Filter by specific feeds if configured
  if (config.feed_ids && config.feed_ids.length > 0) {
    query = query.in("feed_id", config.feed_ids);
  }

  const { data: articles } = await query;
  if (!articles || articles.length === 0) {
    return { variables: { articles: "(No recent articles found)", feed_names: "", source_count: "0" }, sourceCount: 0 };
  }

  // Format articles list (same pattern as generate-trends)
  const lines: string[] = [];
  const feedNames = new Set<string>();
  for (const a of articles) {
    const feedName = (a as any).feed?.name || "Unknown";
    feedNames.add(feedName);
    const desc = stripHtml(a.description || a.content || "").slice(0, 400);
    lines.push(`- **${a.title || "Untitled"}** [${feedName}] ${desc}`);
  }

  return {
    variables: {
      articles: lines.join("\n"),
      feed_names: [...feedNames].join(", "),
      source_count: String(articles.length),
    },
    sourceCount: articles.length,
  };
}

async function fetchTritonSource(
  config: { endpoint?: string; method?: string; params?: string; headers?: string },
): Promise<SourceResult> {
  if (!config.endpoint) {
    return { variables: { triton_data: "(No endpoint configured)" }, sourceCount: 0 };
  }

  const method = config.method || "GET";
  const fetchOpts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  // Parse custom headers
  if (config.headers) {
    try {
      const customHeaders = JSON.parse(config.headers);
      Object.assign(fetchOpts.headers!, customHeaders);
    } catch {}
  }

  // Add body for POST
  if (method === "POST" && config.params) {
    fetchOpts.body = config.params;
  }

  // Add query params for GET
  let url = config.endpoint;
  if (method === "GET" && config.params) {
    try {
      const params = JSON.parse(config.params);
      const qs = new URLSearchParams(params).toString();
      url += (url.includes("?") ? "&" : "?") + qs;
    } catch {}
  }

  const resp = await fetch(url, fetchOpts);
  const body = await resp.text();

  return {
    variables: { triton_data: body },
    sourceCount: 1,
  };
}

async function fetchSupabaseSource(
  adminClient: ReturnType<typeof createClient>,
  config: { table?: string; select?: string; filters?: string; limit?: number; order_by?: string },
): Promise<SourceResult> {
  if (!config.table) {
    return { variables: { query_results: "(No table configured)" }, sourceCount: 0 };
  }

  let query = adminClient.from(config.table).select(config.select || "*");

  // Apply filters
  if (config.filters) {
    try {
      const filters = JSON.parse(config.filters);
      for (const f of Array.isArray(filters) ? filters : []) {
        const { column, op, value } = f;
        if (column && op) {
          (query as any) = query.filter(column, op, value);
        }
      }
    } catch {}
  }

  // Apply order
  if (config.order_by) {
    const parts = config.order_by.trim().split(/\s+/);
    const col = parts[0];
    const asc = (parts[1] || "asc").toLowerCase() !== "desc";
    query = query.order(col, { ascending: asc });
  }

  query = query.limit(config.limit || 100);

  const { data, error } = await query;
  if (error) {
    return { variables: { query_results: `(Query error: ${error.message})` }, sourceCount: 0 };
  }

  return {
    variables: {
      query_results: JSON.stringify(data, null, 2),
      source_count: String((data || []).length),
    },
    sourceCount: (data || []).length,
  };
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
          content: prompt + "\n\nIMPORTANT: Return your response as valid JSON with these fields: { \"title\": \"...\", \"summary\": \"1-2 sentence summary\", \"content\": \"full report content\" }. You may include additional fields. Only return valid JSON, no markdown code fences or extra text.",
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

  // Load internal recipients: profiles with email_reports_enabled = true
  const { data: internalRecipients } = await adminClient
    .from("profiles")
    .select("id, email")
    .eq("email_reports_enabled", true);

  // Load external subscribers: confirmed, not unsubscribed, matching this report or global
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

  if (recipients.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const reportName = config.name || report.title || "Report";
  const formattedDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const subject = `${reportName} — ${formattedDate}`;
  const html = buildEmailHtml(reportName, date, report.summary, report.content);

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    if (!recipient.email) continue;
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [recipient.email],
          subject,
          html,
        }),
      });
      if (resp.ok) {
        sent++;
      } else {
        console.error(`Resend error for ${recipient.email}: ${resp.status}`);
        failed++;
      }
    } catch (err) {
      console.error(`Email send error for ${recipient.email}:`, err);
      failed++;
    }
  }

  return { sent, failed };
}

// ─── Run a single report config ─────────────────────────────

async function runConfig(
  adminClient: ReturnType<typeof createClient>,
  config: any,
): Promise<{ success: boolean; error?: string }> {
  const today = new Date().toISOString().slice(0, 10);

  // Upsert a running status
  const { data: runRow, error: runErr } = await adminClient
    .from("report_runs")
    .upsert(
      { report_config_id: config.id, date: today, status: "running", error_message: null },
      { onConflict: "report_config_id,date" },
    )
    .select("id")
    .single();

  if (runErr) {
    return { success: false, error: `Failed to create run: ${runErr.message}` };
  }
  const runId = runRow.id;

  try {
    // Fetch data based on source type
    let result: SourceResult;
    switch (config.data_source_type) {
      case "rss":
        result = await fetchRssSource(adminClient, config.data_source_config || {});
        break;
      case "triton_api":
        result = await fetchTritonSource(config.data_source_config || {});
        break;
      case "supabase_query":
        result = await fetchSupabaseSource(adminClient, config.data_source_config || {});
        break;
      default:
        throw new Error(`Unknown source type: ${config.data_source_type}`);
    }

    // Add date variable
    result.variables.date = today;

    // Resolve prompt template
    const prompt = resolvePrompt(config.prompt_template, result.variables);
    if (!prompt || prompt.length < 10) {
      throw new Error("Prompt template is empty or too short after variable substitution");
    }

    // Call Claude
    const report = await callClaude(prompt);

    // Update run with results
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

    // Send email if delivery.email is enabled
    let emailResult = { sent: 0, failed: 0 };
    if (config.delivery?.email) {
      emailResult = await sendReportEmail(adminClient, config, report, today);
    }

    return { success: true, emailsSent: emailResult.sent, emailsFailed: emailResult.failed };
  } catch (err: any) {
    // Mark as failed
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

  // Auth: cron secret or user bearer token
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

  if (!authenticated) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Parse body
  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  // Single config run (manual trigger)
  if (body.config_id) {
    const { data: config, error } = await adminClient
      .from("report_configs")
      .select("*")
      .eq("id", body.config_id)
      .single();

    if (error || !config) {
      return jsonResp({ error: "Config not found" }, 404);
    }

    const result = await runConfig(adminClient, config);
    return jsonResp(result, result.success ? 200 : 500);
  }

  // Cron run: execute all enabled configs
  const { data: configs, error: configsErr } = await adminClient
    .from("report_configs")
    .select("*")
    .eq("enabled", true);

  if (configsErr || !configs) {
    return jsonResp({ error: "Failed to load configs" }, 500);
  }

  if (configs.length === 0) {
    return jsonResp({ message: "No enabled report configs", ran: 0 });
  }

  const results: { configId: string; name: string; success: boolean; error?: string }[] = [];

  for (const config of configs) {
    const result = await runConfig(adminClient, config);
    results.push({ configId: config.id, name: config.name, ...result });
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return jsonResp({ ran: results.length, succeeded, failed, results });
});
