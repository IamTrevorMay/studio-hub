import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

export async function startIngestionLog(
  supabase: ReturnType<typeof createClient>,
  platformAccountId: string,
  jobType: string
): Promise<string> {
  const { data, error } = await supabase
    .from("ingestion_logs")
    .insert({
      platform_account_id: platformAccountId,
      job_type: jobType,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create ingestion log: ${error.message}`);
  return data.id;
}

export async function completeIngestionLog(
  supabase: ReturnType<typeof createClient>,
  logId: string,
  stats: { records_processed?: number; records_created?: number; records_updated?: number },
  platformAccountId?: string
) {
  const { error } = await supabase
    .from("ingestion_logs")
    .update({ status: "success", completed_at: new Date().toISOString(), ...stats })
    .eq("id", logId);
  if (error) console.error(`Failed to complete ingestion log ${logId}:`, error.message);

  // Update platform account health
  if (platformAccountId) {
    await supabase
      .from("platform_accounts")
      .update({
        last_success_at: new Date().toISOString(),
        consecutive_failures: 0,
        token_status: "valid",
      })
      .eq("id", platformAccountId);
  }
}

export async function failIngestionLog(
  supabase: ReturnType<typeof createClient>,
  logId: string,
  error: Error | string,
  details?: Record<string, unknown>,
  platformAccountId?: string
) {
  const errorMsg = typeof error === "string" ? error : error.message;
  const { error: updateError } = await supabase
    .from("ingestion_logs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: errorMsg,
      error_details: details || {},
    })
    .eq("id", logId);
  if (updateError) console.error(`Failed to update ingestion log ${logId} as failed:`, updateError.message);

  // Update platform account health
  if (platformAccountId) {
    await supabase
      .from("platform_accounts")
      .update({
        last_error_at: new Date().toISOString(),
        last_error_message: errorMsg,
      })
      .eq("id", platformAccountId);

    // Increment consecutive_failures atomically
    await supabase.rpc("increment_consecutive_failures", {
      p_account_id: platformAccountId,
    });
  }
}

export async function getActiveAccounts(
  supabase: ReturnType<typeof createClient>,
  platform: string
) {
  const { data, error } = await supabase
    .from("platform_accounts")
    .select("*")
    .eq("platform", platform)
    .eq("is_active", true);
  if (error) throw new Error(`Failed to fetch ${platform} accounts: ${error.message}`);
  return data || [];
}

export async function updateLastSynced(
  supabase: ReturnType<typeof createClient>,
  accountId: string
) {
  await supabase
    .from("platform_accounts")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", accountId);
}

export async function upsertContentWithMetrics(
  supabase: ReturnType<typeof createClient>,
  content: {
    platform_account_id: string;
    external_id: string;
    title?: string;
    description?: string;
    content_type: string;
    published_at?: string;
    url?: string;
    thumbnail_url?: string;
    duration_seconds?: number;
    metadata?: Record<string, unknown>;
  },
  metrics: {
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
    clicks?: number;
    engagement_rate?: number;
    watch_time_seconds?: number;
    avg_view_duration_seconds?: number;
    extra_metrics?: Record<string, unknown>;
  }
): Promise<{ created: boolean }> {
  const { data: contentItem, error: contentError } = await supabase
    .from("content_items")
    .upsert(
      { ...content, updated_at: new Date().toISOString() },
      { onConflict: "platform_account_id,external_id" }
    )
    .select("id")
    .single();
  if (contentError) throw new Error(`Content upsert failed: ${contentError.message}`);

  const { error: metricsError } = await supabase
    .from("content_metrics")
    .insert({ content_item_id: contentItem.id, captured_at: new Date().toISOString(), ...metrics });
  if (metricsError && metricsError.code !== "23505") {
    throw new Error(`Metrics insert failed: ${metricsError.message}`);
  }
  return { created: !contentError };
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          const retryAfter = response.headers.get("Retry-After");
          const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : delay;
          console.log(`Retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
      }
      return response;
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`Network error, retrying in ${delay}ms: ${err}`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed after ${maxRetries} retries: ${url}`);
}

export async function checkRateLimit(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  userId: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number }> {
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  const { count } = await supabase
    .from("authenticated_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("bucket", bucket)
    .eq("user_id", userId)
    .gte("created_at", windowStart);
  if ((count || 0) >= maxRequests) return { allowed: false, remaining: 0 };
  await supabase.from("authenticated_rate_limits").insert({ bucket, user_id: userId });
  return { allowed: true, remaining: maxRequests - (count || 0) - 1 };
}

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Returns an array of YYYY-MM-DD strings that are missing between
 * rangeStart and rangeEnd (inclusive) given a set of existing dates.
 */
export function detectMissingDays(
  existingDates: string[],
  rangeStart: string,
  rangeEnd: string,
): string[] {
  const existing = new Set(existingDates);
  const missing: string[] = [];
  const cur = new Date(rangeStart + "T00:00:00Z");
  const end = new Date(rangeEnd + "T00:00:00Z");
  while (cur <= end) {
    const ymd = cur.toISOString().slice(0, 10);
    if (!existing.has(ymd)) missing.push(ymd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return missing;
}

/**
 * Inserts rows into sync_backfill_queue for each missing date,
 * silently skipping duplicates (unique index on account+date).
 */
export async function enqueueBackfills(
  supabase: ReturnType<typeof createClient>,
  platformAccountId: string,
  missingDates: string[],
): Promise<number> {
  if (missingDates.length === 0) return 0;
  const rows = missingDates.map((d) => ({
    platform_account_id: platformAccountId,
    target_date: d,
    status: "pending",
  }));
  // Batch insert; onConflict ignores duplicates
  const { data, error } = await supabase
    .from("sync_backfill_queue")
    .upsert(rows, { onConflict: "platform_account_id,target_date", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("enqueueBackfills error:", error.message);
    return 0;
  }
  return data?.length || 0;
}
