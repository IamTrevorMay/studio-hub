// Arms recurring Mailer templates for the day. A pg_cron pings this once daily;
// for each active template (is_template = true, recurrence set) it clones the
// template into a fresh dated campaign (status = 'scheduled', scheduled_at = now)
// unless one already exists for today's ET digest date. The existing per-minute
// mailer-cron-tick then flips it to 'sending' and hands it to mailer-send-now,
// so every day gets its own campaign row + mailer_sends/stats.
//
//   POST /functions/v1/mailer-arm-daily
//     header: X-Cron-Secret: <CRON_SECRET>
//
// Returns { armed: [...campaign ids], skipped: [{template, reason}] }.
//
// Deploy: supabase functions deploy mailer-arm-daily --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResp, getAdminClient } from "../shared/workflow-engine.ts";
import { digestDateET } from "../shared/mailer-bindings.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET");

// "Jul 2" style label for a YYYY-MM-DD date — matches the Triton subject token.
function dateShortLabel(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fillSubject(tmpl: string, name: string, ymd: string): string {
  return (tmpl || name)
    .replace(/\{\{title\}\}/g, name)
    .replace(/\{\{date_short\}\}/g, dateShortLabel(ymd))
    .replace(/\{\{date\}\}/g, ymd);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const admin = getAdminClient();
  const date = digestDateET();                 // yesterday in ET — matches the bindings
  const month = Number(date.slice(5, 7));

  // Active recurring templates.
  const { data: templates, error } = await admin
    .from("mailer_campaigns")
    .select("id, name, subject, preheader, from_name, from_email, reply_to, audience_id, blocks, recurrence")
    .eq("is_template", true)
    .not("recurrence", "is", null);
  if (error) return jsonResp({ error: error.message }, 500);

  const armed: string[] = [];
  const skipped: { template: string; reason: string }[] = [];

  for (const t of (templates || [])) {
    const rec = (t.recurrence || {}) as { skipMonths?: number[] };
    if (Array.isArray(rec.skipMonths) && rec.skipMonths.includes(month)) {
      skipped.push({ template: t.name, reason: `skipMonth ${month}` });
      continue;
    }
    if (!t.audience_id) { skipped.push({ template: t.name, reason: "no audience" }); continue; }
    if (!t.from_email) { skipped.push({ template: t.name, reason: "no from_email" }); continue; }

    // Insert the dated clone. The (template_id, digest_date) unique index makes
    // this idempotent: a second run the same day hits the conflict and no-ops.
    const { data: inserted, error: insErr } = await admin
      .from("mailer_campaigns")
      .insert({
        name: t.name,
        subject: fillSubject(t.subject, t.name, date),
        preheader: t.preheader,
        from_name: t.from_name,
        from_email: t.from_email,
        reply_to: t.reply_to,
        audience_id: t.audience_id,
        blocks: t.blocks,
        status: "scheduled",
        scheduled_at: new Date().toISOString(),
        is_template: false,
        template_id: t.id,
        digest_date: date,
        stats: {},
      })
      .select("id")
      .maybeSingle();

    if (insErr) {
      // 23505 = unique violation → already armed for this date; treat as success.
      if (insErr.code === "23505") skipped.push({ template: t.name, reason: "already armed today" });
      else skipped.push({ template: t.name, reason: insErr.message });
      continue;
    }
    if (inserted?.id) armed.push(inserted.id as string);
  }

  return jsonResp({ ok: true, date, armed, skipped });
});
