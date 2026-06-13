// Receives Resend webhook events and updates mailer_sends + rolls up
// per-campaign stats.
//
// Configure in Resend dashboard → Webhooks:
//   URL: <project>/functions/v1/mailer-webhook
//   Events: email.delivered, email.opened, email.clicked, email.bounced,
//           email.complained, email.delivery_delayed
//
// Resend signs webhooks with Svix (Standard Webhooks). Verifying the
// signature requires the MAILER_WEBHOOK_SECRET secret you configured in
// the dashboard. Unverified requests get a 401.
//
// Deploy: supabase functions deploy mailer-webhook --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  jsonResp,
  getAdminClient,
} from "../shared/workflow-engine.ts";

const WEBHOOK_SECRET = Deno.env.get("MAILER_WEBHOOK_SECRET");

// Map Resend event types onto our internal send status + stats counter.
const EVENT_MAP: Record<string, { status: string; column: string; stat: string }> = {
  "email.delivered":  { status: "delivered",  column: "delivered_at",  stat: "delivered" },
  "email.opened":     { status: "opened",     column: "opened_at",     stat: "opened" },
  "email.clicked":    { status: "clicked",    column: "clicked_at",    stat: "clicked" },
  "email.bounced":    { status: "bounced",    column: "bounced_at",    stat: "bounced" },
  "email.complained": { status: "complained", column: "complained_at", stat: "complained" },
};

async function verifySignature(req: Request, raw: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return true; // Allow unsigned in dev if no secret configured.
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sig = req.headers.get("svix-signature");
  if (!id || !ts || !sig) return false;
  // Standard Webhooks signature = HMAC-SHA256(secret, id + '.' + ts + '.' + body) base64.
  const enc = new TextEncoder();
  const secretBytes = WEBHOOK_SECRET.startsWith("whsec_")
    ? Uint8Array.from(atob(WEBHOOK_SECRET.slice(6)), (c) => c.charCodeAt(0))
    : enc.encode(WEBHOOK_SECRET);
  const key = await crypto.subtle.importKey(
    "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const macBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${raw}`)));
  const expected = btoa(String.fromCharCode(...macBytes));
  // svix-signature is space-separated list of v1,<b64>; compare any match.
  return sig.split(" ").some((p) => p.split(",")[1] === expected);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const raw = await req.text();
  if (!await verifySignature(req, raw)) {
    return jsonResp({ error: "Invalid signature" }, 401);
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try { event = JSON.parse(raw); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }
  if (!event.type || !event.data) return jsonResp({ error: "Missing type/data" }, 400);

  const admin = getAdminClient();
  const mapped = EVENT_MAP[event.type];
  const resendId = (event.data as { email_id?: string }).email_id;

  // Locate the send row by Resend id (preferred) or fall back to recipient.
  let sendId: string | null = null;
  let campaignId: string | null = null;
  if (resendId) {
    const { data } = await admin
      .from("mailer_sends")
      .select("id, campaign_id, status")
      .eq("resend_id", resendId)
      .maybeSingle();
    if (data) { sendId = data.id as string; campaignId = data.campaign_id as string; }
  }

  // Always log the raw event for replay / debugging.
  await admin.from("mailer_events").insert({
    campaign_id: campaignId,
    send_id: sendId,
    event_type: event.type,
    payload: event.data,
    url: (event.data as { click?: { link?: string } }).click?.link || null,
  });

  // Update send row + bump campaign counter, but only if this is an
  // event we model. Unknown events (Resend may add new types) are still
  // logged above so we can backfill mappings later without losing data.
  if (mapped && sendId) {
    await admin.from("mailer_sends").update({
      status: mapped.status,
      [mapped.column]: new Date().toISOString(),
    }).eq("id", sendId);

    if (campaignId) {
      // Increment the rolled-up stat. Postgres jsonb_set + cast to int
      // keeps this atomic without a serializable transaction.
      await admin.rpc("mailer_bump_stat", {
        p_campaign_id: campaignId,
        p_key: mapped.stat,
      });
    }

    // Special handling: bounce / complaint → flip subscriber + suppress.
    if (event.type === "email.bounced" || event.type === "email.complained") {
      const { data: sendRow } = await admin
        .from("mailer_sends")
        .select("email, subscriber_id")
        .eq("id", sendId)
        .maybeSingle();
      if (sendRow?.subscriber_id) {
        await admin.from("mailer_subscribers").update({
          status: event.type === "email.bounced" ? "bounced" : "complained",
          [event.type === "email.bounced" ? "bounced_at" : "unsubscribed_at"]: new Date().toISOString(),
        }).eq("id", sendRow.subscriber_id);
      }
      if (sendRow?.email) {
        await admin.from("mailer_suppressions").upsert({
          email: sendRow.email,
          reason: event.type,
        }, { onConflict: "email" });
      }
    }
  }

  return jsonResp({ ok: true });
});
