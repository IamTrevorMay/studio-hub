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

async function handleWebhook(req: Request, supabase: any, stripeKey: string) {
  const body = await req.text();
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return errorResponse("Invalid JSON payload", 400);
  }

  const verifyRes = await fetch(`https://api.stripe.com/v1/events/${event.id}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  if (!verifyRes.ok) {
    return errorResponse("Could not verify event with Stripe", 401);
  }
  const verifiedEvent = await verifyRes.json();

  const result = await processStripeEvent(supabase, verifiedEvent);
  return jsonResponse({ received: true, ...result });
}

async function processStripeEvent(supabase: any, event: any) {
  const eventType = event.type;
  const obj = event.data?.object;
  if (!obj) return { skipped: true, reason: "No data object" };

  const { data: existing } = await supabase
    .from("revenue_events")
    .select("id")
    .eq("stripe_event_id", event.id)
    .single();

  if (existing) return { skipped: true, reason: "Duplicate event" };

  switch (eventType) {
    case "charge.succeeded": {
      const productCategory = await categorizeCharge(supabase, obj);
      await supabase.from("revenue_events").insert({
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
      });
      return { processed: "charge.succeeded" };
    }

    case "charge.refunded": {
      await supabase.from("revenue_events").insert({
        stripe_event_id: event.id,
        event_type: "refund",
        amount_cents: -(obj.amount_refunded || obj.amount),
        net_amount_cents: -(obj.amount_refunded || obj.amount),
        currency: obj.currency,
        product_category: "other",
        customer_id: obj.customer,
        occurred_at: new Date(obj.created * 1000).toISOString(),
        metadata: { reason: obj.refunds?.data?.[0]?.reason },
      });
      return { processed: "charge.refunded" };
    }

    case "customer.subscription.created": {
      await supabase.from("revenue_events").insert({
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
      });
      return { processed: "customer.subscription.created" };
    }

    case "customer.subscription.deleted": {
      await supabase.from("revenue_events").insert({
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
      });
      return { processed: "customer.subscription.deleted" };
    }

    case "invoice.paid": {
      if (obj.subscription) {
        await supabase.from("revenue_events").insert({
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
        });
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

    const balRes = await fetchWithRetry(
      `${STRIPE_API}/balance_transactions?created[gte]=${since}&limit=100&type=charge`,
      { headers: stripeHeaders }
    );
    const balData = await balRes.json();

    for (const txn of balData.data || []) {
      const { data: existing } = await supabase
        .from("revenue_events")
        .select("id")
        .eq("stripe_event_id", `bal_${txn.id}`)
        .single();

      if (!existing) {
        await supabase.from("revenue_events").insert({
          stripe_event_id: `bal_${txn.id}`,
          event_type: "charge",
          amount_cents: txn.amount,
          net_amount_cents: txn.net,
          currency: txn.currency,
          product_category: "other",
          product_name: txn.description,
          occurred_at: new Date(txn.created * 1000).toISOString(),
          metadata: { source: "batch_reconciliation", fee: txn.fee },
        });
        processed++;
      }
    }

    const subsRes = await fetchWithRetry(
      `${STRIPE_API}/subscriptions?status=active&limit=100`,
      { headers: stripeHeaders }
    );
    const subsData = await subsRes.json();

    const mrr = (subsData.data || []).reduce((sum: number, sub: any) => {
      const price = sub.items?.data?.[0]?.price;
      if (!price) return sum;
      const amount = price.unit_amount || 0;
      const interval = price.recurring?.interval;
      if (interval === "year") return sum + Math.round(amount / 12);
      if (interval === "month") return sum + amount;
      if (interval === "week") return sum + amount * 4;
      return sum + amount;
    }, 0);

    const today = new Date().toISOString().split("T")[0];
    await supabase.from("audience_snapshots").upsert(
      {
        platform_account_id: account.id,
        date: today,
        followers_total: subsData.data?.length || 0,
        metadata: {
          mrr_cents: mrr,
          active_subscriptions: subsData.data?.length || 0,
        },
      },
      { onConflict: "platform_account_id,date" }
    );

    await updateLastSynced(supabase, account.id);
    await completeIngestionLog(supabase, logId, { records_processed: processed, records_created: processed });

    return jsonResponse({
      success: true,
      batch_processed: processed,
      active_subscriptions: subsData.data?.length || 0,
      mrr_cents: mrr,
    });
  } catch (err) {
    await failIngestionLog(supabase, logId, err as Error);
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
