// supabase/functions/check-data-integrity/index.ts
// Daily data integrity check. For each active platform account, against a
// per-platform "target day" (yesterday, or 2 days back for YouTube whose
// Analytics API lands ~48h late):
//   1. Verifies the target day's platform_daily_metrics row exists
//   2. Verifies the target day's audience_snapshots row exists
//   3. Flags extreme outliers (>5x or <0.2x 7-day trailing average views)
// TikTok 0-view days are the known first-party capture gap (real per-video
// views come from the local scraper) — logged as a suppressed signal and
// kept out of the trailing baseline, never a false "outlier low".
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
    const ptDayOffset = (days: number) =>
      ptDayString(new Date(Date.now() - days * 86400000));

    // Per-platform reporting lag in days. The YouTube Analytics API lands
    // ~48h late, so checking "yesterday" false-flags every single run; give
    // it a 2-day lag. Everything else reports the next day.
    const PLATFORM_LAG_DAYS: Record<string, number> = { youtube: 2 };

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
      // Day we expect data for, shifted by the platform's reporting lag so we
      // don't flag data that simply hasn't landed yet.
      const lag = PLATFORM_LAG_DAYS[acct.platform] ?? 1;
      const targetDate = ptDayOffset(lag);
      // "Recent activity" window: the ~2 weeks before the target day, used to
      // tell a one-off miss (flag it) from a chronically dead sync (skip it).
      const recentStart = ptDayOffset(lag + 13);
      const recentEnd = ptDayOffset(lag + 1);
      // Trailing baseline: the 7 days ending the day before the target.
      const trailStart = ptDayOffset(lag + 7);
      const trailEnd = ptDayOffset(lag + 1);

      // Only flag a data type this account actually produced in the prior
      // 14 days. Chronically-absent types (dead syncs, platforms that never
      // emit a type — e.g. Threads has no PDM, Simplecast no snapshots)
      // would otherwise re-alert every day and drown real regressions.
      const { data: pdmRecent } = await supabase
        .from("platform_daily_metrics")
        .select("id")
        .eq("platform_account_id", acct.id)
        .gte("date", recentStart)
        .lte("date", recentEnd)
        .limit(1)
        .maybeSingle();

      const { data: audRecent } = await supabase
        .from("audience_snapshots")
        .select("id")
        .eq("platform_account_id", acct.id)
        .gte("date", recentStart)
        .lte("date", recentEnd)
        .limit(1)
        .maybeSingle();

      // Check platform_daily_metrics for the target day
      const { data: pdmTarget } = await supabase
        .from("platform_daily_metrics")
        .select("id")
        .eq("platform_account_id", acct.id)
        .eq("date", targetDate)
        .maybeSingle();

      if (!pdmTarget) {
        if (pdmRecent) {
          findings.push(`Missing PDM for ${acct.account_name} (${acct.platform}) on ${targetDate}`);
          missingByAccount.push({ accountId: acct.id, dates: [targetDate] });
        } else {
          skipped.push(`PDM chronically absent for ${acct.account_name} (${acct.platform})`);
        }
      }

      // Check audience_snapshots for the target day
      const { data: audTarget } = await supabase
        .from("audience_snapshots")
        .select("id")
        .eq("platform_account_id", acct.id)
        .eq("date", targetDate)
        .maybeSingle();

      if (!audTarget) {
        if (audRecent) {
          findings.push(`Missing audience snapshot for ${acct.account_name} (${acct.platform}) on ${targetDate}`);
        } else {
          skipped.push(`Snapshots chronically absent for ${acct.account_name} (${acct.platform})`);
        }
      }

      // Trailing 7-day average views vs the target day
      const { data: trailing } = await supabase
        .from("platform_daily_metrics")
        .select("views")
        .eq("platform_account_id", acct.id)
        .gte("date", trailStart)
        .lte("date", trailEnd);

      if (trailing && pdmTarget) {
        const { data: targetData } = await supabase
          .from("platform_daily_metrics")
          .select("views")
          .eq("platform_account_id", acct.id)
          .eq("date", targetDate)
          .maybeSingle();

        if (targetData) {
          const isTikTok = acct.platform === "tiktok";
          const targetViews = targetData.views || 0;

          if (isTikTok && targetViews === 0) {
            // Known first-party capture gap: TikTok's API returns 0 while the
            // real per-video views come from the local scraper. Suppress it as
            // a logged signal instead of a false "outlier low".
            skipped.push(`TikTok API returned 0 views for ${acct.account_name} on ${targetDate} (first-party capture gap)`);
          } else {
            // Keep TikTok's known-bad 0-view days out of the baseline so they
            // don't drag the average and make real days look like outliers.
            const sample = isTikTok
              ? trailing.filter((r) => (r.views || 0) > 0)
              : trailing;
            if (sample.length >= 3) {
              const avg = sample.reduce((s, r) => s + (r.views || 0), 0) / sample.length;
              if (avg > 0) {
                if (targetViews > avg * 5) {
                  findings.push(`Outlier HIGH: ${acct.account_name} views ${targetViews} vs 7d avg ${Math.round(avg)} (${(targetViews / avg).toFixed(1)}x)`);
                } else if (targetViews < avg * 0.2) {
                  findings.push(`Outlier LOW: ${acct.account_name} views ${targetViews} vs 7d avg ${Math.round(avg)} (${(targetViews / avg).toFixed(2)}x)`);
                }
              }
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
