// supabase/functions/sync-tiller/index.ts
// Deploy with: supabase functions deploy sync-tiller --no-verify-jwt
// Reads transactions from Tiller Google Sheets and upserts them into
// revenue_transactions / expense_transactions, tagged by business.
// Cron: daily at 7am UTC
//
// Modes per source:
//   "app":       import EVERY money row; the sheet's Category column is
//                ignored — categorization happens in this app (rules → Claude
//                → review inbox on the Accounting page). The sheet's stable
//                Transaction ID is the dedup key, and existing rows only get
//                date/description/amount/account refreshed so app-side
//                category fixes are never clobbered. (Mayday)
//   "sign":      every positive row is income, negative is expense, sheet
//                categories kept as-is. (Neptune — its taxonomy is its own)
//   "whitelist": legacy — split income/expense by the category sets below,
//                unlisted rows dropped. (retired with the old Mayday sheet)
//
// Each source is reconciled independently: after a successful pull, any
// Tiller-sourced row for that business not stamped in this run is deleted.
// A source that fails to fetch/parse is skipped without touching its data.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Mayday Media income categories. Used by the legacy "whitelist" mode and as
// the allowed set for Claude suggestions in "app" mode.
const INCOME_CATEGORIES = new Set([
  "YouTube Income",
  "TikTok Income",
  "Twitch Income",
  "Substack Income",
  "Sponsorship Income",
  "Merch Income",
  "Facebook Income",
  "Services",
  "Production Services",
  "Interest",
  "Reimbursement",
]);

// Rule categories that represent money moving between own accounts — matching
// rows get is_transfer=true so they're excluded from P&L (mirrors the old
// Tiller doc, where Loan Repayment and Funding were typed "Transfer").
const TRANSFER_RULE_CATEGORIES = new Set(["Transfer", "Loan Repayment", "Funding"]);

// Mayday Media operating expense categories. Must stay aligned with
// EXPENSE_CATEGORY_META in src/pages/Accounting.js.
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
  "Contractors",
  "Misc Expense",
  "Administration",
  "Supplies",
  "Entertainment/Fun",
  "Medical",
  "Food",
  "Bank Fees",
  "Taxes",
]);

// Non-operating categories excluded from sign-based sources (Neptune).
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

// Per-run Claude cap in "app" mode — keeps a big backlog from blowing the
// edge function timeout. Leftovers stay Uncategorized/auto; the
// categorize-backlog function (or the next sync) picks them up.
const AI_LIMIT_DEFAULT = 150;

type FixedColumns = {
  headerRow: number; date: number; description: number; category: number;
  amount: number; account: number; txnId?: number; hint?: number; accountId?: number;
};

type Source = {
  business: string;
  spreadsheetId: string;
  sheetName?: string;
  gid?: number;
  categoryMode: "whitelist" | "sign" | "app";
  columns: FixedColumns | "detect";
  idPrefix: string;
  // Rows dated before this (YYYY-MM-DD) are skipped. Set on the Mayday source
  // because history through 2026-06-25 was imported verbatim from the old
  // Tiller doc (source='tiller_v1', see import-tiller-v1); the live sheet only
  // owns dates after the cutover.
  minDate?: string;
};

const SOURCES: Source[] = [
  {
    // New unified Mayday sheet (2026-07): Tiller pulls the bank feeds
    // (3 Amex + City National), this app owns all categorization.
    business: "mayday_media",
    spreadsheetId: "1K56_Bj6zX-zd-BKJhrG56bKd1WXYnZjTNdMB7dE_UYg",
    sheetName: "Transactions",
    categoryMode: "app",
    columns: "detect",
    idPrefix: "tillerv2",
    minDate: "2026-06-26",
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

// Find column indices from a Tiller header row. Scans the first several rows
// so a layout with leading blank/title rows still works.
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
      txnId: find("transaction id"),
      hint: find("category hint"),
      accountId: find("account id"),
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
  // app-mode extras (absent for legacy modes so their upsert payloads and
  // conflict-update behavior stay byte-identical to before)
  source?: string;
  categorized_by?: string;
  review_status?: string;
  is_transfer?: boolean;
  _hint?: string; // not persisted — Claude signal only
  _kind?: "revenue" | "expense";
  _accId?: string; // not persisted — generation-dedup only
};

// Yodlee connection repairs re-pull history under fresh transaction ids (same
// account!), so the sheet holds the same transaction once per pull generation.
// Yodlee ids are hex-timestamped: ids minted in the same pull batch share a
// prefix, re-pulled copies get a much later one. When identical rows
// (date/amount/description/account) span multiple id generations, keep only
// the newest generation's copies. Same-generation repeats (e.g. three
// same-price subway taps in one batch) all survive. Known blind spot: a legit
// same-day same-amount repeat whose legs posted in different pull batches
// would be wrongly collapsed — rare enough to accept.
const GEN_PREFIX_LEN = 8;

function txnGeneration(t: Tx): string | null {
  // `tillerv2_<yodleeId>`; natural-key fallback rows have no generation.
  const m = t.transaction_id.match(/^tillerv2_([0-9a-f]{8,24})$/);
  return m ? m[1].slice(0, GEN_PREFIX_LEN) : null;
}

function dedupeGenerations(txs: Tx[]): { kept: Tx[]; dropped: number } {
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    const key = `${t.date}|${t.amount_cents}|${t.description}|${t.account}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const drop = new Set<string>();
  for (const group of groups.values()) {
    const gens = [...new Set(group.map(txnGeneration).filter(Boolean))] as string[];
    if (gens.length < 2) continue;
    const newest = gens.sort().pop();
    for (const t of group) {
      const g = txnGeneration(t);
      if (g && g !== newest) drop.add(t.transaction_id);
    }
  }
  return { kept: txs.filter((t) => !drop.has(t.transaction_id)), dropped: drop.size };
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
    const body = await req.json().catch(() => ({}));
    const skipAi = body.skipAi === true;
    const aiLimit = Number.isFinite(body.aiLimit) ? body.aiLimit : AI_LIMIT_DEFAULT;

    // Single timestamp for this run. Every upserted row is stamped with it;
    // anything for a freshly-pulled business not stamped this run is pruned.
    const runStamp = new Date().toISOString();
    const accessToken = await getAccessToken();
    const account = await getAccountEmail(accessToken);

    async function upsertBatched(table: string, txs: Tx[]): Promise<{ upserted: number; errors: number }> {
      let upserted = 0, errors = 0;
      for (let i = 0; i < txs.length; i += 200) {
        const batch = txs.slice(i, i + 200).map(({ _hint, _kind, _accId, ...t }) => t);
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
    //     Cold-start (existing <= 5) is exempt.
    // Only source='tiller' rows are prunable — Plaid/manual rows are not the
    // sheet's to reconcile.
    async function reconcile(table: string, business: string, sourceParsed: number, errors: number): Promise<number> {
      if (sourceParsed === 0 || errors > 0) {
        console.log(`${table}/${business} reconcile skipped (sourceParsed=${sourceParsed}, errors=${errors})`);
        return 0;
      }
      const { count: existing } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("business", business)
        .eq("source", "tiller");
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
        .eq("source", "tiller")
        .or(`last_seen_at.is.null,last_seen_at.neq.${runStamp}`);
      if (error) {
        console.error(`${table}/${business} reconcile error:`, error.message);
        return 0;
      }
      return count || 0;
    }

    // Rules → Claude categorization for app-mode rows that are NEW (existing
    // rows keep their app-side categories untouched).
    async function categorizeAppRows(txs: Tx[], business: string): Promise<number> {
      const { data: rules } = await supabase
        .from("category_rules").select("*")
        .order("priority", { ascending: false });
      for (const t of txs) {
        const desc = t.description.toUpperCase();
        const rule = (rules || []).find((r) =>
          r.txn_kind === t._kind &&
          (!r.business || r.business === business) &&
          (r.match_type === "exact"
            ? desc === r.pattern.toUpperCase()
            : desc.includes(r.pattern.toUpperCase()))
        );
        if (rule) {
          t.category = rule.category;
          t.categorized_by = "rule";
          t.review_status = "confirmed";
          if (TRANSFER_RULE_CATEGORIES.has(rule.category)) t.is_transfer = true;
        }
      }

      let aiDone = 0;
      const uncat = txs.filter((t) => t.category === "Uncategorized");
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (skipAi || !anthropicKey || uncat.length === 0) return 0;

      const targets = uncat.slice(0, aiLimit);
      for (let i = 0; i < targets.length; i += 50) {
        const chunk = targets.slice(i, i + 50);
        try {
          const prompt = [
            "Categorize these bank transactions for a creator business (Mayday Media). Respond ONLY with a JSON array of category strings, one per transaction, same order.",
            "",
            "revenue MUST be one of: " + JSON.stringify([...INCOME_CATEGORIES]),
            "expense MUST be one of: " + JSON.stringify([...EXPENSE_CATEGORIES]),
            "A transaction that moves money between the business's own accounts (credit card payments, internal transfers) should be \"Transfer\".",
            "The `hint` field is Tiller's rough guess — a useful signal, not ground truth. Note: hint=Transfers is often wrong for payroll (Gusto) and payment processors (Venmo payouts); judge by the description.",
            "If genuinely unknowable, use \"Uncategorized\".",
            "",
            "Transactions:",
            JSON.stringify(chunk.map((t) => ({
              description: t.description, amount: t.amount_cents / 100,
              kind: t._kind, hint: t._hint || null,
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
            if (cat === "Transfer") { t.category = "Transfer"; t.is_transfer = true; }
            else t.category = cat;
            aiDone++;
          });
        } catch (err) {
          console.error("Claude categorization failed for chunk:", err);
        }
      }
      return aiDone;
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
        if (src.categoryMode === "app" && (cols.txnId == null || cols.txnId === -1)) {
          throw new Error("app mode requires a 'Transaction ID' column in the sheet");
        }

        const incomeTxs: Tx[] = [];
        const expenseTxs: Tx[] = [];
        const occurrence = new Map<string, number>();

        for (let i = cols.headerRow + 1; i < rows.length; i++) {
          const row = rows[i];
          const dateStr = parseDate((row[cols.date] || "").trim());
          if (!dateStr) continue;
          if (src.minDate && dateStr < src.minDate) continue;

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
          } else if (src.categoryMode === "sign") {
            // sign mode: every inflow is income, every outflow is expense —
            // except non-operating categories (owner funding, transfers, …).
            if (EXCLUDED_CATEGORIES.has(category.toLowerCase())) continue;
            isIncome = amountCents > 0;
            isExpense = amountCents < 0;
          } else {
            // app mode: everything imports; the sheet category is ignored.
            isIncome = amountCents > 0;
            isExpense = amountCents < 0;
          }

          let transactionId: string;
          if (src.categoryMode === "app") {
            const sheetTxnId = (row[cols.txnId!] || "").trim();
            if (sheetTxnId) {
              transactionId = `${src.idPrefix}_${sheetTxnId}`;
            } else {
              // Rare rows without a Yodlee id fall back to the natural key.
              const naturalKey = `${dateStr}_${amountCents}_${account.replace(/\W+/g, "_")}_${description.replace(/\W+/g, "_")}`;
              const occ = (occurrence.get(naturalKey) || 0) + 1;
              occurrence.set(naturalKey, occ);
              transactionId = `${src.idPrefix}_nk_${naturalKey}_${occ}`;
            }
          } else {
            // Stable id from the transaction's own fields + an occurrence index
            // for exact duplicates. Never tied to the sheet row number.
            const naturalKey = `${dateStr}_${amountCents}_${account.replace(/\W+/g, "_")}_${description.replace(/\W+/g, "_")}`;
            const occ = (occurrence.get(naturalKey) || 0) + 1;
            occurrence.set(naturalKey, occ);
            transactionId = `${src.idPrefix}_${naturalKey}_${occ}`;
          }

          // Expenses stored as positive cents so the Expenses page can sum and
          // chart without flipping signs on every render.
          const tx: Tx = {
            transaction_id: transactionId,
            date: dateStr,
            description,
            category: src.categoryMode === "app" ? "Uncategorized" : (category || "Uncategorized"),
            amount_cents: isExpense ? -amountCents : amountCents,
            account,
            business: src.business,
            last_seen_at: runStamp,
          };
          if (src.categoryMode === "app") {
            tx._hint = (cols.hint != null && cols.hint !== -1 ? row[cols.hint] || "" : "").trim();
            tx._kind = isIncome ? "revenue" : "expense";
            tx._accId = (cols.accountId != null && cols.accountId !== -1 ? row[cols.accountId] || "" : "").trim();
          }
          if (isIncome) incomeTxs.push(tx);
          else expenseTxs.push(tx);
        }

        let aiCategorized = 0;
        let generationDupesDropped = 0;
        if (src.categoryMode === "app") {
          const incomeDedup = dedupeGenerations(incomeTxs);
          const expenseDedup = dedupeGenerations(expenseTxs);
          incomeTxs.length = 0; incomeTxs.push(...incomeDedup.kept);
          expenseTxs.length = 0; expenseTxs.push(...expenseDedup.kept);
          generationDupesDropped = incomeDedup.dropped + expenseDedup.dropped;
          // App-side category fixes must survive re-syncs, but Postgres checks
          // NOT NULL on the proposed tuple BEFORE conflict resolution — a
          // payload without `category` fails even for existing rows. So
          // existing rows echo their current category fields back verbatim:
          // the conflict-update rewrites them to the same values (no clobber)
          // and every row shares one payload shape.
          type Meta = { category: string; categorized_by: string; review_status: string; is_transfer: boolean; source: string };
          const existingMeta = new Map<string, Meta>();
          for (const [table, txs] of [["revenue_transactions", incomeTxs], ["expense_transactions", expenseTxs]] as const) {
            const ids = txs.map((t) => t.transaction_id);
            for (let i = 0; i < ids.length; i += 200) {
              const { data } = await supabase.from(table)
                .select("transaction_id, category, categorized_by, review_status, is_transfer, source")
                .in("transaction_id", ids.slice(i, i + 200));
              (data || []).forEach((r) => existingMeta.set(r.transaction_id, r));
            }
          }
          const newTxs: Tx[] = [];
          for (const t of [...incomeTxs, ...expenseTxs]) {
            const meta = existingMeta.get(t.transaction_id);
            if (meta) {
              t.category = meta.category;
              t.categorized_by = meta.categorized_by;
              t.review_status = meta.review_status;
              t.is_transfer = meta.is_transfer;
              t.source = meta.source;
            } else {
              t.source = "tiller";
              t.categorized_by = "ai";
              t.review_status = "auto";
              t.is_transfer = false;
              newTxs.push(t);
            }
          }
          aiCategorized = await categorizeAppRows(newTxs, src.business);
          const incomeRes = await upsertBatched("revenue_transactions", incomeTxs);
          const expenseRes = await upsertBatched("expense_transactions", expenseTxs);
          const incomePruned = await reconcile("revenue_transactions", src.business, incomeTxs.length, incomeRes.errors);
          const expensePruned = await reconcile("expense_transactions", src.business, expenseTxs.length, expenseRes.errors);
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
            ai_categorized: aiCategorized,
            generation_dupes_dropped: generationDupesDropped,
          });
          console.log(`Tiller sync ${src.business}: ${incomeTxs.length} income / ${expenseTxs.length} expense`);
          continue;
        }

        const incomeRes = await upsertBatched("revenue_transactions", incomeTxs);
        const expenseRes = await upsertBatched("expense_transactions", expenseTxs);
        // Reconcile each table against ITS OWN parsed count.
        const incomePruned = await reconcile("revenue_transactions", src.business, incomeTxs.length, incomeRes.errors);
        const expensePruned = await reconcile("expense_transactions", src.business, expenseTxs.length, expenseRes.errors);

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
