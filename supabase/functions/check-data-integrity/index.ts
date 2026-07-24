// supabase/functions/check-data-integrity/index.ts
// Daily data integrity check. For each active platform account:
//   1. Verifies yesterday's platform_daily_metrics row exists
//   2. Verifies yesterday's audience_snapshots row exists
//   3. Flags extreme outliers (>5x or <0.2x 7-day trailing average views)
// Enqueues missing days for backfill and notifies admins.
// Auth: CRON_SECRET or admin JWT.
// Deploy: supabase functions deploy check-data-integrity --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getSupabaseAdmin,
  enqueueBackfills,
  jsonResponse,
  errorResponse,
} from "../shared/utils.ts";

function ptDayString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

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
    const yesterday = ptDayString(new Date(Date.now() - 86400000));
    const sevenDaysAgo = ptDayString(new Date(Date.now() - 7 * 86400000));
    const twoDaysAgo = ptDayString(new Date(Date.now() - 2 * 86400000));
    const fourteenDaysAgo = ptDayString(new Date(Date.now() - 14 * 86400000));

    // Get all active accounts
    const { data: accounts } = await supabase
      .from("platform_accounts")
      .select("id, platform, account_name")
      .eq("is_active", true);
    if (!accounts || accounts.length === 0) {
      return jsonResponse({ ok: true, message: "No active accounts" });
    }

    const findings: string[] = [];
    const skipped: string[] = [];
    const missingByAccount: Array<{ accountId: string; dates: string[] }> = [];

    for (const acct of accounts) {
      // Only flag a data type this account actually produced in the prior
      // 14 days. Chronically-absent types (dead syncs, platforms that never
      // emit a type — e.g. Threads has no PDM, Simplecast no snapshots)
      // would otherwise re-alert every day and drown real regressions.
      const { data: pdmRecent } = await supabase
        .from("platform_daily_metrics")
        .select("id")
        .eq("platform_account_id", acct.id)
        .gte("date", fourteenDaysAgo)
        .lte("date", twoDaysAgo)
        .limit(1)
        .maybeSingle();

      const { data: audRecent } = await supabase
        .from("audience_snapshots")
        .select("id")
        .eq("platform_account_id", acct.id)
        .gte("date", fourteenDaysAgo)
        .lte("date", twoDaysAgo)
        .limit(1)
        .maybeSingle();

      // Check platform_daily_metrics for yesterday
      const { data: pdmYesterday } = await supabase
        .from("platform_daily_metrics")
        .select("id")
        .eq("platform_account_id", acct.id)
        .eq("date", yesterday)
        .maybeSingle();

      if (!pdmYesterday) {
        if (pdmRecent) {
          findings.push(`Missing PDM for ${acct.account_name} (${acct.platform}) on ${yesterday}`);
          missingByAccount.push({ accountId: acct.id, dates: [yesterday] });
        } else {
          skipped.push(`PDM chronically absent for ${acct.account_name} (${acct.platform})`);
        }
      }

      // Check audience_snapshots for yesterday
      const { data: audYesterday } = await supabase
        .from("audience_snapshots")
        .select("id")
        .eq("platform_account_id", acct.id)
        .eq("date", yesterday)
        .maybeSingle();

      if (!audYesterday) {
        if (audRecent) {
          findings.push(`Missing audience snapshot for ${acct.account_name} (${acct.platform}) on ${yesterday}`);
        } else {
          skipped.push(`Snapshots chronically absent for ${acct.account_name} (${acct.platform})`);
        }
      }

      // Trailing 7-day average views vs yesterday
      const { data: trailing } = await supabase
        .from("platform_daily_metrics")
        .select("views")
        .eq("platform_account_id", acct.id)
        .gte("date", sevenDaysAgo)
        .lte("date", twoDaysAgo);

      if (trailing && trailing.length >= 3 && pdmYesterday) {
        const { data: ydayData } = await supabase
          .from("platform_daily_metrics")
          .select("views")
          .eq("platform_account_id", acct.id)
          .eq("date", yesterday)
          .maybeSingle();

        if (ydayData) {
          const avg = trailing.reduce((s, r) => s + (r.views || 0), 0) / trailing.length;
          const ydayViews = ydayData.views || 0;
          if (avg > 0) {
            if (ydayViews > avg * 5) {
              findings.push(`Outlier HIGH: ${acct.account_name} views ${ydayViews} vs 7d avg ${Math.round(avg)} (${(ydayViews / avg).toFixed(1)}x)`);
            } else if (ydayViews < avg * 0.2) {
              findings.push(`Outlier LOW: ${acct.account_name} views ${ydayViews} vs 7d avg ${Math.round(avg)} (${(ydayViews / avg).toFixed(2)}x)`);
            }
          }
        }
      }
    }

    // Enqueue backfills for missing days
    let totalEnqueued = 0;
    for (const { accountId, dates } of missingByAccount) {
      const enqueued = await enqueueBackfills(supabase, accountId, dates);
      totalEnqueued += enqueued;
    }

    // Notify admins if there are findings
    let notified = 0;
    if (findings.length > 0) {
      const today = new Date().toISOString().slice(0, 10);

      // Dedup: skip if same-type notification already exists today
      const { data: existingNote } = await supabase
        .from("notifications")
        .select("id")
        .eq("type", "data_integrity")
        .gte("created_at", today + "T00:00:00Z")
        .limit(1)
        .maybeSingle();

      if (!existingNote) {
        const { data: admins } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", "admin");

        if (admins && admins.length > 0) {
          const notes = admins.map((a) => ({
            user_id: a.id,
            type: "data_integrity",
            title: `Data integrity: ${findings.length} issue${findings.length > 1 ? "s" : ""} found`,
            body: findings.slice(0, 5).join("; "),
            link_tab: "analytics",
          }));
          const { error: noteErr } = await supabase.from("notifications").insert(notes);
          if (!noteErr) notified = notes.length;
        }
      }
    }

    console.log(`Data integrity check: ${findings.length} findings, ${skipped.length} chronic skips, ${totalEnqueued} backfills enqueued, ${notified} notifications sent`);

    return jsonResponse({
      ok: true,
      findings_count: findings.length,
      findings,
      skipped_chronic: skipped,
      backfills_enqueued: totalEnqueued,
      notifications_sent: notified,
    });
  } catch (err) {
    console.error("check-data-integrity error:", err);
    return errorResponse((err as Error).message);
  }
});
