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
  await supabase
    .from("ingestion_logs")
    .update({ status: "success", completed_at: new Date().toISOString(), ...stats })
    .eq("id", logId);

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
  await supabase
    .from("ingestion_logs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: errorMsg,
      error_details: details || {},
    })
    .eq("id", logId);

  // Update platform account health
  if (platformAccountId) {
    await supabase
      .from("platform_accounts")
      .update({
        last_error_at: new Date().toISOString(),
        last_error_message: errorMsg,
      })
      .eq("id", platformAccountId);

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
