// supabase/functions/run-report/index.ts
// Deploy with: supabase functions deploy run-report --no-verify-jwt
// Section-based report runner: composes a report by rendering each section's
// own data source and prompt/template, then concatenates the HTML.
// Supports canvas-based reports (visual newsletter builder).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fetchAllSources,
  fetchRssSource,
  fetchTritonSource,
  fetchSupabaseSource,
  fetchSectionSource,
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

// ─── Claude call for a single section ────────────────────────

async function runSectionPrompt(prompt: string): Promise<string> {
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
        model: Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: prompt + "\n\nReturn only the HTML fragment for this report section (no <html>, <head>, or <body> tags, no markdown code fences, no commentary). Use inline styles.",
        }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Claude API ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data = await resp.json();
    const raw = (data.content?.[0]?.text || "").trim();
    return raw.replace(/^```html?\s*/i, "").replace(/\s*```$/i, "").trim();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Render a single section ─────────────────────────────────

async function renderSection(
  adminClient: ReturnType<typeof createClient>,
  section: any,
  date: string,
): Promise<{ html: string; sourceCount: number }> {
  const source = section.data_source || { type: "none", config: {} };
  const result: SourceResult = await fetchSectionSource(adminClient, source);
  result.variables.date = date;
  result.variables.section_name = section.name || "";

  // Prompt mode: send data through Claude
  if (section.prompt_template && section.prompt_template.trim().length > 0) {
    const prompt = resolvePrompt(section.prompt_template, result.variables);
    const html = await runSectionPrompt(prompt);
    return { html, sourceCount: result.sourceCount };
  }

  // Passthrough mode: fill variables into render_template
  if (section.render_template && section.render_template.trim().length > 0) {
    const html = resolvePrompt(section.render_template, result.variables);
    return { html, sourceCount: result.sourceCount };
  }

  // Neither: drop in a minimal block with the section name
  const fallback = `<div style="margin-bottom:24px;"><h2 style="font-size:18px;font-weight:700;color:#fff;margin:0 0 8px;">${section.name || "Section"}</h2><div style="font-size:13px;color:rgba(255,255,255,0.4);">(No prompt or render template configured)</div></div>`;
  return { html: fallback, sourceCount: result.sourceCount };
}

// ─── Canvas block → HTML renderer ────────────────────────────

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderStaticBlock(block: any): string {
  const s = block.style || {};

  switch (block.type) {
    case "heading": {
      const fontSize = s.fontSize || "24px";
      const style = `margin:0 0 8px;font-family:${s.fontFamily || "DM Sans"},sans-serif;font-size:${fontSize};font-weight:${s.fontWeight || "700"};color:${s.color || "#1a1a2e"};text-align:${s.textAlign || "left"};line-height:1.3;`;
      return `<h${block.level || 1} style="${style}">${block.content || ""}</h${block.level || 1}>`;
    }
    case "text": {
      const style = `font-family:${s.fontFamily || "DM Sans"},sans-serif;font-size:${s.fontSize || "14px"};color:${s.color || "#333333"};text-align:${s.textAlign || "left"};line-height:${s.lineHeight || "1.6"};`;
      return `<div style="${style}">${block.content || ""}</div>`;
    }
    case "image": {
      if (!block.src) return "";
      const style = `width:${s.width || "100%"};border-radius:${s.borderRadius || "4px"};display:block;`;
      return `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || "")}" style="${style}" />`;
    }
    case "divider": {
      return `<hr style="border:none;border-top:${s.borderWidth || "1px"} solid ${s.borderColor || "#e2e8f0"};margin:${s.margin || "8px 0"};" />`;
    }
    case "spacer": {
      return `<div style="height:${s.height || "24px"};"></div>`;
    }
    case "columns": {
      const cols = block.columns || [];
      const colHtml = cols.map((col: any) => {
        const inner = (col.blocks || []).map((b: any) => renderStaticBlock(b)).join("\n");
        return `<td style="width:${Math.floor(100 / cols.length)}%;vertical-align:top;padding:0 8px;">${inner}</td>`;
      }).join("");
      return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${colHtml}</tr></table>`;
    }
    default:
      return "";
  }
}

async function renderCanvas(
  adminClient: ReturnType<typeof createClient>,
  canvas: any[],
  date: string,
): Promise<{ html: string; sourceCount: number }> {
  const htmlBlocks: string[] = [];
  let totalSourceCount = 0;

  // Load all section IDs referenced by canvas
  const sectionIds = canvas
    .filter((b: any) => b.type === "section" && b.sectionId)
    .map((b: any) => b.sectionId);
  let sectionsByIdMap = new Map<string, any>();
  if (sectionIds.length > 0) {
    const { data: sections } = await adminClient
      .from("report_sections")
      .select("*")
      .in("id", sectionIds);
    if (sections) {
      sectionsByIdMap = new Map(sections.map((s: any) => [s.id, s]));
    }
  }

  for (const block of canvas) {
    if (block.type === "section") {
      const section = sectionsByIdMap.get(block.sectionId);
      if (!section) {
        htmlBlocks.push(
          `<div style="margin-bottom:16px;padding:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;font-size:12px;color:#92400e;">Section not found: ${escapeHtml(block.sectionId || "unknown")}</div>`,
        );
        continue;
      }
      try {
        const { html, sourceCount } = await renderSection(adminClient, section, date);
        htmlBlocks.push(html);
        totalSourceCount += sourceCount;
      } catch (err: any) {
        htmlBlocks.push(
          `<div style="margin-bottom:16px;padding:12px 16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#fca5a5;font-size:12px;">Section "${escapeHtml(section.name)}" failed: ${escapeHtml(err.message || String(err))}</div>`,
        );
      }
    } else {
      const html = renderStaticBlock(block);
      if (html) htmlBlocks.push(html);
    }
  }

  return { html: htmlBlocks.join("\n"), sourceCount: totalSourceCount };
}

// ─── Email Delivery via Resend ───────────────────────────────

function buildEmailHtml(reportName: string, date: string, summary: string, content: string, useCanvasTheme = false): string {
  const formattedDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  if (useCanvasTheme) {
    // Light-themed email wrapper for canvas-based reports
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:32px 24px;">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:24px 28px;">
        <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">${reportName}</h1>
        <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.7);">${formattedDate}</p>
      </div>
      ${summary ? `<div style="padding:20px 28px 0;font-size:14px;color:#64748b;line-height:1.5;font-style:italic;">${summary}</div>` : ""}
      <div style="padding:24px 28px;font-size:14px;color:#334155;line-height:1.7;">
        ${content}
      </div>
    </div>
    <div style="text-align:center;padding:20px 0;font-size:11px;color:#94a3b8;">
      Powered by Mayday Studio
    </div>
  </div>
</body>
</html>`;
  }

  // Original dark-themed email wrapper
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
  useCanvasTheme = false,
): Promise<{ sent: number; failed: number }> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  if (!resendKey || !fromEmail) {
    console.warn("RESEND_API_KEY or RESEND_FROM_EMAIL not configured, skipping email delivery");
    return { sent: 0, failed: 0 };
  }

  const { data: internalRecipients } = await adminClient
    .from("profiles")
    .select("id, email")
    .eq("email_reports_enabled", true);

  const { data: externalSubscribers } = await adminClient
    .from("newsletter_subscribers")
    .select("id, email, name")
    .eq("confirmed", true)
    .is("unsubscribed_at", null)
    .or(`report_config_id.eq."${config.id}",report_config_id.is.null`);

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
  const html = buildEmailHtml(reportName, date, report.summary, report.content, useCanvasTheme);

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

// ─── Legacy monolithic run (backward compat) ─────────────────

async function legacyCallClaude(prompt: string): Promise<{ title: string; summary: string; content: string; metadata: Record<string, unknown> }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: prompt + "\n\nIMPORTANT: Return your response as valid JSON with these fields: { \"title\": \"...\", \"summary\": \"1-2 sentence summary\", \"content\": \"full report content as HTML\" }. Only return valid JSON, no markdown code fences.",
      }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
  const data = await resp.json();
  const rawText = data.content?.[0]?.text || "";
  const jsonStr = rawText.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(jsonStr);
  const { title, summary, content, ...rest } = parsed;
  return {
    title: title || "Untitled Report",
    summary: summary || "",
    content: content || jsonStr,
    metadata: rest,
  };
}

async function runLegacyConfig(
  adminClient: ReturnType<typeof createClient>,
  config: any,
  date: string,
): Promise<{ title: string; summary: string; content: string; sourceCount: number; metadata: Record<string, unknown> }> {
  let result: SourceResult;
  if (config.data_sources && Array.isArray(config.data_sources) && config.data_sources.length > 0) {
    result = await fetchAllSources(adminClient, config.data_sources);
  } else {
    switch (config.data_source_type) {
      case "rss": result = await fetchRssSource(adminClient, config.data_source_config || {}); break;
      case "triton_api": result = await fetchTritonSource(config.data_source_config || {}); break;
      case "supabase_query": result = await fetchSupabaseSource(adminClient, config.data_source_config || {}); break;
      default: throw new Error(`Unknown source type: ${config.data_source_type}`);
    }
  }
  result.variables.date = date;
  const prompt = resolvePrompt(config.prompt_template || "", result.variables);
  if (!prompt || prompt.length < 10) throw new Error("Prompt template is empty or too short");
  const report = await legacyCallClaude(prompt);
  return { ...report, sourceCount: result.sourceCount };
}

// ─── Run a config (section-based or canvas-based) ────────────

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
    const canvas: any[] | null = Array.isArray(config.canvas) && config.canvas.length > 0 ? config.canvas : null;
    const sectionIds: string[] = Array.isArray(config.section_ids) ? config.section_ids : [];
    let title = config.name || "Report";
    let summary = config.description || "";
    let content = "";
    let totalSourceCount = 0;
    let metadata: Record<string, unknown> = {};
    let useCanvasTheme = false;

    if (canvas) {
      // ── Canvas pipeline ──────────────────────────────────────
      const result = await renderCanvas(adminClient, canvas, today);
      content = result.html;
      totalSourceCount = result.sourceCount;
      useCanvasTheme = true;
      const canvasSectionIds = canvas.filter(b => b.type === "section").map(b => b.sectionId);
      metadata = { canvas_blocks: canvas.length, section_count: canvasSectionIds.length, section_ids: canvasSectionIds };
    } else if (sectionIds.length > 0) {
      // ── Section IDs pipeline (backward compat) ───────────────
      const { data: sections, error: secErr } = await adminClient
        .from("report_sections")
        .select("*")
        .in("id", sectionIds);
      if (secErr) throw new Error(`Failed to load sections: ${secErr.message}`);
      const byId = new Map((sections || []).map(s => [s.id, s]));
      const ordered = sectionIds.map(id => byId.get(id)).filter(Boolean);

      const htmlBlocks: string[] = [];
      for (const section of ordered) {
        try {
          const { html, sourceCount } = await renderSection(adminClient, section, today);
          htmlBlocks.push(html);
          totalSourceCount += sourceCount;
        } catch (err: any) {
          htmlBlocks.push(
            `<div style="margin-bottom:24px;padding:12px 16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#fca5a5;font-size:12px;">Section "${section.name}" failed: ${err.message || err}</div>`,
          );
        }
      }
      content = htmlBlocks.join("\n");
      metadata = { section_count: ordered.length, section_ids: sectionIds };
    } else if (config.prompt_template) {
      // ── Legacy path ──────────────────────────────────────────
      const legacy = await runLegacyConfig(adminClient, config, today);
      title = legacy.title;
      summary = legacy.summary;
      content = legacy.content;
      totalSourceCount = legacy.sourceCount;
      metadata = legacy.metadata;
    } else {
      throw new Error("Report has no canvas or sections configured");
    }

    await adminClient
      .from("report_runs")
      .update({
        status: "completed",
        title,
        summary,
        content,
        source_count: totalSourceCount,
        metadata,
      })
      .eq("id", runId);

    let emailResult = { sent: 0, failed: 0 };
    if (config.delivery?.email) {
      emailResult = await sendReportEmail(adminClient, config, { title, summary, content }, today, useCanvasTheme);
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
      if (user) {
        const { data: profile } = await userClient
          .from("profiles").select("role").eq("id", user.id).single();
        if (profile?.role === "admin") authenticated = true;
      }
    } catch {}
  }

  if (!authenticated) return jsonResp({ error: "Unauthorized" }, 401);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch {}

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
