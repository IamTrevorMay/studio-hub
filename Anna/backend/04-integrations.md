---
title: External Integrations Map
last_updated: 2026-07-15
tags: [backend, integrations, metricool, google, plaid, stripe, anthropic]
---

# External Integrations Map

Every third-party system the backend talks to, which edge functions own it, the env vars/secrets it needs, and the known gotchas. All of these run as edge functions (doc 01) and most are driven by pg_cron (doc 03).

## Metricool (social publishing + account metrics)

Metricool is the aggregator for Instagram / Facebook / TikTok posting and account-level metrics.

- **Functions:** `sync-metricool` (pulls daily account-level metrics from the timelines API → `platform_daily_metrics` + `audience_snapshots`, for IG/FB/TikTok, `sync-metricool/index.ts:3-4`), `metricool-posts` (list scheduled/published posts — admin JWT required, response has creator-email PII), `metricool-stories` (IG stories, powers the "Do this more" dashboard widget). (Note: there is **no** `metricool-create-post` function — an earlier draft invented it; posting/scheduling is done through the Metricool UI, not an edge fn.)
- **Env:** `METRICOOL_TOKEN`, `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID` (all three needed on each Metricool function).
- **Gotchas:** the API is per-"blog" (one `BLOG_ID`); metrics are account-level daily, not per-post. `metricool-posts` gates on admin because the payload leaks `creatorEmail`.

## Platform sync (analytics ingestion)

The `sync-*` family pulls performance + revenue data into a common schema (`content_items`, `content_metrics`, `platform_daily_metrics`, `audience_snapshots`, `revenue_events`). They share helpers in `sync-youtube/shared/utils.ts` — `getSupabaseAdmin`, `getActiveAccounts`, ingestion-log lifecycle (`startIngestionLog`/`completeIngestionLog`/`failIngestionLog`), `fetchWithRetry`. Each run writes an `ingestion_logs` row and updates `platform_accounts` health (`last_success_at`, `consecutive_failures`, `token_status`).

All are **dual-auth** (CRON_SECRET or admin JWT) — the copy-pasted block, verified e.g. `sync-substack/index.ts:27-43`, `sync-fourthwall/index.ts:53-71`, `check-data-integrity/index.ts:35-48`.

| Function | Platform | Env / auth | Notes |
|---|---|---|---|
| `sync-youtube` | YouTube | `YOUTUBE_API_KEY` (Data API), `YOUTUBE_CLIENT_ID/SECRET` + per-channel refresh tokens (`YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_REFRESH_TOKEN_MAYDAY`) for the Analytics/revenue API | see gotchas below |
| `sync-youtube-dimensions` | YouTube | `YOUTUBE_CLIENT_ID/SECRET`, `CRON_SECRET` | backfills traffic-source/geo dimensions |
| `sync-metricool` | IG/FB/TikTok | `METRICOOL_TOKEN/USER_ID/BLOG_ID`, `CRON_SECRET` | **the** account-level path for IG/FB/TikTok — there is no `sync-meta` |
| `sync-twitch` | Twitch | `TWITCH_CLIENT_ID/SECRET`, `CRON_SECRET` | rotating refresh token, see below |
| `sync-fourthwall` | Fourthwall merch | `FOURTHWALL_USERNAME/PASSWORD`, `CRON_SECRET` | Basic auth, see below |
| `sync-stripe` | Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET` | webhook + daily batch; revenue events |
| `sync-substack` | Substack | `CRON_SECRET` only (RSS + deprecated stats endpoint) | subscriber count endpoint dead, see below |
| `sync-simplecast` | podcast | `CRON_SECRET` (own cron `20260628000001_cron_sync_simplecast.sql`) | downloads per `platform_accounts` |

**There is no `sync-meta` function** (an earlier draft of this doc invented it — corrected here after `ls supabase/functions/`). Meta (Instagram + Facebook) account metrics come through `sync-metricool`. The only consumer of `META_ACCESS_TOKEN` in the whole fleet is **`post-daily-graphics`** (posting a graphic to the FB/IG Graph API), verified `grep -rln META_ACCESS_TOKEN`. Likewise **`metricool-create-post` does not exist**.

**sync-twitch gotcha — rotating refresh token (line-verified):** `refreshAccessToken` (`sync-twitch/index.ts:51-119`) hits `https://id.twitch.tv/oauth2/token` with `grant_type=refresh_token`. Twitch **invalidates the old refresh token immediately** on refresh (`:48-49` comment), so the new `refresh_token` from the response **must** be written back to the account's stored `credentials`, and a failed refresh writes `credentials: { error: "refresh_token_revoked" }` (`:79`) to force re-authorization. Creds live per-account (`platform_accounts.credentials`), not in env; only `TWITCH_CLIENT_ID/SECRET` are env (`:167-168`). Durations parsed from Twitch's `"3h26m15s"` format (`:36-45`). PT day-bucketing (`:13-17`).

**sync-fourthwall gotcha — Basic auth (line-verified):** paginated pull from `https://api.fourthwall.com/open-api/v1.0/order` (`API_BASE`, `:9`, `PAGE_SIZE=50`) with `Authorization: Basic ${auth}` where `auth = btoa(\`${username}:${password}\`)` (`:80`) built from `FOURTHWALL_USERNAME`/`FOURTHWALL_PASSWORD` (`:74-75`). Each order → one `revenue_events` row with `product_category='merch'` (`:3-4`). Sends `Accept-Encoding: gzip` (`:38`).

**sync-substack gotcha — deprecated stats endpoint (line-verified):** the primary path is the public RSS feed at `${baseUrl}/feed` (`:66`), where `baseUrl` is `config.custom_domain` or `https://<slug>.substack.com` (`:57-58`), **SSRF-guarded** by `isSafeExternalUrl` (`:62`, from `shared/url-validation.ts`). The `/api/v1/subscriber_count` endpoint **was removed by Substack ~2026-03 and now 404s** (`:70-74`); the function no longer lands subscriber/paid counts, logs a warning instead of swallowing (`:92-102`), and per the header comment subscriber counts are slated to move to a Gmail-parse path. Articles upsert with zeroed engagement (`views/likes/comments = 0`, `:122-131`) — real engagement needs manual CSV/dashboard import. Refreshes `daily_platform_rollups` at the end (`:153`).

**sync-youtube gotchas (important):**
- **Per-channel token map:** `CHANNEL_TOKEN_MAP = { "More Mayday": "YOUTUBE_REFRESH_TOKEN_MAYDAY" }` — each channel's revenue/analytics uses a distinct refresh token env var; default is `YOUTUBE_REFRESH_TOKEN` (`sync-youtube/index.ts:38-53`).
- **Analytics API can't return impressions:** `impressions` and `impressionsClickThroughRate` throw 400 "Unknown identifier" from the YouTube Analytics v2 API. Those columns in `analytics_youtube_daily` come from **CSV uploads out of YouTube Studio**, not this sync. Do not include them in the sync's upsert or you'll overwrite history (`sync-youtube/index.ts:114-118, 614-616`).
- **Shorts cutoff is 180s** (changed from 60 in 2024), `:306-307`.
- **KNOWN ISSUE — stale More Mayday channel:** the YouTube Data API returns the same 167 video IDs every run for More Mayday; root cause is external (stale API response / quota), not a code bug. The function now logs a `[DIAG] STALENESS WARNING` when the API returns videos but all already exist, and stamps `newest_content_at` on the ingestion log (`sync-youtube/index.ts:660-684`). It also **verifies persistence before firing `new_video` automation events** to avoid an infinite clip-task loop when a batch upsert silently drops rows (`:457-472`). May need YouTube quota/API-key investigation or uploads-playlist-ID verification.
- Refreshes the `daily_platform_rollups` materialized view at the end (`:694`).

## Google Calendar (per-admin OAuth)

Two-way sync between the app's `calendar_events` and each admin's Google Calendar. This is an **admin-scoped, per-user** integration — connections live in `google_calendar_connections` keyed by `user_id`.

- **OAuth handshake:** `google-auth-url` (build consent URL, uses `OAUTH_STATE_SECRET` for signed state), `google-auth-callback` (exchange code → store refresh/access token), `google-disconnect`, `google-calendars-list`.
- **Sync:** `google-calendar-sync` (push a single app event create/update/delete to Google — `{action, event_id}` body), `google-calendar-fetch` (pull Google → app).
- **Env:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- **Token refresh:** `getValidToken` refreshes the access token 5 min before expiry using the stored `refresh_token`, and writes the new token back (`google-calendar-sync/index.ts:10-51`).
- **Gotchas:** always uses **the caller's own connection**, never `connections[0]` — a prior bug meant any admin's sync ran through whichever admin connected first (`:191-206`). Event-type→calendar routing goes through `google_calendar_mappings`. Non-admins are blocked (`:157-170`). Recurrence is translated app-rule → RRULE (`buildRRule`, `:53-90`); a V1 gap is that recurring events whose base row falls outside a query window are missed (see `assistant-summary` comment).

## Google Drive & cloud/NAS storage

- **Drive (Google-owned):** `google-drive-folders`, `google-drive-research`, `google-drive-resources`, `google-drive-create-sheet`, `google-drive-write`, `drive-list-clips`, `drive-list-contractor-folders`, `drive-upload-init` (drag-drop upload for freelancers), `pitch-video-drive`. Auth via `GOOGLE_DRIVE_REFRESH_TOKEN` (a single service refresh token, distinct from the per-user calendar tokens) + `GOOGLE_CLIENT_ID/SECRET`.
- **Drive watch (poll-based):** `drive-watch-register` / `drive-watch-poll` (cron `* * * * *`) / `drive-watch-stop` — polls watched folders for new files and turns `drive_events` into `freelancer_assignments`. This is the reusable Drive-watch pattern.
- **Cloud/NAS asset service:** `cloud-folders` proxies to the self-hosted asset service at `CLOUD_API_URL` (`https://assets.maydaystudio.net`) with `CLOUD_API_KEY`. Admin-gated. This is the Mayday NAS, separate from Google Drive.
- **Shade:** `shade-search` uses `SHADE_API_KEY` + `SHADE_DRIVE_ID` for a separate asset search index.

## Accounting: Plaid + Tiller (+ CSV)

Bank/transaction ingestion into `revenue_transactions` / `expense_transactions`. **Categorization happens app-side** (rules → Claude → review inbox on the Accounting page), not from the source's own category column.

- **Tiller (live, primary):** `sync-tiller` reads Tiller's Google Sheets and upserts by the sheet's stable Transaction ID (daily cron, `20260419000001_cron_sync_tiller.sql`). Per-source modes (`sync-tiller/index.ts` header):
  - `"app"` (Mayday) — import **every** money row, **ignore the sheet's Category** (app categorizes); existing rows only refresh date/description/amount/account so app-side category fixes are never clobbered.
  - `"sign"` (Neptune) — positive = income, negative = expense, keep sheet categories.
  - `"whitelist"` — legacy/retired.
  - Each source reconciles independently: after a pull, any Tiller-sourced row for that business **not stamped this run is deleted**.
  - `import-tiller-v1` handled the one-time historical v1 sheet import.
- **Plaid (dormant fallback):** `plaid-link-token`, `plaid-exchange-token`, `plaid-sync`. Env `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_CUTOVER_DATE`. Currently a dormant fallback to Tiller. Gotchas:
  - **Cutover guard:** transactions dated before `PLAID_CUTOVER_DATE` (default `2026-07-01`) are ignored, so Plaid doesn't duplicate the Tiller-backfilled history (`plaid-sync/index.ts:9, 133, 182`).
  - **Sign convention (the gotcha):** Plaid emits **positive = money out** of the account, so `kind = txn.amount > 0 ? "expense" : "revenue"`, and the stored `amount_cents` is always `Math.abs` (positive) (`plaid-sync/index.ts:195-205`). A sign flip on a modified txn moves the row between the two tables (`:378-385`).
  - Internal transfers (same amount, opposite direction, different accounts, within N days) are detected and flagged so they don't count as revenue/expense (`:256-260`).
- **CSV manual import:** `import-transactions` is the fallback for statements Plaid can't reach (e.g. Amex). It takes a `positiveIs: 'expense' | 'revenue'` param because **Amex CSVs use positive = charge = expense** — the opposite of some banks. The sign→kind logic is `kind = (amount > 0) === (positiveIs === 'expense') ? 'expense' : 'revenue'` and dedups via a `csv_<sha256>` transaction id (`import-transactions/index.ts:12, 92-135`).
- **Duplicate handling:** `revenue_transactions`/`expense_transactions` have an `is_duplicate` soft flag (rows are never deleted — reconcilers would re-insert them — just excluded from aggregates), and `duplicate_dismissals` records "not a duplicate" decisions keyed by the sorted uids of the candidate cluster (`20260715120000_transaction_duplicates.sql`).

## Anthropic / Claude

Claude powers the AI features. All use `fetch("https://api.anthropic.com/v1/messages")` with header `x-api-key: ANTHROPIC_API_KEY` and `anthropic-version: 2023-06-01`.

**Model resolution (line-verified across the fleet):**
- **Default = `Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6"`** — this is the fallback in the majority of functions: `generate-trends:185`, `generate-weekly-report:28`, `generate-monthly-report:29`, `generate-ashley-read:27`, `run-report:57,339`, `sync-tiller:450`, `plaid-sync:332`, `import-transactions:225`, `categorize-backlog:149`, `sync-progress-cards:81`, `organize-autotag:39`, `find-assets-enrich:34`.
- **`stats-query` defaults to `claude-haiku-4-5`** (`stats-query/index.ts:127,238`) — the one function that reads `CLAUDE_MODEL` but falls back to Haiku, not Sonnet.
- **`generate-brief-onepager` uses a separate env `CLAUDE_MODEL_ONEPAGER`, default `claude-opus-4-7`** (`generate-brief-onepager/index.ts:153`).

So the single canonical answer to "what model do Claude functions use by default": **`claude-sonnet-4-6`**, with two documented exceptions (Haiku for `stats-query`, Opus via `CLAUDE_MODEL_ONEPAGER` for one-pagers). All are overridable by setting the `CLAUDE_MODEL` (or `CLAUDE_MODEL_ONEPAGER`) env var.

- **`generate-trends`** — daily (cron `0 15 * * *`, 8am PT). Reads last-48h `research_articles`, asks Claude for a graded trends report (JSON: `summary`, `current_events`, `evergreen`, `suggestions` A+..F), upserts `research_trends` by date. `max_tokens: 4096`, 90s abort timeout, `502` on API error, robust JSON-fence stripping + parse guard (`generate-trends/index.ts:170-237`).
- **`generate-ashley-read`** — weekly (Saturdays, cron `20260714000100_cron_ashley_read.sql`). Ashley's tactical Analytics read per surface (yt_long / yt_short / tiktok), grounded in vendored "brain" docs (`brain.ts` → `ASHLEY_BRAIN`). **INSERTs a new versioned row** into `ashley_reads` (never upserts) so a saved/actioned read isn't clobbered by a later Refresh (`generate-ashley-read/index.ts:1-27`).
- **`generate-weekly-report` / `generate-monthly-report`** — periodic AI narrative reports (cron-driven; `WEEKLY_REPORT_EMAILS` recipients).
- **`generate-brief-onepager`** — turns a campaign brief into a one-pager (own model override `CLAUDE_MODEL_ONEPAGER`).
- **`categorize-backlog`** — Claude categorizes uncategorized accounting transactions (the "Claude" step in the accounting rules→Claude→review pipeline).
- **`assistant-*`** functions (Gerald, at `assist.mmcreate.io`): `assistant-summary` (read-only admin snapshot — projects/sprint/deliverables/tasks/calendar in a 14-day window), `assistant-create-card`, `assistant-complete`, `assistant-send-dm`, `assistant-messages`, `assistant-workflow-status`. These are the API surface a separate assistant app calls; CORS is origin-restricted to the assistant domains, and all require an admin JWT (`assistant-summary/index.ts:21-53`).

**Claude gotchas:** always strip possible ```` ```json ```` fences before `JSON.parse` and guard the parse (`generate-trends/index.ts:206-215`); use an `AbortController` timeout (Claude calls can be slow); return `502` (not 500) when the upstream API itself errors so the caller can tell "our bug" from "Anthropic's".

## Email + push

- **Email (Resend):** `send-notification-email`, `mailer-*` (campaign mailer: `mailer-arm-daily`, `mailer-cron-tick`, `mailer-send-now`, `mailer-track-open/click`, `mailer-unsubscribe`, `mailer-webhook`, `mailer-domain`). Env `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `MAILER_DEFAULT_FROM`, `MAILER_PUBLIC_URL`, `MAILER_WEBHOOK_SECRET`. **Correction to CLAUDE.md:** `receive-newsletter`/`ingest-newsletter` (Mailgun) **do not exist on disk** (confirmed by `ls supabase/functions/`) — not merely unused, absent. Newsletters are RSS-only via `fetch-rss`.
- **`mailer-webhook` — Resend/Svix signed webhook (line-verified):** receives `email.delivered/opened/clicked/bounced/complained` events (`EVENT_MAP`, `mailer-webhook/index.ts:25-31`). Signature verification is **Standard Webhooks / Svix HMAC-SHA256** over `${svix-id}.${svix-timestamp}.${rawBody}`, base64, constant-time compared against each `v1,<b64>` in `svix-signature` (`:48-73`). Gotchas: (1) **fails CLOSED** — an unset `MAILER_WEBHOOK_SECRET` rejects everything except when `ENVIRONMENT=dev` (`:49-53`), because a forged bounce/complaint would suppress real subscribers; (2) **5-minute replay window** on `svix-timestamp` (`:58-60`); (3) supports both `whsec_`-prefixed (base64-decoded) and raw secrets (`:63-65`); (4) **idempotent** — dedups on `svix-id` via a `mailer_events` lookup so Resend retries don't double-count (`:110-132`); (5) status only advances, never regresses, using `STATUS_RANK` so an out-of-order `delivered` can't downgrade a `clicked` (`:44-46,140-144`); (6) a bounce/complaint flips the subscriber status **and** upserts a `mailer_suppressions` row (`:156-174`). Note it imports `corsHeaders/jsonResp/getAdminClient` from `shared/workflow-engine.ts` (that module is a grab-bag of shared helpers, not workflow-only).
- **Web push:** `send-push` (CRON_SECRET only) using `VAPID_KEYS_JWK`; fired by the `notifications_push_trigger` DB trigger via pg_net with `{ notification: <row> }` and an `x-cron-secret` header (`send-push/index.ts` header).

## Triton (secondary read-only Supabase project)

Briefs/cards are mirrored from a second Supabase project ("Triton"). Env `TRITON_SUPABASE_URL`, `TRITON_SUPABASE_SERVICE_ROLE_KEY`, `TRITON_URL`, `STUDIO_TRITON_SECRET`. Treated as read-only from the main app's perspective.

## Jobs portal (careers board)

Five functions, three auth postures:
- **`jobs-apply`** — public POST, no login. The **capability/abuse boundary is the CAPTCHA + consent**, verified in `jobs-apply/index.ts`:
  - **Consent (line-verified):** `consent` must be `true`/`"true"` or the request is rejected 400 "Please accept the data-storage consent to apply." (`:133,146`). On insert the row stamps `consent_at = now()` and `consent_version` from `JOBS_CONSENT_VERSION` (default `"2026-06"`, `:21,252-253`).
  - **Turnstile (line-verified):** `verifyTurnstile` (`:68-92`) POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. It **fails CLOSED**: with no `TURNSTILE_SECRET` it returns `"unconfigured"` → the endpoint replies **503** "temporarily unavailable" (`:154-157`), *unless* `ENVIRONMENT=dev` or `TURNSTILE_DISABLED=true` explicitly bypasses (`:74-76`). A missing/failing token → 400 (`:78,158-160`). Production never silently skips bot protection.
  - Other abuse controls: **honeypot** (`body.company` set → fake-success, insert nothing, `:126`), per-IP/email rate limit, duplicate guard, and **résumé magic-byte validation** (`looksLikeDocument`, `:96-105` — sniffs `%PDF`, `PK` zip/docx, or OLE `D0CF11E0` .doc; blocks renamed scripts/images).
  - On success: uploads the base64 résumé to the private `job-resumes` bucket, notifies admins in-app, emails a confirmation via Resend. Env: `TURNSTILE_SECRET`, `TURNSTILE_DISABLED`, `JOBS_CONSENT_VERSION`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SITE_URL`, `ENVIRONMENT`.
- **`jobs-view`** / **`jobs-status`** — public, no auth. `jobs-view` is a funnel-analytics view beacon; `jobs-status` is a login-free status lookup where the emailed per-application `status_token` **is** the capability (returns a sanitized snapshot).
- **`jobs-review`** — admin JWT. Review actions: `set_status`, and `accept` (marks accepted, sends a contractor invite, starts onboarding). Env `GOOGLE_*`, `RESEND_*`, `SITE_URL`.
- **`jobs-retention`** — CRON_SECRET only. Daily PII purge of old applications + résumé files.
