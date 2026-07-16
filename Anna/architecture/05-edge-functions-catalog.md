---
title: Edge Functions Catalog
last_updated: 2026-07-15
tags: [architecture, edge-functions, supabase, deno, integrations]
---

# Edge Functions Catalog (`supabase/functions/`)

**Verified census, not a sample.** `supabase/functions/` holds **99 deployable
functions** (each a directory with an `index.ts`) plus one non-deployable
`shared/` module directory — so "100 entries" in `ls`, 99 functions. Every one
of the 99 was opened and its auth block read for this doc. This file is the
map + the shared anatomy; deep per-function internals live in `Anna/backend/`
(03 = cron/automations/workflows, 04 = integrations).

## Deploy

```
supabase functions deploy <name> --no-verify-jwt
```

`--no-verify-jwt` is standard here — the platform gateway does **not** verify the
JWT, so each function does its **own** auth (see Anatomy), and cron-invoked
functions have no user JWT at all. The deploy command is usually in a header
comment of each `index.ts`.

## The three auth modes (this is the load-bearing distinction)

Every function falls into one of three auth patterns. The catalog tables below
tag each function with its mode.

1. **`dual`** — CRON_SECRET **or** admin JWT. Canonical block (copy-pasted, not
   shared) at `sync-substack/index.ts:27-43`, `sync-fourthwall/index.ts:53-71`,
   `check-data-integrity/index.ts:35-48`: compare `x-cron-secret` header /
   `?secret=` to `Deno.env.get("CRON_SECRET")`; if that fails, require a
   `Bearer` JWT, `auth.getUser()`, and `profiles.role === 'admin'`. This is the
   shape for every cron-driven sync/report that an admin can also trigger
   manually.
2. **`jwt`** — user JWT only, then a role gate. Two implementations:
   - the copy-pasted block (`getUser` + `profiles.role` check), e.g.
     `metricool-posts`, all `google-*`, `plaid-*`;
   - the shared helper `getUserFromJwt(req)` from
     `shared/workflow-engine.ts:51-75` (returns `{userId, isAdmin, role}` or
     `null`), used by `assign-task/index.ts:32-33`, `sprint-task-sync`,
     `workflow-move-card`, `workflow-update-task`, `workflow-complete-task`.
3. **`cron`** — CRON_SECRET only, no user path. Pure background jobs:
   `archive-published-cards`, `mailer-arm-daily`, `mailer-cron-tick`,
   `jobs-retention`, `send-push`, `notify-fl-assignment`, `workflow-internal`.
4. **`public`** — deliberately unauthenticated (a capability token or CAPTCHA is
   the boundary): the `jobs-status`/`jobs-view`/`jobs-apply` careers endpoints,
   the `mailer-track-*`/`mailer-unsubscribe`/`mailer-webhook` recipient-facing
   endpoints, the OAuth callbacks.
Functions that wrap themselves in the shared `createHandler({ auth, ... })`
(`shared/handler.ts:36-166`) get their auth enforced **inside the wrapper**, not
inline — the handler rejects with 401/403 before the callback runs. `auth: "jwt"`
requires a Bearer JWT (`fetch-rss/index.ts:7`), `auth: "cron"` requires the
`CRON_SECRET` header/`?secret=` (`snapshot-daily-work/index.ts:5`), `auth:
"admin_jwt"`/`"cron_or_admin_jwt"` add the `profiles.role === 'admin'` gate, and
`auth: "public"` is the deliberate opt-out. Don't mistake a bare-looking
`Deno.serve(createHandler(...))` for unauthenticated — read the `auth:` value.

Role gates seen in the fleet: `admin` (most), `admin|assistant`
(`generate-brief-onepager/index.ts:84`), and `agency` (specifically **excluded**
in `find-assets-enrich`/`shade-search` — those reject agency callers).
`card-move`/`card-hold` also accept a **service-role bearer** as an internal
bypass so `workflow-complete-task`'s auto-advance can move cards
(`card-move/index.ts:142-144`).

## Common anatomy

Most `index.ts` files follow the same shape:

1. `import "jsr:@supabase/functions-js/edge-runtime.d.ts";` + `createClient`
   from `https://esm.sh/@supabase/supabase-js@2` (a handful still import
   `serve` from `https://deno.land/std@0.177.0/http/server.ts`, e.g.
   `sync-substack/index.ts:2`; newer code uses the global `Deno.serve`).
2. A `corsHeaders` object (`Access-Control-Allow-*`, usually allowing
   `x-cron-secret`) + a `json()`/`jsonResp()`/`jsonResponse()` helper.
3. `Deno.serve(async (req) => {...})` with an `OPTIONS` preflight short-circuit.
4. One of the auth modes above.
5. Privileged DB work uses a **service-role admin client**: either
   `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` inline, or
   `getSupabaseAdmin()` (`sync-*/shared/utils.ts`) or `getAdminClient()`
   (`shared/workflow-engine.ts:42-49`).
6. **PT-time helpers** (`ptDayString`, etc.) are copy-pasted into many functions
   because the server runs UTC but daily metrics / due dates key on the
   America/Los_Angeles calendar (`sync-twitch/index.ts:13-17`,
   `sync-substack/index.ts:19-23`).

### Shared modules (`supabase/functions/shared/`) — NOT a function

The `shared/` dir is imported by functions, never deployed. Its members
(verified `ls`):

| File | Role |
|---|---|
| `workflow-engine.ts` (827 ln) | The column/sign-off state machine **and** `getUserFromJwt`, `getAdminClient`, `corsHeaders`, `jsonResp`, `notifyUser`, `logEvent`. Grab-bag: even `mailer-webhook` imports its CORS/admin helpers from here (`mailer-webhook/index.ts:16-20`). |
| `workflow-definitions.ts` (431 ln) | Code-defined `WORKFLOW_REGISTRY` (legacy) + the builder that assembles a `WorkflowDefinition` from `workflow_steps` DB rows. |
| `action-registry.ts` (309 ln) | `ACTION_REGISTRY` of named side-effect handlers (`ad_read:accept_proposal`, `mayday:film_send_handoff`, …). |
| `handler.ts` (149 ln) | Shared request handler scaffolding. |
| `utils.ts` (+`utils_test.ts`) | `getSupabaseAdmin`, `getActiveAccounts`, `ingestion_logs` lifecycle, `fetchWithRetry`, `upsertContentWithMetrics`, `jsonResponse`, `errorResponse`. |
| `report-sources.ts` (+`_test`) | Report data-source registry for `run-report`/`preview-report`. |
| `oauth-state.ts` | Signed OAuth `state` (Google flows). |
| `resend.ts` | `resendSend` email wrapper. |
| `url-validation.ts` | `isSafeExternalUrl` SSRF guard (used by `sync-substack:62`). |
| `mailer-render.ts` / `mailer-bindings.ts` / `mailer-links.ts` | Mailer HTML render, template bindings, tracked-link rewriting. |
| `progress-drive.ts` | Drive helpers for the Progress board (`progress-rename`/`-reorder`, `sync-progress-cards`). |

Sync functions also carry a **per-function** `shared/` dir with their own copy
of `utils.ts`: `sync-youtube/shared/`, `sync-youtube-dimensions/shared/`,
`backfill-youtube-dimensions/shared/` (verified — only these three).

### Cron wiring

Scheduled functions are armed via **pg_cron + pg_net** in migrations, not a
config file. `cron.schedule` runs `net.http_post` to the function URL with the
secret pulled from `vault.decrypted_secrets` (name `cron_secret`) and passed as
`?secret=` (or an `X-Cron-Secret` header). See `Anna/backend/03-cron-automations.md`.

---

## Full census (all 99, grouped)

Auth key: **D**=dual (CRON_SECRET or admin JWT), **J**=admin JWT,
**Ja**=admin|assistant JWT, **C**=CRON_SECRET only, **P**=public (token/CAPTCHA).
(There are **no** unauthenticated write endpoints — functions that look bare wrap
`createHandler({ auth })`, which enforces auth in the wrapper.)

### Platform sync (`sync-*`, `youtube-*`, `backfill-*`)

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `sync-youtube` | D | Pull YouTube Data+Analytics → `content_items`/`content_metrics`/`platform_daily_metrics`; fires `new_video` automation events. | `YOUTUBE_API_KEY`, `YOUTUBE_CLIENT_ID/SECRET`, per-channel refresh tokens, `CRON_SECRET`, `SUPABASE_URL` |
| `sync-youtube-dimensions` | D | Backfill YouTube traffic-source / geo dimensions. | `YOUTUBE_CLIENT_ID/SECRET`, `CRON_SECRET` |
| `backfill-youtube-dimensions` | D | One-shot dimension backfill worker. | `YOUTUBE_API_KEY`, `YOUTUBE_CLIENT_ID/SECRET`, `CRON_SECRET` |
| `youtube-scheduled` | J | Return scheduled (not-yet-public) videos for the Tracking page's Upcoming section. | `YOUTUBE_CLIENT_ID/SECRET`, `SUPABASE_SERVICE_ROLE_KEY` |
| `sync-metricool` | D | Daily account-level IG/FB/TikTok metrics → `platform_daily_metrics`/`audience_snapshots`. | `METRICOOL_TOKEN/USER_ID/BLOG_ID`, `CRON_SECRET` |
| `sync-twitch` | D | Followers/subs/live/VODs from Twitch Helix. **Rotating refresh token** (old one dies on refresh, `:48-49`). | `TWITCH_CLIENT_ID/SECRET`, `CRON_SECRET` |
| `sync-fourthwall` | D | Merch orders → `revenue_events` (`product_category='merch'`). **Basic auth** = `btoa(user:pass)` (`:80`). | `FOURTHWALL_USERNAME/PASSWORD`, `CRON_SECRET` |
| `sync-stripe` | D | Two modes: signed Stripe webhook + daily batch reconcile → `revenue_events`. | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET` |
| `sync-substack` | D | RSS feed → article `content_items`. Subscriber-count endpoint **deprecated by Substack ~2026-03** (`:70-74`); SSRF-guards custom domains. | `CRON_SECRET` |
| `sync-simplecast` | D | Podcast download analytics per `platform_accounts` (platform=`simplecast`). | `CRON_SECRET` |
| `sync-tiller` | D | Tiller Google-Sheets → `revenue_transactions`/`expense_transactions`; app-side categorize (rules→Claude). | `GOOGLE_*`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CRON_SECRET` |
| `sync-progress-cards` | D | Reconcile `progress_cards` against Drive editing/ready folders (Claude-assisted). | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `GOOGLE_*` via `progress-drive.ts`, `CRON_SECRET` |
| `run-backfills` | D | Drain `sync_backfill_queue` by dispatching to the relevant `sync-*` fn with a target date. | `CRON_SECRET`, `SUPABASE_URL` |
| `check-data-integrity` | D | Daily: verify yesterday's metric/snapshot rows exist per active account; alert admins. | `CRON_SECRET` |

**`sync-meta` does not exist.** Meta (IG+FB) account metrics come through
`sync-metricool`. The only consumer of `META_ACCESS_TOKEN` is
`post-daily-graphics` (posts a graphic to the FB/IG Graph API). The prior draft
of this doc listed a `sync-meta` function — that was wrong.
`metricool-create-post` also **does not exist** (also wrongly listed before).

### Metricool

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `metricool-posts` | J | List scheduled/published posts (payload leaks `creatorEmail`, hence admin-gated). | `METRICOOL_TOKEN/USER_ID/BLOG_ID` |
| `metricool-stories` | J | IG story counts/day (last N days) — powers the "Do this more" dashboard widget. | `METRICOOL_TOKEN/USER_ID/BLOG_ID` |

### Google — OAuth + Calendar + Drive

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `google-auth-url` | J | Build per-admin consent URL (signed state via `oauth-state.ts`). | `GOOGLE_CLIENT_ID` |
| `google-auth-callback` | P | OAuth redirect target: exchange code → store tokens. | `GOOGLE_CLIENT_ID/SECRET`, `SITE_URL` |
| `google-disconnect` | J | Drop a user's calendar connection. | `SUPABASE_SERVICE_ROLE_KEY` |
| `google-calendars-list` | J | List the user's Google calendars. | `GOOGLE_CLIENT_ID/SECRET` |
| `google-calendar-sync` | J | Push one app event create/update/delete → Google (uses caller's own connection, `:191-206`). | `GOOGLE_CLIENT_ID/SECRET` |
| `google-calendar-fetch` | J | Pull Google → app `calendar_events`. | `GOOGLE_CLIENT_ID/SECRET` |
| `google-drive-folders` | J | Browse a locked "Long Form" Drive root (service refresh token). | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID/SECRET` |
| `google-drive-resources` | J | Browse locked "HOW WE WORK" resources root. | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_*` |
| `google-drive-research` | J (**no admin gate**) | Copy/open research docs — open to any authed user, unlike resources (`:header`). | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_*` |
| `google-drive-write` | J | Browse the writing-folder Drive root. | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_*` |
| `google-drive-create-sheet` | J | Create a Google Sheet in Drive. | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_*` |
| `drive-list-clips` | D | List video files in a recipient's Drive folder to import missed clips into `shorts_queue`. | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_*`, `CRON_SECRET` |
| `drive-list-contractor-folders` | J | List a contractor's root + nested Drive folders. | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_*` |
| `drive-upload-init` | J | Init a Drive **resumable** upload session; browser PUTs bytes directly (dodges the 6 MB edge payload cap). | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_*`, `SUPABASE_SERVICE_ROLE_KEY` |
| `pitch-video-drive` | J | Folder picker for the Pitch Video tool's "Upload to Drive" (confined to a Pitch Videos root). | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_*` |
| `drive-watch-register` | J | Register a poll-based watch on a Drive folder. | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_*` |
| `drive-watch-poll` | C | Minutely cron: walk `drive_watches`, emit `drive_events` for new files → freelancer assignments. | `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_*`, `CRON_SECRET` |
| `drive-watch-stop` | J | Soft-delete a `drive_watches` row (keeps `drive_events` history). | `SUPABASE_SERVICE_ROLE_KEY` |

### Cloud/NAS + asset search

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `cloud-folders` | J | Proxy to the self-hosted NAS asset service. | `CLOUD_API_URL` (`https://assets.maydaystudio.net`), `CLOUD_API_KEY` |
| `shade-search` | J (**rejects agency**) | Shade drive proxy for the Asset Search tool. | `SHADE_API_KEY`, `SHADE_DRIVE_ID` |
| `find-assets-enrich` | J (**rejects agency**) | LLM context layer for Beat Sheets "Find Assets". | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |
| `organize-autotag` | J | Claude auto-labels media in the Organize tool (suggestions only, nothing moved). | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |

### Research + reporting (Claude-powered)

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `fetch-rss` | J* | Ingest enabled `research_feeds` → `research_articles`. `createHandler({ auth: "jwt" })` — any **authed** user (no admin role gate, unlike most `J`). | — |
| `generate-trends` | D | Daily 8am-PT Claude trends report → `research_trends`. | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CRON_SECRET` |
| `generate-ashley-read` | D | Weekly Ashley Analytics read → **inserts** `ashley_reads` row. | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CRON_SECRET` |
| `generate-weekly-report` | D | Weekly KPI report (email via Resend). | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `WEEKLY_REPORT_EMAILS`, `RESEND_FROM_EMAIL`, `CRON_SECRET` |
| `generate-monthly-report` | D | Monthly accounting report (3rd of month). | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CRON_SECRET` |
| `generate-brief-onepager` | **Ja** | Campaign brief → one-pager. **Model override** `CLAUDE_MODEL_ONEPAGER` (default `claude-opus-4-7`). | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL_ONEPAGER` |
| `run-report` | D | Section-based report runner (each section = source + prompt). | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `RESEND_*`, `CRON_SECRET` |
| `preview-report` | J | Stateless report preview (no `report_runs` write); editor's conversational UI. | `ANTHROPIC_API_KEY` |
| `stats-query` | J | Claude-driven analytics Q&A. **Uses `claude-haiku-4-5`** default (`:127,238`). | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |
| `categorize-backlog` | D | Chew through `Uncategorized`/`auto` transactions (rules → Claude). | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CRON_SECRET` |

### Assistant (Gerald / Mayday Assistant, `assist.mmcreate.io`)

All **J** (admin JWT), CORS origin-restricted to the assistant domains.

| Function | Purpose |
|---|---|
| `assistant-summary` | Read-only admin snapshot (projects/sprint/deliverables/tasks/calendar, 14-day window). |
| `assistant-messages` | Caller's DM threads + @mention channel messages since a cursor. |
| `assistant-send-dm` | Send a DM as the caller (must be a participant). |
| `assistant-create-card` | Insert a `personal_tasks` card as the caller (V6 Phase 4). |
| `assistant-complete` | Complete a sprint task/goal on the caller's behalf (deliverables/deadlines intentionally NOT writable). |
| `assistant-workflow-status` | Read-only "what's each person / project on right now" (V6 Phase 5). |

### Automations & workflows

| Function | Auth | Purpose |
|---|---|---|
| `run-automations` | D (event mode = **CRON only**) | The automation engine — schedule + event modes. See doc 03. |
| `approve-automation` | J | Resolve an admin confirmation-gate task → fire the deferred actions. |
| `workflow-start` | J | Start a workflow instance (kanban card on col 1) via `enterColumn`. **Gated off**: `WORKFLOWS_CREATION_DISABLED` (client `workflowApi.js:8`) short-circuits this. |
| `workflow-trigger-event` | D | Event-triggered card creation. Also gated off by `WORKFLOWS_CREATION_DISABLED`. |
| `workflow-complete-task` | J | Complete a task / sign off; auto-advances the card. **Null-guards `workflow_instance_id`** to also handle standalone tasks (`:47,138`). |
| `workflow-update-task` | J | Hold/resume/snooze/reassign/skip a task. |
| `workflow-move-card` | J | Admin escape hatch: move a card to a target column. |
| `workflow-internal` | C | Service-role entry for DB triggers to drive workflow ops without a JWT (`?secret=`). Honors `WORKFLOWS_DISABLED`. |

### Content board / cards / progress

| Function | Auth | Purpose |
|---|---|---|
| `card-move` | J (+ service-role bypass) | Unified Content Kanban move; forward = admins+stage-assignees, backward = admins only (`:250-252`). |
| `card-hold` | J | Hold/unhold a card (sets `projects.on_hold`, pauses open tasks). |
| `archive-published-cards` | C | Daily: archive Publish-column cards older than 7 days. |
| `categorize-backlog` | D | (listed above under research) |
| `progress-rename` | J | Rename a Progress card **and** its Drive file (rename is required for sync matching). |
| `progress-reorder` | J | Drag-reorder Editing/Ready columns; renumbers `N. <title>` Drive filenames. |
| `sync-progress-cards` | D | (listed above under sync) |

### Tasks / sprints

| Function | Auth | Purpose |
|---|---|---|
| `assign-task` | J | Create/cancel one-off (workflow-less) `tasks` rows (Assignments page). |
| `reassign-task` | J | Reassign a `tasks` row **and** reconcile sprint routing. |
| `sprint-task-sync` | J | Sprint↔Tasks sync for non-admins (create/reactivate/update_title). |
| `snapshot-daily-work` | C | Nightly snapshot of each admin's work. `createHandler({ auth: "cron" })` — CRON_SECRET required (`:5`). |

### Jobs / hiring (careers board)

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `jobs-apply` | P (CAPTCHA + consent) | Public application submit; Turnstile **fails closed**, honeypot, rate-limit, résumé magic-byte check, consent stamp. | `TURNSTILE_SECRET`, `TURNSTILE_DISABLED`, `JOBS_CONSENT_VERSION`, `RESEND_*`, `SITE_URL`, `ENVIRONMENT` |
| `jobs-view` | P | Login-free view beacon (funnel analytics). | `SUPABASE_SERVICE_ROLE_KEY` |
| `jobs-status` | P (token = capability) | Login-free status lookup via emailed `status_token`. | `SUPABASE_SERVICE_ROLE_KEY` |
| `jobs-review` | J | Admin review actions (status/accept → contractor invite). | `GOOGLE_*`, `RESEND_*`, `SITE_URL` |
| `jobs-retention` | C | Daily PII purge of old applications + résumé files. | `CRON_SECRET` |

### Accounting (Plaid + Tiller + CSV)

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `plaid-link-token` | J | Create a Plaid Link token (update-mode with `itemId`). | `PLAID_CLIENT_ID/SECRET/ENV` |
| `plaid-exchange-token` | J | Exchange public_token → access_token; register accounts. | `PLAID_CLIENT_ID/SECRET/ENV` |
| `plaid-sync` | D | Cursor `/transactions/sync`; categorize (rules→Claude); cutover guard. | `PLAID_*`, `PLAID_CUTOVER_DATE`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CRON_SECRET` |
| `sync-tiller` | D | (listed under sync) |
| `import-transactions` | J | Manual CSV import fallback (Amex etc.); `positiveIs` sign param. | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |
| `import-tiller-v1` | D | **One-off** historical Tiller v1 sheet import. | `GOOGLE_*`, `CRON_SECRET` |

### Mailer (campaign email, beta)

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `mailer-arm-daily` | C | Daily: clone recurring templates into dated campaigns. | `CRON_SECRET` |
| `mailer-cron-tick` | C | Per-minute: flush due scheduled campaigns → `mailer-send-now`. | `CRON_SECRET` |
| `mailer-send-now` | D | Send a campaign to its audience now. | `MAILER_DEFAULT_FROM`, `MAILER_PUBLIC_URL`, `CRON_SECRET` |
| `mailer-domain` | J | Manage Resend sender domains; mirror into `mailer_sender_domains`. | `RESEND_API_KEY` |
| `mailer-webhook` | P (**Svix HMAC**) | Resend delivery/open/click/bounce events → `mailer_sends` + stats. Verifies signature, replay-window, dedup. | `MAILER_WEBHOOK_SECRET`, `ENVIRONMENT` |
| `mailer-track-open` | P | 1×1 gif open-tracker pixel. | — |
| `mailer-track-click` | P | Click-tracking redirect (302 onward). | — |
| `mailer-unsubscribe` | P | RFC-8058 one-click + footer unsubscribe. | — |

### Notifications / email / push / graphics

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `send-notification-email` | D | Email a notification via Resend. | `RESEND_FROM_EMAIL`, `SITE_URL`, `CRON_SECRET` |
| `send-push` | C | Web Push to a user's subscribed devices (fired by `notifications_push_trigger`). | `VAPID_KEYS_JWK`, `CRON_SECRET` |
| `notify-fl-assignment` | C | Email a freelancer on (re)assignment (trigger-driven). | `RESEND_*`, `SITE_URL`, `CRON_SECRET` |
| `fetch-daily-graphics` | D | Fetch the day's graphics for the daily-post pipeline. | `CRON_SECRET` |
| `post-daily-graphics` | D | Post graphics to FB/IG Graph API. **Only consumer of `META_ACCESS_TOKEN`.** | `META_ACCESS_TOKEN`, `CRON_SECRET` |
| `imagine-history` | J | REST verbs (GET/POST/DELETE via `?op=`) on the Imagine tool's history. | `SUPABASE_SERVICE_ROLE_KEY` |

### User admin / SSO / integrity

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `invite-user` | J | Invite a user (role/title/pay/Drive+cloud folder restrictions); provisions cloud folder. | `CLOUD_API_URL/KEY`, `SITE_URL` |
| `remove-user` | J | Deactivate/remove a user. | `SUPABASE_SERVICE_ROLE_KEY` |
| `triton-link` | J | Mint a short-lived signed JWT (`jose`) for SSO into Triton Apex. | `STUDIO_TRITON_SECRET`, `TRITON_URL` |
| `twitch-auth-callback` | P | Twitch OAuth redirect target → store tokens. | `TWITCH_CLIENT_ID/SECRET`, `SITE_URL` |

## Shared env vars (fleet-wide)

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
`ANTHROPIC_API_KEY` + `CLAUDE_MODEL`, `METRICOOL_TOKEN/USER_ID/BLOG_ID`, the
`YOUTUBE_*`/`TWITCH_*`/`FOURTHWALL_*`/`STRIPE_*` platform creds, `GOOGLE_CLIENT_ID/SECRET`
+ `GOOGLE_DRIVE_REFRESH_TOKEN`, `CLOUD_API_URL/KEY`, `SHADE_API_KEY/DRIVE_ID`,
`RESEND_API_KEY`/`RESEND_FROM_EMAIL` + `MAILER_*`, `PLAID_*`, `VAPID_KEYS_JWK`,
`TURNSTILE_SECRET`, `META_ACCESS_TOKEN`, `TRITON_*`/`STUDIO_TRITON_SECRET`,
`SITE_URL`, `ENVIRONMENT`, `WORKFLOWS_DISABLED`. Set via the Supabase dashboard /
`supabase secrets set`. Full per-integration detail: `Anna/backend/04-integrations.md`.

## Dead / one-off / gated-off functions

- **`import-tiller-v1`** — one-time historical import; still deployed, no cron.
- **`workflow-start` / `workflow-trigger-event`** — **gated off** at the client
  by `WORKFLOWS_CREATION_DISABLED = true` (`src/lib/workflowApi.js:8`, "Phase 2
  of unified Kanban migration: stop creating new workflow instances"). The
  functions still exist and still work if called directly; in-flight workflows
  continue to advance via `workflow-complete-task`.
- **No newsletter functions** — `receive-newsletter` / `ingest-newsletter`
  (Mailgun) referenced in CLAUDE.md **do not exist on disk** (confirmed by `ls`).
  Newsletters are RSS-only. Treat CLAUDE.md's note as historical.

## Security note

An old `CRON_SECRET` value is hardcoded in
`20260328200001_cron_generate_trends.sql` git history — rotated and moved to
Vault (`vault.decrypted_secrets`), but the stale literal remains in history. New
cron migrations pull from Vault, never hardcode. See `Anna/review/02-security-review.md`.
Note: unlike a prior draft of this doc claimed, there are **no** unauthenticated
write endpoints — `fetch-rss` (`auth: "jwt"`) and `snapshot-daily-work`
(`auth: "cron"`) are both authed via the shared `createHandler` wrapper.
