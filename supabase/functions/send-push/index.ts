// supabase/functions/send-push/index.ts
// Sends a Web Push notification to every subscribed device of a user.
// Invoked by the notifications_push_trigger DB trigger (pg_net) with
// { notification: <notifications row> } and an x-cron-secret header.
//
// Env: CRON_SECRET, VAPID_KEYS_JWK ({publicKey, privateKey} JWKs),
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy: supabase functions deploy send-push --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Mirrors src/lib/notificationPrefs.js — keep in sync.
const TYPE_TO_CATEGORY: Record<string, string> = {
  task_assigned: "tasks",
  assignment: "tasks",
  automation: "tasks",
  ooo_request: "team",
  mention: "messages",
  message: "messages",
};

function categoryForType(type: string | null): string {
  if (!type) return "other";
  if (TYPE_TO_CATEGORY[type]) return TYPE_TO_CATEGORY[type];
  if (type.startsWith("bd_")) return "tasks";
  if (type.startsWith("fl_")) return "contractors";
  return "other";
}

let appServer: webpush.ApplicationServer | null = null;
async function getAppServer(): Promise<webpush.ApplicationServer> {
  if (appServer) return appServer;
  const vapidKeys = await webpush.importVapidKeys(
    JSON.parse(Deno.env.get("VAPID_KEYS_JWK")!),
    { extractable: false },
  );
  appServer = await webpush.ApplicationServer.new({
    contactInformation: "mailto:trevor.may.khs@gmail.com",
    vapidKeys,
  });
  return appServer;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (!expectedSecret || req.headers.get("x-cron-secret") !== expectedSecret) {
    return jsonResp({ error: "unauthorized" }, 401);
  }

  let notification: Record<string, unknown>;
  try {
    ({ notification } = await req.json());
    if (!notification?.user_id) throw new Error("missing notification.user_id");
  } catch (e) {
    return jsonResp({ error: `bad request: ${e.message}` }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const userId = notification.user_id as string;
  const type = (notification.type as string) ?? null;

  // Mobile category prefs: missing key = enabled, false = muted.
  const { data: profile } = await admin
    .from("profiles")
    .select("notification_prefs")
    .eq("id", userId)
    .single();
  const mobilePrefs = (profile?.notification_prefs as Record<string, Record<string, boolean>>)?.mobile;
  if (mobilePrefs?.[categoryForType(type)] === false) {
    return jsonResp({ sent: 0, skipped: "category muted" });
  }

  const { data: subs, error: subsErr } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (subsErr) return jsonResp({ error: subsErr.message }, 500);
  if (!subs || subs.length === 0) return jsonResp({ sent: 0, skipped: "no subscriptions" });

  const linkTab = (notification.link_tab as string) || "dashboard";
  const payload = JSON.stringify({
    title: (notification.title as string) || "Mayday Studio",
    body: (notification.body as string) || "",
    url: `/${linkTab === "business_dev" ? "roadmap" : linkTab}`,
    tag: notification.id ? `mayday-notif-${notification.id}` : undefined,
  });

  const server = await getAppServer();
  let sent = 0;
  const dead: string[] = [];

  for (const sub of subs) {
    try {
      const subscriber = server.subscribe({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      });
      await subscriber.pushTextMessage(payload, {});
      sent++;
    } catch (err) {
      // 404/410 = subscription expired or revoked — prune it.
      const status = err?.response?.status;
      const gone = status === 404 || status === 410 ||
        (typeof err?.isGone === "function" && err.isGone());
      if (gone) {
        dead.push(sub.id);
      } else {
        console.error(`push failed for sub ${sub.id}:`, err?.message || err);
      }
    }
  }

  if (dead.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }
  if (sent > 0) {
    await admin
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  return jsonResp({ sent, pruned: dead.length });
});
