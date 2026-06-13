// One-click unsubscribe endpoint. Used as the List-Unsubscribe URL
// (RFC 8058) and as the visible footer link in every send.
//
//   GET  /functions/v1/mailer-unsubscribe?s=<send_id>   → confirmation page
//   POST /functions/v1/mailer-unsubscribe?s=<send_id>   → unsubscribe immediately (Gmail one-click)
//
// Marks the subscriber 'unsubscribed', adds to suppressions, logs an
// event. Idempotent — repeated POSTs are no-ops.
//
// Deploy: supabase functions deploy mailer-unsubscribe --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getAdminClient } from "../shared/workflow-engine.ts";

const PAGE_HEAD = `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#111;}
.card{background:#fff;padding:32px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.06);max-width:420px;text-align:center;}
h1{margin:0 0 12px;font-size:20px;}p{margin:0 0 16px;line-height:1.5;color:#555;}
button{background:#6366f1;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;}
button.secondary{background:transparent;color:#666;}</style></head><body><div class="card">`;
const PAGE_FOOT = `</div></body></html>`;

async function unsubscribe(sendId: string): Promise<{ ok: boolean; email?: string }> {
  const admin = getAdminClient();
  const { data: send } = await admin
    .from("mailer_sends")
    .select("id, email, subscriber_id, campaign_id")
    .eq("id", sendId)
    .maybeSingle();
  if (!send) return { ok: false };

  if (send.subscriber_id) {
    await admin.from("mailer_subscribers").update({
      status: "unsubscribed",
      unsubscribed_at: new Date().toISOString(),
    }).eq("id", send.subscriber_id);
  }
  await admin.from("mailer_suppressions").upsert({
    email: send.email,
    reason: "unsubscribe",
  }, { onConflict: "email" });
  await admin.from("mailer_events").insert({
    campaign_id: send.campaign_id,
    send_id: send.id,
    event_type: "unsubscribe",
    payload: { send_id: sendId },
  });
  return { ok: true, email: String(send.email) };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const sendId = url.searchParams.get("s");
  if (!sendId) return new Response("Missing s param", { status: 400 });

  // Gmail / Apple Mail one-click POST.
  if (req.method === "POST") {
    const r = await unsubscribe(sendId);
    return new Response(r.ok ? "ok" : "not found", { status: r.ok ? 200 : 404 });
  }

  // Browser GET — show a confirmation page that POSTs back to ourselves.
  // We do NOT auto-unsubscribe on GET because mail-scanning bots
  // (corporate antivirus, link previewers) hit every URL in a message.
  if (req.method === "GET") {
    const body = `${PAGE_HEAD}<h1>Unsubscribe?</h1>
<p>Click the button to stop receiving emails from us.</p>
<form method="POST">
  <button type="submit">Unsubscribe</button>
</form>
${PAGE_FOOT}`;
    return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return new Response("Method not allowed", { status: 405 });
});
