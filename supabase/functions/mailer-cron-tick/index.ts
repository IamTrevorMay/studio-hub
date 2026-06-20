// Pg_cron pings this once a minute to flush scheduled campaigns whose
// scheduled_at has passed. Each due campaign is handed off to
// mailer-send-now; the cron loop only handles dispatch ordering, not
// the actual sending.
//
//   POST /functions/v1/mailer-cron-tick
//     header: X-Cron-Secret: <CRON_SECRET>
//
// Returns { fired: <campaign_ids> } for log inspection.
//
// Deploy: supabase functions deploy mailer-cron-tick --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResp, getAdminClient } from "../shared/workflow-engine.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const admin = getAdminClient();
  const nowIso = new Date().toISOString();

  // Atomic claim: flip status from 'scheduled' → 'sending' for due
  // campaigns so two simultaneous ticks can't double-fire.
  const { data: claimed } = await admin
    .from("mailer_campaigns")
    .update({ status: "sending" })
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .select("id");

  const fired: string[] = [];
  for (const c of (claimed || [])) {
    try {
      // Reuse the send-now endpoint so the dispatch logic stays in one
      // place. Tick provides its own service-role JWT.
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/mailer-send-now`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
          // Internal auth — send-now skips the user-JWT check + the
          // 'already sending' guard for calls bearing the cron secret.
          "X-Cron-Secret": CRON_SECRET,
        },
        body: JSON.stringify({ campaign_id: c.id }),
      });
      if (!resp.ok) {
        await admin.from("mailer_campaigns").update({ status: "failed" }).eq("id", c.id);
        continue;
      }
      fired.push(c.id as string);
    } catch {
      await admin.from("mailer_campaigns").update({ status: "failed" }).eq("id", c.id);
    }
  }

  return jsonResp({ fired });
});
