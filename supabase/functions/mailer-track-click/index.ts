// Click-tracking redirect. The render rewrites every href to point at
// this endpoint with the original URL in `u`. We log the click then
// 302 the recipient onward.
//
//   GET /functions/v1/mailer-track-click?s=<send_id>&u=<encoded url>
//
// The destination URL is validated so we don't become an open redirect for
// arbitrary external targets: it must be http/https AND carry a valid HMAC
// signature (`sig`) that mailer-send-now attached at render time. A scheme
// check alone was insufficient — anyone could pass ?u=https://evil.com and turn
// the sending domain into a phishing redirector.
//
// Deploy: supabase functions deploy mailer-track-click --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getAdminClient } from "../shared/workflow-engine.ts";
import { verifyDest } from "../shared/mailer-links.ts";

function safeDest(raw: string | null, sig: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Only redirect to a destination we ourselves signed.
    if (!verifyDest(raw, sig)) return null;
    return u.toString();
  } catch { return null; }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const sendId = url.searchParams.get("s");
  const dest = safeDest(url.searchParams.get("u"), url.searchParams.get("sig"));
  if (!dest) return new Response("Bad destination", { status: 400 });

  if (sendId) {
    const admin = getAdminClient();
    const { data: send } = await admin
      .from("mailer_sends")
      .select("id, campaign_id, clicked_at")
      .eq("id", sendId)
      .maybeSingle();
    await admin.from("mailer_events").insert({
      campaign_id: send?.campaign_id || null,
      send_id: send?.id || null,
      event_type: "pixel.click",
      payload: { send_id: sendId, url: dest },
      url: dest,
      user_agent: req.headers.get("user-agent"),
    });
    if (send && !send.clicked_at) {
      await admin.from("mailer_sends").update({
        status: "clicked",
        clicked_at: new Date().toISOString(),
      }).eq("id", send.id);
      if (send.campaign_id) {
        await admin.rpc("mailer_bump_stat", {
          p_campaign_id: send.campaign_id,
          p_key: "clicked",
        });
      }
    }
  }

  return Response.redirect(dest, 302);
});
