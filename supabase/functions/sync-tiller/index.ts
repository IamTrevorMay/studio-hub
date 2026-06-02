// supabase/functions/sync-tiller/index.ts
// Deploy with: supabase functions deploy sync-tiller --no-verify-jwt
// Reads transactions from one Tiller Google Sheet per business and upserts them
// into revenue_transactions / expense_transactions, tagged by business.
// Cron: daily at 7am UTC
//
// Each source is reconciled independently: after a successful pull, any
// Tiller-sourced row for that business not stamped in this run is deleted
// (removed from the sheet, or a leftover from an older id scheme). A source
// that fails to fetch/parse is skipped without touching its existing data and
// without aborting the other sources.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Mayday Media income categories. Used only by the "whitelist" categoryMode.
const INCOME_CATEGORIES = new Set([
  "YouTube Income",
  "TikTok Income",
  "Twitch Income",
  "Substack Income",
  "Sponsorship Income",
  "Merch Income",
  "Facebook Income",
  "Services",
]);

// Mayday Media operating expense categories. Excludes financing (Funding, Loan
// Repayment), offsets (Reimbursement), and net-positive bookkeeping (Interest)
// so the Expenses page reflects actual outflows. New Tiller categories that
// should be tracked need to be added here AND in EXPENSE_CATEGORY_META in
// src/pages/Accounting.js.
const EXPENSE_CATEGORIES = new Set([
  "Employees",
  "Rent & Utilities",
  "Equipment",
  "Equipment - Neptune",
  "R&D/Production",
  "Travel",
  "Admin Subscriptions",
  "Creative Subscriptions",
  "Insurance",
  "Freelancers",
  "Misc Expense",
  "Administration",
  "Supplies",
  "Entertainment/Fun",
  "Medical",
  "Food",
  "Bank Fees",
  "Taxes",
]);

// Non-operating categories excluded from sign-based sources (Neptune). These
// are capital movements / offsets, not earned income or real outflows: counting
// owner funding as "revenue" or transfers as "expense" would distort the P&L.
// Matched case-insensitively. Mirrors the exclusions baked into Mayday's
// income/expense whitelists.
const EXCLUDED_CATEGORIES = new Set([
  "funding",
  "loan repayment",
  "loan payment",
  "reimbursement",
  "interest",
  "transfer",
  "transfers",
  "internal transfer",
  "owner draw",
  "owner's draw",
  "owner contribution",
  "owner's contribution",
  "capital contribution",
  "credit card payment",
]);

type FixedColumns = { headerRow: number; date: number; description: number; category: number; amount: number; account: number };

type Source = {
  business: string;
  spreadsheetId: string;
  // Identify the tab either by name or by gid (resolved to a name at runtime).
  sheetName?: string;
  gid?: number;
  // "whitelist": split income/expense by the category sets above (Mayday).
  // "sign": every positive row is income, every negative row is expense, all
  //         categories kept as-is (Neptune — its category taxonomy is its own).
  categoryMode: "whitelist" | "sign";
  // Fixed column layout, or "detect" to find columns from the header row.
  columns: FixedColumns | "detect";
  // Prefix for transaction_id. Keeps ids unique across businesses; Mayday keeps
  // the bare "tiller" prefix so its existing rows are not re-churned.
  idPrefix: string;
};

const SOURCES: Source[] = [
  {
    business: "mayday_media",
    spreadsheetId: "1xbF4vHvt1d_VBAW4gpm7fu6D084CMFm-XQ_WDGoEAGA",
    sheetName: "Transactions",
    categoryMode: "whitelist",
    // This sheet has a leading empty column A; data starts in column B.
    columns: { headerRow: 0, date: 1, description: 2, category: 3, amount: 4, account: 5 },
    idPrefix: "tiller",
  },
  {
    business: "neptune_performance",
    spreadsheetId: "1WcGvRGfSeFLTt5geWRqMZnFWzk5okJo5Nne3Ng6lSW8",
    gid: 604913285,
    categoryMode: "sign",
    columns: "detect",
    idPrefix: "tiller_neptune",
  },
];

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const refreshToken = Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN")!;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokens = await res.json();
  if (!res.ok) throw new Error(tokens.error_description || "Token refresh failed");
  return tokens.access_token;
}

// The Google account the sync authenticates as — surfaced in the response so a
// 403 on a sheet tells you exactly which account needs to be granted access.
async function getAccountEmail(token: string): Promise<string | null> {
  try {
    const resp = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return (await resp.json())?.user?.emailAddress ?? null;
  } catch {
    return null;
  }
}

function parseAmount(raw: string): number {
  // Remove $, commas, quotes, and whitespace, then parse
  const cleaned = (raw || "").replace(/[$,"'\s]/g, "");
  const value = parseFloat(cleaned);
  if (isNaN(value)) return 0;
  return Math.round(value * 100); // store as cents
}

function parseDate(raw: string): string | null {
  // Tiller dates are M/D/YYYY format
  const parts = (raw || "").split("/");
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  if (!m || !d || !y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Resolve a tab's title from its gid via the spreadsheet metadata endpoint.
async function resolveSheetName(spreadsheetId: string, gid: number, token: string): Promise<string> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Sheets metadata error ${resp.status}: ${await resp.text()}`);
  const meta = await resp.json();
  const sheet = (meta.sheets || []).find((s: { properties?: { sheetId?: number } }) => s.properties?.sheetId === gid);
  if (!sheet?.properties?.title) throw new Error(`No sheet with gid ${gid}`);
  return sheet.properties.title as string;
}

// Find column indices from a Tiller header row (Date / Description / Category /
// Amount / Account). Scans the first several rows so a layout with leading
// blank/title rows still works.
function detectColumns(rows: string[][]): FixedColumns | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] || []).map((c) => (c || "").trim().toLowerCase());
    const date = cells.indexOf("date");
    const amount = cells.indexOf("amount");
    if (date === -1 || amount === -1) continue;
    const find = (...names: string[]) => {
      for (const n of names) { const idx = cells.indexOf(n); if (idx !== -1) return idx; }
      return -1;
    };
    return {
      headerRow: i,
      date,
      amount,
      description: find("description", "full description", "name"),
      category: find("category"),
      account: find("account", "account name"),
    };
  }
  return null;
}

type Tx = {
  transaction_id: string;
  date: string;
  description: string;
  category: string;
  amount_cents: number;
  account: string;
  business: string;
  last_seen_at: string;
};

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
      if (_profile?.role !== "admin") {
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

    // Single timestamp for this run. Every upserted row is stamped with it;
    // anything for a freshly-pulled business not stamped this run is pruned.
    const runStamp = new Date().toISOString();
    const accessToken = await getAccessToken();
    const account = await getAccountEmail(accessToken);

    async function upsertBatched(table: string, txs: Tx[]): Promise<{ upserted: number; errors: number }> {
      let upserted = 0, errors = 0;
      for (let i = 0; i < txs.length; i += 200) {
        const batch = txs.slice(i, i + 200);
        const { error, data: result } = await supabase
          .from(table)
          .upsert(batch, { onConflict: "transaction_id" })
          .select("id");
        if (error) {
          errors++;
          console.error(`${table} upsert error:`, error.message);
        } else {
          upserted += result?.length || 0;
        }
      }
      return { upserted, errors };
    }

    // Delete rows for this business not stamped in this run. Guarded by:
    //   - sourceParsed===0 → skip (a bad pull can't wipe data)
    //   - any upsert error → skip
    //   - >20% drop vs prior row count → skip (truncated Sheets response,
    //     partial network read, etc. would otherwise blow away real rows).
    //     Cold-start (existing <= 5) is exempt; the threshold is for stable
    //     tables with meaningful history.
    async function reconcile(table: string, business: string, sourceParsed: number, errors: number): Promise<number> {
      if (sourceParsed === 0 || errors > 0) {
        console.log(`${table}/${business} reconcile skipped (sourceParsed=${sourceParsed}, errors=${errors})`);
        return 0;
      }
      const { count: existing } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("business", business);
      if ((existing || 0) > 5 && sourceParsed < (existing || 0) * 0.8) {
        console.warn(
          `${table}/${business} reconcile BAILED: sourceParsed=${sourceParsed} vs existing=${existing} (>20% drop). ` +
          `Likely truncated Tiller pull; refusing to delete.`,
        );
        return 0;
      }
      const { error, count } = await supabase
        .from(table)
        .delete({ count: "exact" })
        .eq("business", business)
        .or(`last_seen_at.is.null,last_seen_at.neq.${runStamp}`);
      if (error) {
        console.error(`${table}/${business} reconcile error:`, error.message);
        return 0;
      }
      return count || 0;
    }

    const results: Record<string, unknown>[] = [];

    for (const src of SOURCES) {
      try {
        const sheetName = src.sheetName ?? await resolveSheetName(src.spreadsheetId, src.gid!, accessToken);
        const range = encodeURIComponent(`${sheetName}!A:Z`);
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${src.spreadsheetId}/values/${range}?majorDimension=ROWS`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!resp.ok) throw new Error(`Sheets API error ${resp.status}: ${await resp.text()}`);

        const rows: string[][] = (await resp.json()).values || [];
        if (rows.length < 2) {
          results.push({ business: src.business, message: "No data rows found", rows: 0 });
          continue;
        }

        const cols = src.columns === "detect" ? detectColumns(rows) : src.columns;
        if (!cols) throw new Error("Could not detect Date/Amount columns in header");

        const incomeTxs: Tx[] = [];
        const expenseTxs: Tx[] = [];
        const occurrence = new Map<string, number>();

        for (let i = cols.headerRow + 1; i < rows.length; i++) {
          const row = rows[i];
          const dateStr = parseDate((row[cols.date] || "").trim());
          if (!dateStr) continue;

          const amountCents = parseAmount(row[cols.amount] || "0");
          if (amountCents === 0) continue;

          const category = (cols.category >= 0 ? row[cols.category] || "" : "").trim();
          const description = (cols.description >= 0 ? row[cols.description] || "" : "").trim();
          const account = (cols.account >= 0 ? row[cols.account] || "" : "").trim();

          let isIncome: boolean, isExpense: boolean;
          if (src.categoryMode === "whitelist") {
            isIncome = INCOME_CATEGORIES.has(category) && amountCents > 0;
            isExpense = EXPENSE_CATEGORIES.has(category) && amountCents < 0;
            if (!isIncome && !isExpense) continue;
          } else {
            // sign mode: every inflow is income, every outflow is expense —
            // except non-operating categories (owner funding, transfers, …).
            if (EXCLUDED_CATEGORIES.has(category.toLowerCase())) continue;
            isIncome = amountCents > 0;
            isExpense = amountCents < 0;
          }

          // Stable id from the transaction's own fields + an occurrence index
          // for exact duplicates. Never tied to the sheet row number (those
          // shift on reorder and would re-duplicate the whole sheet).
          const descSlug = description.replace(/\W+/g, "_");
          const accountSlug = account.replace(/\W+/g, "_");
          const naturalKey = `${dateStr}_${amountCents}_${accountSlug}_${descSlug}`;
          const occ = (occurrence.get(naturalKey) || 0) + 1;
          occurrence.set(naturalKey, occ);

          // Expenses stored as positive cents so the Expenses page can sum and
          // chart without flipping signs on every render.
          const tx: Tx = {
            transaction_id: `${src.idPrefix}_${naturalKey}_${occ}`,
            date: dateStr,
            description,
            category: category || "Uncategorized",
            amount_cents: isExpense ? -amountCents : amountCents,
            account,
            business: src.business,
            last_seen_at: runStamp,
          };
          if (isIncome) incomeTxs.push(tx);
          else expenseTxs.push(tx);
        }

        const incomeRes = await upsertBatched("revenue_transactions", incomeTxs);
        const expenseRes = await upsertBatched("expense_transactions", expenseTxs);
        const sourceParsed = incomeTxs.length + expenseTxs.length;
        const incomePruned = await reconcile("revenue_transactions", src.business, sourceParsed, incomeRes.errors);
        const expensePruned = await reconcile("expense_transactions", src.business, sourceParsed, expenseRes.errors);

        results.push({
          business: src.business,
          sheet: sheetName,
          total_rows_read: rows.length - (cols.headerRow + 1),
          income_transactions: incomeTxs.length,
          income_upserted: incomeRes.upserted,
          income_pruned: incomePruned,
          expense_transactions: expenseTxs.length,
          expense_upserted: expenseRes.upserted,
          expense_pruned: expensePruned,
        });
        console.log(`Tiller sync ${src.business}: ${incomeTxs.length} income / ${expenseTxs.length} expense`);
      } catch (srcErr) {
        console.error(`Tiller sync ${src.business} failed:`, (srcErr as Error).message);
        results.push({ business: src.business, error: (srcErr as Error).message });
      }
    }

    return new Response(JSON.stringify({ runStamp, account, sources: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Tiller sync error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
