---
title: Known Issues & Gotchas — The Landmine Map
last_updated: 2026-07-15
tags: [debugging, gotchas, known-issues, landmines]
---

# Known Issues & Gotchas

Every confirmed landmine in Mayday Studio, with symptom → cause → workaround. Read this before you conclude "the code is broken" — several of these are external, historical, or by-design and will waste hours if you treat them as fresh bugs.

---

## (a) sync-youtube stale for the "More Mayday" channel

- **Symptom:** `sync-youtube` runs successfully but no new More Mayday videos appear; the same ~167 video IDs come back every run.
- **Cause:** External, not a code bug. The YouTube Data API returns the identical set of video IDs each run for that channel (stale API response / quota / uploads-playlist issue upstream). All returned videos are already in the DB.
- **Evidence in code:** Freshness detection was added — the function tracks newest `published_at` (`supabase/functions/sync-youtube/index.ts:336`) and emits a `[DIAG] STALENESS WARNING` when the API returns videos that are all already stored (`index.ts:665`), plus writes `newest_content_at` onto the ingestion log and result (`index.ts:680,686`).
- **Workaround / next step:** Do not "fix" the sync logic. Check the `[DIAG]` staleness log to confirm the symptom, then investigate externally: YouTube API key/quota, and verify the uploads-playlist `external_id` for that account (the refresh-token map is at `index.ts:39`). See CLAUDE.md → Known Issues.

## (b) PT-vs-UTC date-boundary bugs

- **Symptom:** Counts, daily/monthly rollups, "today" widgets, and calendar rows are off by one day near midnight — a late-evening PT event lands on the next calendar day; month totals leak a day at each end.
- **Cause:** The whole app runs on the `America/Los_Angeles` calendar (crons, Metricool, Google Calendar all assume PT), but `timestamptz` columns compare in **UTC**. Filtering a `timestamptz` with a bare `'YYYY-MM-DD'` string makes Postgres assume UTC midnight, so late-PT rows cross the boundary into the wrong day. Likewise `isoString.slice(0,10)` yields the UTC calendar day, not the PT day. This is documented in the header of `src/lib/ptDate.js:1-11`.
- **Fix (the right one):** Use the helpers in `src/lib/ptDate.js` for every date boundary and day/month key:
  - `ptRangeToUtc(startDate, endDate)` → half-open `{ startUtc, endUtc }` for `.gte(startUtc).lt(endUtc)` (`ptDate.js:35`).
  - `ptDateToUtcISO(dateStr, endExclusive)` for a single PT-midnight boundary (`ptDate.js:27`).
  - `ptMonthKey(iso)` / `ptDayKey(iso)` for PT calendar keys instead of `.slice(0,10)` (`ptDate.js:47,52`).
- **Antipattern to hunt for:** any `.gte('YYYY-MM-DD')`, `.eq('date_col', ...)`, or `.slice(0,10)` on a `timestamptz`. Those are the bug.

## (c) Migration history divergence — use `apply_migration`, not `supabase db push`

- **Symptom:** `supabase db push` reports drift, tries to re-apply already-applied migrations, or refuses to run; local migration list disagrees with the remote history table.
- **Cause:** The migration history diverged between local files and the remote project. `supabase db push` reconciles against that history and misbehaves.
- **Workaround:** Apply schema changes via the MCP tool `mcp__claude_ai_Supabase__apply_migration` (which writes directly to the remote project), and inspect current state with `mcp__claude_ai_Supabase__list_migrations`. Do **not** use `supabase db push`.

## (d) Leaked CRON_SECRET in migration 20260328200001

- **Symptom:** A live-looking secret sits in a committed migration.
- **Cause:** `supabase/migrations/20260328200001_cron_generate_trends.sql:11` hardcodes the trends cron secret as a URL query param: `.../functions/v1/generate-trends?secret=300897BA-1E26-4328-97E8-FFB11BCF2C6D`.
- **Status:** The secret has been **rotated** and moved to Vault / Edge Function secrets, but the old value **remains in git history**. Treat the value as dead. Do not reuse it, do not assume it authenticates anything. New cron jobs should read `CRON_SECRET` from Edge Function secrets, never inline it.

## (e) `node_modules/` churn in git status is normal — never commit it

- **Symptom:** `git status` shows dozens of modified/deleted `node_modules/**` files (floating-ui, remirror, tailwind bins, etc.).
- **Cause:** Local package drift between installs. Expected, benign.
- **Workaround:** Ignore it. Never stage or commit `node_modules/` changes. When committing a real fix, add specific paths — never `git add -A` / `git add .`.

## (f) Session / token-refresh race in AuthContext — the auth-lock deadlock

- **Symptom:** UI appears frozen after a tab switch or token refresh; Supabase calls hang forever with no error.
- **Cause:** The `onAuthStateChange` callback runs **while the Supabase auth lock is still held**. Any `await supabase.*` call inside that callback queues behind the lock and deadlocks the entire client. (Upstream: supabase/auth-js#762.)
- **Guardrails already in place (do not violate):** The callback at `src/contexts/AuthContext.js:239` is intentionally **non-async** and must not call `supabase.*` directly — see the warning comment at `AuthContext.js:231-238`. Async work (e.g. `fetchProfile`) is deferred with `setTimeout(..., 0)` so it runs after the lock releases (`AuthContext.js:262-269`). `TOKEN_REFRESHED` only updates the user object, never re-fetches (`AuthContext.js:270-273`).
- **Related handling:** `initAuth` proactively refreshes when `expires_at - now < 60s` (`AuthContext.js:184-215`); `getSession`/refresh failures route through `handleAuthFailure` → `nukeSession` (which clears `sb-*` auth-token / code-verifier localStorage keys, `AuthContext.js:39`). On realtime reconnect the socket auth is re-set with the fresh access token before channels re-subscribe (`AuthContext.js:417-437`).
- **Debugging tip:** If the UI freezes post-refresh, check for any newly added `await supabase.*` inside `onAuthStateChange` or any handler it calls synchronously — that is almost always the regression.

## (g) Triton is READ-ONLY — writes fail

- **Symptom:** Writes against Triton data (briefs, cards) error or silently no-op.
- **Cause:** Triton is a separate Supabase project exposed via a **read-only** client, `tritonSupabase` in `src/tritonClient.js:6-9` (built from `REACT_APP_TRITON_SUPABASE_*`). It is null when those env vars are absent. The MCP-proxied path (`src/lib/tritonMcp.js`, `PROXY_URL = '/api/triton-mcp'`) is likewise for reads.
- **Workaround:** Only read from Triton. Any mutation belongs in the main project. If a feature needs to persist Triton-derived data, copy it into a main-project table and write there.

## (h) Accounting CSV sign-flip + Plaid dormant

- **Symptom:** An expense shows the wrong color/sign; a refund looks like a charge; totals swing the wrong way.
- **Cause (by design, easy to misread):** Revenue is stored as **positive** cents; expenses are stored as **positive** cents too but **sign-flipped at sync time**; refunds/credits on the expense side are **negative** cents. The render logic depends on this convention: `isCredit = t.kind === 'revenue' || t.amount_cents < 0` → green/`+`, else red/`−` (`src/pages/Accounting.js:478-487`, mirrored at `Accounting.js:682-686`). The CSV importer must apply the sign flip; a row imported with the wrong sign is the usual culprit.
- **Plaid:** The live ingestion path is the Tiller v2 sheet + app-side categorization. **Plaid is dormant** (fallback only). Do not chase Plaid webhooks for a missing-transaction bug — check the Tiller sheet sync and the CSV sign convention first.

## (i) Newsletters are RSS-only; `receive-newsletter` / `ingest-newsletter` are unused

- **Symptom:** You go looking for a Mailgun / inbound-email newsletter pipeline and find edge functions named `receive-newsletter` / `ingest-newsletter` referenced in docs.
- **Cause:** Newsletters are ingested **only** via RSS through `fetch-rss` into `research_articles` (source distinguished by `research_feeds.source_type`). There is **no** Mailgun integration. The `receive-newsletter` / `ingest-newsletter` functions are documented as unused dead paths and are not present in the current `supabase/functions/` tree.
- **Workaround:** Debug newsletter ingestion as an RSS problem (`fetch-rss`, `research_feeds`, `research_articles`), not an inbound-email problem. Do not wire anything to the dead functions.

## (j) `generate-trends` cron timing (PT)

- **Symptom:** Daily trends appear "late" or on the wrong calendar day.
- **Cause:** The pg_cron job `daily-generate-trends` fires at `0 15 * * *` = **15:00 UTC = 8am PT** (`supabase/migrations/20260328200001_cron_generate_trends.sql:9`). During DST shifts the wall-clock PT hour moves relative to the fixed UTC cron. Trends analyze the last ~48h of `research_articles`.
- **Workaround:** Verify the job with `select * from cron.job` (via `execute_sql`) and cross-check article timestamps in PT (`ptDayKey`) before assuming the generator is broken.

## (k) Realtime silence for rows outside an RLS read set

- **Symptom:** A row changes but no realtime update fires; polling works, `postgres_changes` does not.
- **Cause:** Supabase realtime only emits `postgres_changes` for rows the subscriber can **read** under RLS. If a role is excluded from a table's read policy, it will never receive change events for it.
- **Canonical example:** The Agency portal cannot read deliverable rows (excluded via `is_agency()`), so it gets **no** `postgres_changes` for them — it falls back to polling every 20s plus realtime only on tables it *can* read (`agency_comments`, own `ad_read_proposals`). See CLAUDE.md → Agency Portal. Full diagnosis in `03-supabase-debug.md`.

---

### Quick triage reflexes
- Date off by one → PT/UTC (b), use `ptDate.js`.
- Empty screen for one role → RLS (see `03`), not a crash.
- UI frozen after tab switch → auth-lock deadlock (f).
- YouTube not updating for More Mayday → external, check `[DIAG]` log (a).
- Realtime not firing → RLS read set (k).
- Schema change won't apply → use `apply_migration` (c).
- Weird `node_modules` diff → ignore (e).
