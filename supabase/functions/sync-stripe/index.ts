// supabase/functions/sync-stripe/index.ts
// Handles Stripe data in two modes:
//   1. WEBHOOK: Real-time event processing (POST with Stripe signature)
//   2. BATCH:   Daily reconciliation job (POST without signature, or GET)

import {
  getSupabaseAdmin,
  getActiveAccounts,
  updateLastSynced,
  startIngestionLog,
  completeIngestionLog,
  failIngestionLog,
  fetchWithRetry,
  jsonResponse,
  errorResponse,
} from "../shared/utils.ts";

const STRIPE_API = "https://api.stripe.com/v1";

Deno.serve(async (req) => {
  try {
    const supabase = getSupabaseAdmin();
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return errorResponse("Missing STRIPE_SECRET_KEY", 500);

    const stripeHeaders = {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };

    const signature = req.headers.get("stripe-signature");
    const isWebhook = !!signature;

    // Auth (non-webhook path only): CRON_SECRET or admin JWT required.
    // Webhook path is authenticated by Stripe signature verification inside handleWebhook.
    if (!isWebhook) {
      const _expected = Deno.env.get("CRON_SECRET");
      const _provided = req.headers.get("x-cron-secret")
        ?? new URL(req.url).searchParams.get("secret");
      const _isCron = !!_expected && _provided === _expected;
      if (!_isCron) {
        const _auth = req.headers.get("Authorization");
        if (!_auth?.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
        const { data: { user: _u } } = await supabase.auth.getUser(_auth.slice(7));
        if (!_u) return errorResponse("Unauthorized", 401);
        const { data: _profile } = await supabase
          .from("profiles").select("role").eq("id", _u.id).single();
        if (_profile?.role !== "admin") return errorResponse("Forbidden", 403);
      }
    }

    if (isWebhook) {
      return await handleWebhook(req, supabase, stripeKey);
    } else {
      return await handleBatchReconciliation(supabase, stripeHeaders);
    }
  } catch (err) {
    console.error("sync-stripe fatal error:", err);
    return errorResponse((err as Error).message);
  }
});

async function handleWebhook(req: Request, supabase: any, _stripeKey: string) {
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) return errorResponse("Missing STRIPE_WEBHOOK_SECRET", 500);

  const body = await req.text();
  const signatureHeader = req.headers.get("stripe-signature") || "";

  const verified = await verifyStripeSignature(body, signatureHeader, webhookSecret);
  if (!verified) return errorResponse("Invalid Stripe signature", 401);

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return errorResponse("Invalid JSON payload", 400);
  }

  const result = await processStripeEvent(supabase, event);
  return jsonResponse({ received: true, ...result });
}

// Stripe webhook signature verification:
// stripe-signature header is `t=<ts>,v1=<hmac>[,v1=<hmac>...]`
// signed payload = `<ts>.<body>`; signature = HMAC-SHA256(payload, secret).
// Reject if no v1 signature matches or timestamp is older than tolerance.
async function verifyStripeSignature(
  body: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  const parts = header.split(",").map((p) => p.trim().split("="));
  const timestamp = parts.find((p) => p[0] === "t")?.[1];
  const signatures = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!timestamp || signatures.length === 0) return false;

  const tsNum = parseInt(timestamp, 10);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > toleranceSeconds) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // constant-time compare against each provided signature
  return signatures.some((sig) => constantTimeEqual(sig, expected));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function processStripeEvent(supabase: any, event: any) {
  const eventType = event.type;
  const obj = event.data?.object;
  if (!obj) return { skipped: true, reason: "No data object" };

  // Idempotency: rely on unique(stripe_event_id) + upsert ignoreDuplicates,
  // so Stripe retries can't double-insert under concurrent delivery.

  switch (eventType) {
    case "charge.succeeded": {
      const productCategory = await categorizeCharge(supabase, obj);
      await supabase.from("revenue_events").upsert({
        stripe_event_id: event.id,
        event_type: "charge",
        amount_cents: obj.amount,
        net_amount_cents: obj.amount - (obj.application_fee_amount || 0),
        currency: obj.currency,
        product_category: productCategory,
        product_name: obj.description || obj.statement_descriptor,
        customer_id: obj.customer,
        is_recurring: !!obj.invoice,
        occurred_at: new Date(obj.created * 1000).toISOString(),
        metadata: {
          payment_method_type: obj.payment_method_details?.type,
          receipt_url: obj.receipt_url,
        },
      }, { onConflict: "stripe_event_id", ignoreDuplicates: true });
      return { processed: "charge.succeeded" };
    }

    case "charge.refunded": {
      await supabase.from("revenue_events").upsert({
        stripe_event_id: event.id,
        event_type: "refund",
        amount_cents: -(obj.amount_refunded || obj.amount),
        net_amount_cents: -(obj.amount_refunded || obj.amount),
        currency: obj.currency,
        product_category: "other",
        customer_id: obj.customer,
        occurred_at: new Date(obj.created * 1000).toISOString(),
        metadata: { reason: obj.refunds?.data?.[0]?.reason },
      }, { onConflict: "stripe_event_id", ignoreDuplicates: true });
      return { processed: "charge.refunded" };
    }

    case "customer.subscription.created": {
      await supabase.from("revenue_events").upsert({
        stripe_event_id: event.id,
        event_type: "subscription_start",
        amount_cents: obj.items?.data?.[0]?.price?.unit_amount || 0,
        net_amount_cents: obj.items?.data?.[0]?.price?.unit_amount || 0,
        currency: obj.currency,
        product_category: "subscription",
        product_name: obj.items?.data?.[0]?.price?.nickname || obj.items?.data?.[0]?.plan?.nickname,
        price_id: obj.items?.data?.[0]?.price?.id,
        customer_id: obj.customer,
        subscription_id: obj.id,
        is_recurring: true,
        occurred_at: new Date(obj.created * 1000).toISOString(),
        metadata: {
          status: obj.status,
          interval: obj.items?.data?.[0]?.price?.recurring?.interval,
        },
      }, { onConflict: "stripe_event_id", ignoreDuplicates: true });
      return { processed: "customer.subscription.created" };
    }

    case "customer.subscription.deleted": {
      await supabase.from("revenue_events").upsert({
        stripe_event_id: event.id,
        event_type: "subscription_cancel",
        amount_cents: 0,
        net_amount_cents: 0,
        currency: obj.currency || "usd",
        product_category: "subscription",
        product_name: obj.items?.data?.[0]?.price?.nickname,
        customer_id: obj.customer,
        subscription_id: obj.id,
        is_recurring: false,
        occurred_at: new Date((obj.canceled_at || obj.ended_at || Date.now() / 1000) * 1000).toISOString(),
        metadata: {
          cancel_reason: obj.cancellation_details?.reason,
          cancel_feedback: obj.cancellation_details?.feedback,
        },
      }, { onConflict: "stripe_event_id", ignoreDuplicates: true });
      return { processed: "customer.subscription.deleted" };
    }

    case "invoice.paid": {
      if (obj.subscription) {
        await supabase.from("revenue_events").upsert({
          stripe_event_id: event.id,
          event_type: "subscription_renewal",
          amount_cents: obj.amount_paid,
          net_amount_cents: obj.amount_paid,
          currency: obj.currency,
          product_category: "subscription",
          product_name: obj.lines?.data?.[0]?.description,
          customer_id: obj.customer,
          subscription_id: obj.subscription,
          is_recurring: true,
          occurred_at: new Date(obj.created * 1000).toISOString(),
          metadata: { invoice_url: obj.hosted_invoice_url },
        }, { onConflict: "stripe_event_id", ignoreDuplicates: true });
        return { processed: "invoice.paid (renewal)" };
      }
      return { skipped: true, reason: "Non-subscription invoice" };
    }

    default:
      return { skipped: true, reason: `Unhandled event type: ${eventType}` };
  }
}

async function handleBatchReconciliation(supabase: any, stripeHeaders: Record<string, string>) {
  const accounts = await getActiveAccounts(supabase, "stripe");
  if (accounts.length === 0) return jsonResponse({ message: "No active Stripe accounts" });

  const account = accounts[0];
  const logId = await startIngestionLog(supabase, account.id, "revenue_sync");
  let processed = 0;

  try {
    const since = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);

    // Paginate balance_transactions — Stripe caps each page at 100, so any 48h
    // window with >100 charges would silently drop revenue rows without this loop.
    let balStartingAfter: string | null = null;
    do {
      const params = new URLSearchParams({ "created[gte]": String(since), limit: "100", type: "charge" });
      if (balStartingAfter) params.set("starting_after", balStartingAfter);
      const balRes = await fetchWithRetry(
        `${STRIPE_API}/balance_transactions?${params.toString()}`,
        { headers: stripeHeaders }
      );
      const balData = await balRes.json();
      if (!balRes.ok || balData.error) {
        throw new Error(`Stripe balance_transactions failed: HTTP ${balRes.status} ${balData.error?.message || ""}`);
      }
      const batch = balData.data || [];
      for (const txn of batch) {
        await supabase.from("revenue_events").upsert({
          stripe_event_id: `bal_${txn.id}`,
          event_type: "charge",
          amount_cents: txn.amount,
          net_amount_cents: txn.net,
          currency: txn.currency,
          product_category: "other",
          product_name: txn.description,
          occurred_at: new Date(txn.created * 1000).toISOString(),
          metadata: { source: "batch_reconciliation", fee: txn.fee },
        }, { onConflict: "stripe_event_id", ignoreDuplicates: true });
        processed++;
      }
      balStartingAfter = balData.has_more && batch.length > 0 ? batch[batch.length - 1].id : null;
    } while (balStartingAfter);

    // Paginate active subscriptions for MRR — same 100/page cap as above.
    let mrr = 0;
    let activeSubs = 0;
    let subStartingAfter: string | null = null;
    do {
      const params = new URLSearchParams({ status: "active", limit: "100" });
      if (subStartingAfter) params.set("starting_after", subStartingAfter);
      const subsRes = await fetchWithRetry(
        `${STRIPE_API}/subscriptions?${params.toString()}`,
        { headers: stripeHeaders }
      );
      const subsData = await subsRes.json();
      if (!subsRes.ok || subsData.error) {
        throw new Error(`Stripe subscriptions failed: HTTP ${subsRes.status} ${subsData.error?.message || ""}`);
      }
      const subs = subsData.data || [];
      for (const sub of subs) {
        const price = sub.items?.data?.[0]?.price;
        if (!price) continue;
        const amount = price.unit_amount || 0;
        const interval = price.recurring?.interval;
        if (interval === "year") mrr += Math.round(amount / 12);
        else if (interval === "week") mrr += amount * 4;
        else mrr += amount; // month or unknown
      }
      activeSubs += subs.length;
      subStartingAfter = subsData.has_more && subs.length > 0 ? subs[subs.length - 1].id : null;
    } while (subStartingAfter);

    const today = new Date().toISOString().split("T")[0];
    await supabase.from("audience_snapshots").upsert(
      {
        platform_account_id: account.id,
        date: today,
        followers_total: activeSubs,
        metadata: {
          mrr_cents: mrr,
          active_subscriptions: activeSubs,
        },
      },
      { onConflict: "platform_account_id,date" }
    );

    await updateLastSynced(supabase, account.id);
    await completeIngestionLog(supabase, logId, { records_processed: processed, records_created: processed }, account.id);

    // Refresh the materialized view so dashboards pick up new data
    try { await supabase.rpc("refresh_daily_platform_rollups"); }
    catch (e) { console.error("Rollups refresh failed:", e); }

    return jsonResponse({
      success: true,
      batch_processed: processed,
      active_subscriptions: subsData.data?.length || 0,
      mrr_cents: mrr,
    });
  } catch (err) {
    await failIngestionLog(supabase, logId, err as Error, undefined, account.id);
    return errorResponse((err as Error).message);
  }
}

async function categorizeCharge(supabase: any, charge: any): Promise<string> {
  if (charge.invoice) return "subscription";
  const productMeta = charge.metadata?.product_category;
  if (productMeta === "merch") return "merch";
  if (productMeta === "subscription") return "subscription";
  return charge.subscription ? "subscription" : "merch";
}
