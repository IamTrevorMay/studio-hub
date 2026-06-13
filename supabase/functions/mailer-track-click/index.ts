// Click-tracking redirect. The render rewrites every href to point at
// this endpoint with the original URL in `u`. We log the click then
// 302 the recipient onward.
//
//   GET /functions/v1/mailer-track-click?s=<send_id>&u=<encoded url>
//
// The destination URL is validated so we don't become an open redirect
// for arbitrary external targets — only http/https schemes pass.
//
// Deploy: supabase functions deploy mailer-track-click --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getAdminClient } from "../shared/workflow-engine.ts";

function safeDest(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch { return null; }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const sendId = url.searchParams.get("s");
  const dest = safeDest(url.searchParams.get("u"));
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
