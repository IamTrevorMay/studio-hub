// supabase/functions/plaid-sync/index.ts
// Deploy with: supabase functions deploy plaid-sync --no-verify-jwt
// Pulls transactions from every linked Plaid item (cursor-based
// /transactions/sync), categorizes them (rules → Claude → Uncategorized),
// flags inter-account transfers, snapshots balances, and writes into
// revenue_transactions / expense_transactions alongside Tiller history.
// Cron: nightly. Manual: Accounting page refresh button.
//
// Cutover guard: transactions dated before PLAID_CUTOVER_DATE are ignored so
// Plaid rows never overlap the Tiller-synced history.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin tier = admin + director (mirrors the DB is_admin() helper and the
// client-side isAdminTier). Directors are restricted in the UI, not here.
const ADMIN_TIER = ["admin", "director"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLAID_BASE: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

function plaidUrl(path: string): string {
  const env = Deno.env.get("PLAID_ENV") || "sandbox";
  return `${PLAID_BASE[env] || PLAID_BASE.sandbox}${path}`;
}

async function plaidPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(plaidUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("PLAID_CLIENT_ID"),
      secret: Deno.env.get("PLAID_SECRET"),
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error_message || `Plaid ${path} failed`);
    (err as any).plaid_error_code = json.error_code;
    throw err;
  }
  return json;
}

// Mirrors sync-tiller whitelists — Mayday's category taxonomy. AI suggestions
// are constrained to these; Neptune is freeform (existing categories offered
// as suggestions but new ones allowed).
const MAYDAY_INCOME_CATEGORIES = [
  "YouTube Income", "TikTok Income", "Twitch Income", "Substack Income",
  "Sponsorship Income", "Merch Income", "Facebook Income", "Services",
  "Production Services",
];
const MAYDAY_EXPENSE_CATEGORIES = [
  "Employees", "Rent & Utilities", "Equipment", "Equipment - Neptune",
  "R&D/Production", "Travel", "Admin Subscriptions", "Creative Subscriptions",
  "Insurance", "Contractors", "Misc Expense", "Administration", "Supplies",
  "Entertainment/Fun", "Medical", "Food", "Bank Fees", "Taxes",
];

const TRANSFER_PAIR_WINDOW_DAYS = 3;

type PendingTxn = {
  plaid_transaction_id: string;
  transaction_id: string;
  date: string;
  description: string;
  amount_cents: number;   // always positive
  kind: "revenue" | "expense";
  account: string | null;
  linked_account_id: string;
  business: string;
  pfc_primary: string | null;
  is_transfer: boolean;
  category: string | null;
  categorized_by: string | null;
};

function ptToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function daysBetween(a: string, b: string): number {
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth: CRON_SECRET (header or query) or admin JWT required
  {
    const _expected = Deno.env.get("CRON_SECRET");
    const _provided = req.headers.get("x-cron-secret")
      ?? new URL(req.url).searchParams.get("secret");
    const _isCron = !!_expected && _provided === _expected;
    if (!_isCron) {
      const _auth = req.headers.get("Authorization");
      if (!_auth?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const _adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: { user: _u } } = await _adminClient.auth.getUser(_auth.slice(7));
      if (!_u) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: _profile } = await _adminClient
        .from("profiles").select("role").eq("id", _u.id).single();
      if (!ADMIN_TIER.includes(_profile?.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const cutoverDate = Deno.env.get("PLAID_CUTOVER_DATE") || "2026-07-01";

    const { data: items } = await supabase.from("plaid_items").select("*");
    const { data: accounts } = await supabase.from("linked_accounts").select("*");
    const accountsByPlaidId = new Map((accounts || []).map((a) => [a.plaid_account_id, a]));

    const { data: rules } = await supabase
      .from("category_rules").select("*")
      .order("priority", { ascending: false });

    const summary = {
      items_synced: 0, items_failed: 0, added: 0, modified: 0,
      removed: 0, transfers: 0, ai_categorized: 0, skipped_unknown_account: 0,
    };
    const pending: PendingTxn[] = [];
    const removedIds: string[] = [];

    for (const item of items || []) {
      try {
        // ── Transactions (cursor loop) ──
        let cursor: string | null = item.sync_cursor;
        // Plaid gotcha: syncing before the item's initial pull completes
        // returns an empty page + a cursor that skips history. If we hold a
        // cursor but have zero rows for this item's accounts, restart from
        // the beginning (dedup by plaid_transaction_id makes this safe).
        if (cursor) {
          const itemAccountIds = (accounts || [])
            .filter((a) => a.item_id === item.id).map((a) => a.id);
          if (itemAccountIds.length > 0) {
            const [{ count: revCount }, { count: expCount }] = await Promise.all([
              supabase.from("revenue_transactions")
                .select("id", { count: "exact", head: true })
                .in("linked_account_id", itemAccountIds),
              supabase.from("expense_transactions")
                .select("id", { count: "exact", head: true })
                .in("linked_account_id", itemAccountIds),
            ]);
            if ((revCount || 0) + (expCount || 0) === 0) cursor = null;
          }
        }
        let hasMore = true;
        while (hasMore) {
          const page = await plaidPost("/transactions/sync", {
            access_token: item.access_token,
            cursor: cursor || undefined,
            count: 500,
          });
          for (const txn of [...(page.added || []), ...(page.modified || [])]) {
            if (txn.pending) continue;
            if (txn.date < cutoverDate) continue;
            const acct = accountsByPlaidId.get(txn.account_id);
            if (!acct) {
              // Unseen account (added at the bank after linking): register it
              // inactive so it appears in the Accounts tab for assignment.
              summary.skipped_unknown_account++;
              await supabase.from("linked_accounts").upsert({
                item_id: item.id, plaid_account_id: txn.account_id,
                business: "mayday_media", is_active: false,
              }, { onConflict: "plaid_account_id", ignoreDuplicates: true });
              continue;
            }
            if (!acct.is_active) continue;
            const cents = Math.round(Math.abs(txn.amount) * 100);
            if (cents === 0) continue;
            const pfc = txn.personal_finance_category?.primary || null;
            pending.push({
              plaid_transaction_id: txn.transaction_id,
              transaction_id: `plaid_${txn.transaction_id}`,
              date: txn.date,
              description: txn.merchant_name || txn.name || "(no description)",
              amount_cents: cents,
              // Plaid: positive amount = money out of the account
              kind: txn.amount > 0 ? "expense" : "revenue",
              account: [acct.name, acct.mask].filter(Boolean).join(" ·"),
              linked_account_id: acct.id,
              business: acct.business,
              pfc_primary: pfc,
              is_transfer: !!pfc && pfc.startsWith("TRANSFER"),
              category: null,
              categorized_by: null,
            });
          }
          for (const r of page.removed || []) {
            if (r.transaction_id) removedIds.push(r.transaction_id);
          }
          cursor = page.next_cursor;
          hasMore = page.has_more;
        }

        // ── Balances snapshot ──
        const balRes = await plaidPost("/accounts/get", { access_token: item.access_token });
        const snapshotDate = ptToday();
        const balRows = (balRes.accounts || [])
          .filter((a: Record<string, any>) => accountsByPlaidId.has(a.account_id))
          .map((a: Record<string, any>) => ({
            linked_account_id: accountsByPlaidId.get(a.account_id).id,
            balance_cents: a.balances?.current != null ? Math.round(a.balances.current * 100) : null,
            available_cents: a.balances?.available != null ? Math.round(a.balances.available * 100) : null,
            snapshot_date: snapshotDate,
          }));
        if (balRows.length > 0) {
          await supabase.from("account_balances")
            .upsert(balRows, { onConflict: "linked_account_id,snapshot_date" });
        }

        await supabase.from("plaid_items").update({
          sync_cursor: cursor, last_synced_at: new Date().toISOString(),
          status: "ok", error_code: null,
        }).eq("id", item.id);
        summary.items_synced++;
      } catch (err) {
        console.error(`Item ${item.item_id} sync failed:`, err);
        const code = (err as any).plaid_error_code || "SYNC_FAILED";
        await supabase.from("plaid_items").update({
          status: code === "ITEM_LOGIN_REQUIRED" ? "relink_required" : "error",
          error_code: code,
        }).eq("id", item.id);
        summary.items_failed++;
      }
    }

    // ── Transfer detection: +/− pairs across own accounts ──
    // PFC-flagged transfers are already marked; this catches unlabeled pairs
    // (same amount, opposite direction, different accounts, within N days).
    const byAmount = new Map<number, PendingTxn[]>();
    for (const t of pending) {
      if (!byAmount.has(t.amount_cents)) byAmount.set(t.amount_cents, []);
      byAmount.get(t.amount_cents)!.push(t);
    }
    for (const group of byAmount.values()) {
      const outs = group.filter((t) => t.kind === "expense" && !t.is_transfer);
      const ins = group.filter((t) => t.kind === "revenue" && !t.is_transfer);
      for (const out of outs) {
        const match = ins.find((i) =>
          !i.is_transfer &&
          i.linked_account_id !== out.linked_account_id &&
          daysBetween(i.date, out.date) <= TRANSFER_PAIR_WINDOW_DAYS
        );
        if (match) { out.is_transfer = true; match.is_transfer = true; }
      }
    }

    // ── Categorization: transfer → rules → Claude ──
    for (const t of pending) {
      if (t.is_transfer) {
        t.category = "Transfer";
        t.categorized_by = "rule";
        summary.transfers++;
        continue;
      }
      const desc = t.description.toUpperCase();
      const rule = (rules || []).find((r) =>
        r.txn_kind === t.kind &&
        (!r.business || r.business === t.business) &&
        (r.match_type === "exact"
          ? desc === r.pattern.toUpperCase()
          : desc.includes(r.pattern.toUpperCase()))
      );
      if (rule) {
        t.category = rule.category;
        t.categorized_by = "rule";
      }
    }

    // Claude pass for whatever rules didn't catch
    const uncat = pending.filter((t) => !t.category);
    if (uncat.length > 0) {
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
      // Existing Neptune categories keep AI suggestions consistent
      const { data: neptuneCats } = await supabase
        .from("expense_transactions").select("category")
        .eq("business", "neptune_performance").limit(1000);
      const neptuneExisting = [...new Set((neptuneCats || []).map((r) => r.category))];

      for (let i = 0; i < uncat.length && anthropicKey; i += 50) {
        const chunk = uncat.slice(i, i + 50);
        try {
          const prompt = [
            "Categorize these bank transactions for a creator business. Respond ONLY with a JSON array of category strings, one per transaction, same order.",
            "",
            "For business=mayday_media, revenue MUST be one of: " + JSON.stringify(MAYDAY_INCOME_CATEGORIES),
            "For business=mayday_media, expense MUST be one of: " + JSON.stringify(MAYDAY_EXPENSE_CATEGORIES),
            "For business=neptune_performance (a baseball training facility), prefer these existing categories: " + JSON.stringify(neptuneExisting) + " but a new sensible category name is allowed.",
            "If genuinely unknowable, use \"Uncategorized\".",
            "",
            "Transactions:",
            JSON.stringify(chunk.map((t) => ({
              description: t.description, amount: t.amount_cents / 100,
              kind: t.kind, business: t.business, plaid_hint: t.pfc_primary,
            }))),
          ].join("\n");
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6",
              max_tokens: 4000,
              messages: [{ role: "user", content: prompt }],
            }),
          });
          const json = await res.json();
          const text = json.content?.[0]?.text || "[]";
          const cats = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
          chunk.forEach((t, idx) => {
            const cat = typeof cats[idx] === "string" ? cats[idx] : "Uncategorized";
            t.category = cat;
            t.categorized_by = "ai";
            summary.ai_categorized++;
          });
        } catch (err) {
          console.error("Claude categorization failed for chunk:", err);
        }
      }
      // Anything Claude didn't reach
      for (const t of uncat) {
        if (!t.category) { t.category = "Uncategorized"; t.categorized_by = "ai"; }
      }
    }

    // ── Write ──
    // Existing rows keep their category (manual fixes survive re-syncs) —
    // only amount/date/description refresh on modified transactions.
    const existingIds = new Set<string>();
    for (const table of ["revenue_transactions", "expense_transactions"]) {
      const ids = pending.map((t) => t.plaid_transaction_id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from(table)
          .select("plaid_transaction_id")
          .in("plaid_transaction_id", ids.slice(i, i + 200));
        (data || []).forEach((r) => existingIds.add(r.plaid_transaction_id));
      }
    }

    for (const t of pending) {
      const table = t.kind === "revenue" ? "revenue_transactions" : "expense_transactions";
      const otherTable = t.kind === "revenue" ? "expense_transactions" : "revenue_transactions";
      if (existingIds.has(t.plaid_transaction_id)) {
        await supabase.from(table).update({
          date: t.date, description: t.description, amount_cents: t.amount_cents,
          last_seen_at: new Date().toISOString(),
        }).eq("plaid_transaction_id", t.plaid_transaction_id);
        // Sign flips move a txn between tables (rare)
        await supabase.from(otherTable).delete().eq("plaid_transaction_id", t.plaid_transaction_id);
        summary.modified++;
      } else {
        const { error } = await supabase.from(table).insert({
          transaction_id: t.transaction_id,
          plaid_transaction_id: t.plaid_transaction_id,
          date: t.date, description: t.description, amount_cents: t.amount_cents,
          account: t.account, business: t.business,
          linked_account_id: t.linked_account_id,
          source: "plaid",
          category: t.category || "Uncategorized",
          categorized_by: t.categorized_by || "ai",
          review_status: t.categorized_by === "rule" && !t.is_transfer ? "confirmed" : "auto",
          is_transfer: t.is_transfer,
          last_seen_at: new Date().toISOString(),
        });
        if (error) console.error("Insert failed:", error.message, t.transaction_id);
        else summary.added++;
      }
    }

    if (removedIds.length > 0) {
      for (const table of ["revenue_transactions", "expense_transactions"]) {
        const { count } = await supabase.from(table)
          .delete({ count: "exact" })
          .in("plaid_transaction_id", removedIds);
        summary.removed += count || 0;
      }
    }

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("plaid-sync error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
