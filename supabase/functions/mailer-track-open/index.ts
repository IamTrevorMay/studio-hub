// 1x1 transparent gif endpoint. The render embeds this URL as the open
// tracker pixel; loading it marks the send + bumps the campaign open
// counter.
//
//   GET /functions/v1/mailer-track-open?s=<send_id>
//
// Always returns the gif (200) so mail clients don't show a broken
// image even if the send_id is unknown. We log a 'pixel.open' event
// anyway so we can audit any orphan loads.
//
// Deploy: supabase functions deploy mailer-track-open --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getAdminClient } from "../shared/workflow-engine.ts";

// 43-byte transparent gif.
const GIF_BYTES = Uint8Array.from(atob(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
), (c) => c.charCodeAt(0));

const GIF_HEADERS = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  "Pragma": "no-cache",
};

function gifResponse() {
  return new Response(GIF_BYTES, { headers: GIF_HEADERS });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const sendId = url.searchParams.get("s");
  if (!sendId) return gifResponse();

  const admin = getAdminClient();
  const { data: send } = await admin
    .from("mailer_sends")
    .select("id, campaign_id, opened_at")
    .eq("id", sendId)
    .maybeSingle();

  // Always log — duplicate opens (Gmail's image proxy fires twice) are
  // useful for click-vs-open ratio calculations.
  await admin.from("mailer_events").insert({
    campaign_id: send?.campaign_id || null,
    send_id: send?.id || null,
    event_type: "pixel.open",
    payload: { send_id: sendId },
    user_agent: req.headers.get("user-agent"),
  });

  // Only bump the campaign counter on the first open per send row, or
  // every webhook would inflate the rate against repeated image-proxy
  // requests.
  if (send && !send.opened_at) {
    await admin.from("mailer_sends").update({
      status: "opened",
      opened_at: new Date().toISOString(),
    }).eq("id", send.id);
    if (send.campaign_id) {
      await admin.rpc("mailer_bump_stat", {
        p_campaign_id: send.campaign_id,
        p_key: "opened",
      });
    }
  }

  return gifResponse();
});
