// supabase/functions/run-backfills/index.ts
// Processes pending items from sync_backfill_queue by dispatching to the
// relevant sync-* edge function with a target date parameter.
// Auth: CRON_SECRET or admin JWT.
// Deploy: supabase functions deploy run-backfills --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseAdmin, jsonResponse, errorResponse } from "../shared/utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// Platforms that support historical re-sync via date parameter
const SYNC_FUNCTION_MAP: Record<string, string> = {
  youtube: "sync-youtube",
  instagram: "sync-metricool",
  facebook: "sync-metricool",
  tiktok: "sync-metricool",
  twitter: "sync-metricool",
  threads: "sync-metricool",
  stripe: "sync-stripe",
  substack: "sync-substack",
  twitch: "sync-twitch",
  fourthwall: "sync-fourthwall",
};

// Platforms that cannot re-sync historical data for a specific past day
const NO_HISTORICAL_SYNC = new Set(["twitch"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
      },
    });
  }

  // Auth
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret")
    ?? new URL(req.url).searchParams.get("secret");
  const isCron = !!cronSecret && provided === cronSecret;

  if (!isCron) {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
    const supabase = getSupabaseAdmin();
    const { data: { user } } = await supabase.auth.getUser(auth.slice(7));
    if (!user) return errorResponse("Unauthorized", 401);
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return errorResponse("Forbidden", 403);
  }

  const supabase = getSupabaseAdmin();

  try {
    // Pick up to 10 pending items, oldest first
    const { data: items, error: fetchErr } = await supabase
      .from("sync_backfill_queue")
      .select("*, platform_accounts!inner(platform, account_name)")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);

    if (fetchErr) throw new Error(`Queue fetch failed: ${fetchErr.message}`);
    if (!items || items.length === 0) {
      return jsonResponse({ ok: true, processed: 0, message: "No pending backfills" });
    }

    const results: Array<{ id: string; date: string; platform: string; status: string; error?: string }> = [];

    for (const item of items) {
      const platform = item.platform_accounts?.platform;
      const syncFn = platform ? SYNC_FUNCTION_MAP[platform] : null;

      // Skip platforms that can't do historical re-sync
      if (!syncFn || NO_HISTORICAL_SYNC.has(platform)) {
        await supabase.from("sync_backfill_queue")
          .update({ status: "skipped", completed_at: new Date().toISOString() })
          .eq("id", item.id);
        results.push({ id: item.id, date: item.target_date, platform: platform || "unknown", status: "skipped" });
        continue;
      }

      // Mark running
      await supabase.from("sync_backfill_queue")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", item.id);

      try {
        // Call the sync function with date parameters
        const fnUrl = `${SUPABASE_URL}/functions/v1/${syncFn}?backfill_date=${item.target_date}`;
        const res = await fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Cron-Secret": cronSecret || "",
          },
          body: JSON.stringify({ backfill_date: item.target_date }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`${syncFn} returned ${res.status}: ${errText.slice(0, 500)}`);
        }

        // A 200 from the sync function does NOT prove the target day was
        // backfilled: several syncs (metricool, stripe, substack, fourthwall)
        // only cover a recent rolling window and ignore backfill_date, so an
        // older date returns 200 while writing nothing. Verify a row actually
        // landed for (account, target_date); if not, throw so the item retries
        // and ultimately surfaces as 'failed' instead of being silently marked
        // completed and hiding a permanent gap.
        const acctId = item.platform_account_id;
        const [pdm, snap] = await Promise.all([
          supabase.from("platform_daily_metrics")
            .select("*", { count: "exact", head: true })
            .eq("platform_account_id", acctId).eq("date", item.target_date),
          supabase.from("audience_snapshots")
            .select("*", { count: "exact", head: true })
            .eq("platform_account_id", acctId).eq("date", item.target_date),
        ]);
        if (!(pdm.count || 0) && !(snap.count || 0)) {
          throw new Error(
            `${syncFn} returned 200 but wrote no metrics/snapshot for ${item.target_date} — ` +
            `this platform likely cannot re-sync that historical date`,
          );
        }

        await supabase.from("sync_backfill_queue")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", item.id);
        results.push({ id: item.id, date: item.target_date, platform, status: "completed" });
      } catch (err) {
        const newRetries = (item.retries || 0) + 1;
        const newStatus = newRetries >= (item.max_retries || 3) ? "failed" : "pending";
        await supabase.from("sync_backfill_queue")
          .update({
            status: newStatus,
            retries: newRetries,
            error_message: (err as Error).message,
            ...(newStatus === "failed" ? { completed_at: new Date().toISOString() } : {}),
          })
          .eq("id", item.id);
        results.push({
          id: item.id,
          date: item.target_date,
          platform,
          status: newStatus === "failed" ? "failed" : "retry",
          error: (err as Error).message,
        });
      }
    }

    return jsonResponse({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error("run-backfills error:", err);
    return errorResponse((err as Error).message);
  }
});
