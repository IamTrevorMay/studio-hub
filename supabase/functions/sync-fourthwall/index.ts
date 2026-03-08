// supabase/functions/sync-fourthwall/index.ts
// Deploy with: supabase functions deploy sync-fourthwall --no-verify-jwt
// Pulls orders from Fourthwall Open API and writes to revenue_events
// Each order becomes a revenue_event with product_category = 'merch'

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_BASE = "https://api.fourthwall.com/open-api/v1.0";
const PAGE_SIZE = 50;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Fetch a page of orders from the Fourthwall API
 */
async function fetchOrders(
  auth: string,
  params: Record<string, string>,
): Promise<{ results: any[]; total: number; totalPages: number }> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/order?${qs}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Accept-Encoding": "gzip",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fourthwall API ${res.status}: ${text}`);
  }
  return await res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const username = Deno.env.get("FOURTHWALL_USERNAME");
  const password = Deno.env.get("FOURTHWALL_PASSWORD");
  if (!username || !password) {
    return jsonResponse({ error: "Fourthwall credentials not configured" }, 500);
  }

  const auth = btoa(`${username}:${password}`);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Load Fourthwall account
  const { data: account, error: accountError } = await supabase
    .from("platform_accounts")
    .select("*")
    .eq("platform", "fourthwall")
    .eq("is_active", true)
    .single();

  if (accountError || !account) {
    return jsonResponse({ error: "No active Fourthwall account found" }, 404);
  }

  // Start ingestion log
  const { data: logEntry } = await supabase
    .from("ingestion_logs")
    .insert({
      platform_account_id: account.id,
      job_type: "fourthwall_sync",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  const logId = logEntry?.id;
  const errors: Record<string, string> = {};
  const results: Record<string, unknown> = {};

  try {
    // Determine start date: last sync or 2 years ago
    const lastSynced = account.last_synced_at;
    const sinceDate = lastSynced
      ? new Date(new Date(lastSynced).getTime() - 7 * 86400000).toISOString() // overlap 7 days for safety
      : new Date(Date.now() - 730 * 86400000).toISOString();

    // Paginate through all orders since last sync
    let page = 0;
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalOrders = 0;
    const revenueRows: any[] = [];

    while (true) {
      const data = await fetchOrders(auth, {
        page: String(page),
        size: String(PAGE_SIZE),
        "createdAt[gt]": sinceDate,
      });

      totalOrders = data.total;

      for (const order of data.results) {
        // Skip cancelled orders
        if (order.status === "CANCELLED") continue;

        const orderId = order.id;
        const occurredAt = order.createdAt;
        const amounts = order.amounts || {};
        const totalAmount = amounts.total?.value || 0;
        const subtotal = amounts.subtotal?.value || 0;
        const shipping = amounts.shipping?.value || 0;
        const tax = amounts.tax?.value || 0;
        const discount = amounts.discount?.value || 0;
        const donation = amounts.donation?.value || 0;
        const currency = amounts.total?.currency || "USD";

        // Net revenue = subtotal minus discount (what the creator earns before costs)
        const netAmountCents = Math.round((subtotal - discount) * 100);
        const amountCents = Math.round(totalAmount * 100);

        // Build product name from offers
        const offerNames = (order.offers || [])
          .map((o: any) => o.name)
          .filter(Boolean)
          .join(", ");

        revenueRows.push({
          stripe_event_id: `fw_${orderId}`, // reuse field as external_id
          event_type: "charge",
          amount_cents: amountCents,
          net_amount_cents: netAmountCents,
          currency,
          product_category: "merch",
          product_id: orderId,
          product_name: offerNames || "Fourthwall Order",
          customer_id: order.email || null,
          is_recurring: false,
          occurred_at: occurredAt,
          platform_account_id: account.id,
          metadata: {
            source: "fourthwall",
            friendly_id: order.friendlyId,
            status: order.status,
            subtotal,
            shipping,
            tax,
            discount,
            donation,
            items: (order.offers || []).map((o: any) => ({
              name: o.name,
              variant: o.variant?.name,
              quantity: o.variant?.quantity || 1,
              unit_price: o.variant?.unitPrice?.value,
              unit_cost: o.variant?.unitCost?.value,
            })),
          },
        });

        totalProcessed++;
      }

      // Check if more pages
      if (page >= data.totalPages - 1) break;
      page++;
    }

    // Upsert revenue events (deduplicate on stripe_event_id which we use as fw_<orderId>)
    if (revenueRows.length > 0) {
      // Process in batches of 100
      for (let i = 0; i < revenueRows.length; i += 100) {
        const batch = revenueRows.slice(i, i + 100);
        const { error: upsertError, data: upserted } = await supabase
          .from("revenue_events")
          .upsert(batch, { onConflict: "stripe_event_id" })
          .select("id");
        if (upsertError) {
          errors[`upsert_batch_${i}`] = upsertError.message;
        } else {
          totalCreated += upserted?.length || 0;
        }
      }
    }

    results.total_orders_fetched = totalOrders;
    results.orders_processed = totalProcessed;
    results.revenue_events_upserted = totalCreated;
    results.since = sinceDate;

    // Update last_synced_at
    await supabase
      .from("platform_accounts")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", account.id);

    // Refresh materialized view
    try {
      await supabase.rpc("refresh_daily_platform_rollups");
      results.rollups_refreshed = true;
    } catch (e) {
      results.rollups_refreshed = false;
      errors.rollups = (e as Error).message;
    }

    // Complete ingestion log
    if (logId) {
      await supabase
        .from("ingestion_logs")
        .update({
          status: "success",
          records_processed: totalProcessed,
          records_created: totalCreated,
          completed_at: new Date().toISOString(),
          metadata: {
            total_orders: totalOrders,
            since: sinceDate,
            ...(Object.keys(errors).length > 0 ? { partial_errors: errors } : {}),
          },
        })
        .eq("id", logId);
    }

    return jsonResponse({
      ok: true,
      results,
      ...(Object.keys(errors).length > 0 ? { partial_errors: errors } : {}),
    });
  } catch (err) {
    console.error("sync-fourthwall fatal error:", err);

    if (logId) {
      try {
        await supabase
          .from("ingestion_logs")
          .update({
            status: "failed",
            error_message: (err as Error).message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", logId);
      } catch (_) {
        // ignore
      }
    }

    return jsonResponse(
      {
        ok: false,
        error: (err as Error).message,
        partial_errors: errors,
        partial_results: results,
      },
      500,
    );
  }
});
