// supabase/functions/jobs-retention/index.ts
// Daily PII retention for the careers board. Purges old job applications and
// their résumé files. Auth via the shared CRON_SECRET (?secret= or header).
//
// Policy:
//   - Declined applications older than 180 days       → delete
//   - Any non-hired application older than 365 days    → delete
//   "Hired" = has a row in job_onboarding (those are kept).
//
// Deploy: supabase functions deploy jobs-retention --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DECLINED_DAYS = 180;
const CATCHALL_DAYS = 365;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // Auth — cron passes ?secret=, allow x-cron-secret header too.
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || req.headers.get("x-cron-secret");
  if (!secret || secret !== Deno.env.get("CRON_SECRET")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = Date.now();
  const declinedCutoff = new Date(now - DECLINED_DAYS * 86400_000).toISOString();
  const catchallCutoff = new Date(now - CATCHALL_DAYS * 86400_000).toISOString();

  // Applications hired into onboarding are exempt from purge.
  const { data: onboardRows } = await admin
    .from("job_onboarding")
    .select("application_id");
  const hired = new Set((onboardRows || []).map((r) => r.application_id).filter(Boolean));

  // Declined > 180d
  const { data: declined } = await admin
    .from("job_applications")
    .select("id, resume_path")
    .eq("status", "declined")
    .lt("created_at", declinedCutoff);

  // Anything > 365d (any status)
  const { data: stale } = await admin
    .from("job_applications")
    .select("id, resume_path")
    .lt("created_at", catchallCutoff);

  // Union, drop hired, dedupe.
  const byId = new Map<string, string | null>();
  for (const r of [...(declined || []), ...(stale || [])]) {
    if (!hired.has(r.id)) byId.set(r.id, r.resume_path);
  }

  if (byId.size === 0) {
    return json({ ok: true, deleted: 0, resumes_removed: 0 });
  }

  const ids = [...byId.keys()];
  const resumePaths = [...byId.values()].filter((p): p is string => !!p);

  // Remove résumé objects first (best-effort — don't block row deletion on it).
  let resumesRemoved = 0;
  if (resumePaths.length) {
    const { error: rmErr } = await admin.storage.from("job-resumes").remove(resumePaths);
    if (rmErr) console.error("Résumé purge failed:", rmErr.message);
    else resumesRemoved = resumePaths.length;
  }

  const { error: delErr } = await admin
    .from("job_applications")
    .delete()
    .in("id", ids);
  if (delErr) return json({ error: `Row purge failed: ${delErr.message}` }, 500);

  console.log(`jobs-retention: purged ${ids.length} applications, ${resumesRemoved} résumés`);
  return json({ ok: true, deleted: ids.length, resumes_removed: resumesRemoved });
});
