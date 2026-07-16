---
title: Security Review Playbook (Mayday Studio)
last_updated: 2026-07-15
tags: [review, security, rls, supabase, edge-functions]
---

# Security Review Playbook

How Anna threat-models a diff for Mayday Studio. Two Supabase projects (main read-write, Triton read-only). The client bundle is public — everything shipped to the browser is attacker-readable and every value in a request body is attacker-controlled. Trust nothing from the client; enforce at the database and the edge.

Grounded in two prior sweeps: `audit_backend_security_2026-06` (CRIT/HIGH/MED closed 2026-06-01..02) and `audit_security_2026-06-05` (5 fresh CRIT closed in `b99c36d6`). When a review re-flags a "closed" item, check the cited commit/migration first before re-fixing.

**Run mentally, or actually:** `mcp__claude_ai_Supabase__get_advisors` (type `security`) on any migration/RLS change — it flags missing RLS, `SECURITY DEFINER` without `search_path`, exposed columns. Treat a new advisor warning as a finding.

---

## Layer 1 — RLS is the primary boundary

Client role flags (`isAdmin`, `canPost`) are **UX only**. The real gate is the row-level policy. Threat-model every table touched:

- [ ] **RLS is enabled** on any new table (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`). A table with grants and no RLS is world-readable to any authenticated user.
- [ ] **INSERT/UPDATE policies carry `WITH CHECK`.** The `profiles` role self-promotion CRIT was exactly a `USING`-without-`WITH CHECK` UPDATE policy plus a `role`-column grant → trivial self-promote to admin. Closed by the `profiles_lock_admin_fields` BEFORE UPDATE trigger (migration `20260605120000`). Also-missing `WITH CHECK` on `notifications` INSERT (any user spoofs notifs — MED, still open) and `workflow_kanban_v2` sign-offs.
- [ ] **Admin policies use `public.is_admin(auth.uid())`**, which includes `director_creative`/`director_comms`. `role = 'admin'` under-grants (locks directors out) — an availability bug, but also a smell that the policy was hand-rolled.
- [ ] **Never trust `author_id`/`user_id`/`owner_id` from the client.** Canonical pattern: `agency_comments` has a BEFORE INSERT trigger `set_agency_comment_author` (`20260709190000_agency_portal.sql:156-173`) that forces `NEW.author_id := auth.uid()` and snapshots `author_role` from `profiles` server-side — the client value is discarded. The INSERT policy *also* `WITH CHECK (author_id = auth.uid())` (`:189-190`) as belt-and-suspenders. Any new "comment/post/proposal authored by me" table should copy this: trigger to set identity + policy to check it. A column the client sends that determines ownership or role, with no trigger overriding it, is a **BLOCKER**.
- [ ] **Column locks for privileged fields.** Pay/rate/role/folder fields are protected by BEFORE UPDATE triggers that raise on non-admin writes — `profiles_lock_admin_fields` (role/posting_allowed/title/drive folder), `profiles_lock_pay_method` (pay_method), `fl_profile_lock_admin_fields` (rate/payment_type). This is deliberately a trigger, not a column REVOKE (REVOKE would block admins too). A diff that adds a sensitive column to one of these tables must extend the lock trigger.

---

## Layer 2 — SECURITY DEFINER views & functions

`SECURITY DEFINER` runs with the definer's privileges, bypassing RLS — so a bug here is a full RLS bypass.

- [ ] **`SET search_path TO 'public', 'pg_temp'`** on every `SECURITY DEFINER` function (see `set_agency_comment_author` `:159`). Missing search_path is a hijack vector; a repo-wide sweep already fixed the backlog (`20260602120000_security_definer_search_path_sweep.sql`) — new fns must not regress.
- [ ] **`REVOKE EXECUTE ... FROM anon, authenticated, public`** on definer fns that shouldn't be callable directly (`agency_comments` trigger fn revokes at `:175`).
- [ ] **Trimmed views hide PII/pay/notes.** The agency reads through SECURITY DEFINER views `agency_deliverables` (no pay / notes / ad_copy) and `agency_briefs` (no source_text); the base tables (`sponsor_deliverables`, `campaign_briefs`, etc.) are excluded from agency reads via `is_agency()`. A new column added to a base table is invisible to the agency **only if** the view stays column-explicit. Smell: a view defined `SELECT *` — a later `ALTER TABLE ADD COLUMN pay` silently leaks it. **Fix:** views must list columns explicitly; confirm any new sensitive column is not in the trimmed view.

---

## Layer 3 — Secrets & service-role key

- [ ] **Service-role key never reaches the client.** It lives only in edge-fn env (`Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`). `src/supabaseClient.js` uses the anon key. A service-role key, `CRON_SECRET`, or any private token appearing in `src/`, a `REACT_APP_*` var, or a client bundle is a **BLOCKER**.
- [ ] **No secrets committed.** `.env` / `.env.*` are gitignored (the tracked `.env` + `.env.save` CRIT was closed in `b99c36d6` via `git rm --cached`; `!.env.example` is the escape). Any new `.env*` in the diff, or an inline API key/UUID in code or a migration, is a BLOCKER.
- [ ] **Historical leaks are a known residue, not a re-fix.** `CRON_SECRET` was hardcoded in migration `20260328200001_cron_generate_trends.sql` — rotated and moved to Vault (`20260601140000_cron_secret_via_vault.sql`), but the old value `300897BA-.../50EBC188-...` and Triton anon JWT remain in **git history**. Live values are all invalid. Do not "fix" the old migration file (rewriting history isn't worth it unless the repo goes public). If a diff *reintroduces* a plaintext secret in a new migration, that IS a BLOCKER — cron secrets must be read from Vault: `(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')`.

---

## Layer 4 — Edge function auth bypass

Functions deploy `--no-verify-jwt`; the inline gate is the *only* barrier (details in `01-review-checklist.md` §e).

- [ ] **Every `--no-verify-jwt` fn has an inline gate before side effects.** The `workflow-trigger-event` CRIT was an unauthenticated service-role endpoint accepting arbitrary `{event,payload}` — closed by an inline `x-cron-secret`-or-admin-JWT gate. A new service-role edge fn with no gate is a **BLOCKER**.
- [ ] **`fetch-rss` and `snapshot-daily-work` are authed — not gaps.** They are the *only two* functions on the shared `createHandler({auth})` wrapper (`shared/handler.ts:70-126`, which 401s on a missing/invalid credential): `fetch-rss` = `auth:"jwt"` (any signed-in user; also SSRF-guards each feed URL via `shared/url-validation.ts`), `snapshot-daily-work` = `auth:"cron"` (CRON_SECRET). Every *other* fn is bare `Deno.serve` with an inline gate. A NEW fn that burns Anthropic/Whisper or writes data without an admin check + per-user daily cap is a HIGH.
- [ ] **Public endpoints are rate-limited.** Reuse the `public_rate_limits` table + IP/email pattern from `jobs-apply` (5/hour IP, 3/24h email). Intentionally-public beacons/links (`jobs-view`, `mailer-track-open/click`, `mailer-unsubscribe`) are login-free by design — the emailed token/id is the capability; don't flag those, but any *new* public POST that mutates state needs the rate-limit guard.
- [ ] **OAuth state is HMAC-signed** via `shared/oauth-state.ts` (`signState`/`verifyState`, requires `OAUTH_STATE_SECRET`); callbacks emit a generic `oauth_failed` code and never echo `err.message` into the redirect URL (info-leak / open-redirect vector). New OAuth flows must sign state and validate the redirect host.
- [ ] **SSRF:** any fetch to a user-supplied URL goes through `shared/url-validation.ts`.

---

## Layer 5 — SQL injection & dynamic queries

- [ ] **No string-concatenated SQL.** Use parameterized PostgREST filters. The `run-report` fn sanitizes `config.id` before a PostgREST `.or()`; `preview-report` whitelists sources (`rss`, `triton_api`, `triton_brief`) and rejects arbitrary `supabase_query` (which was an arbitrary service-role SELECT vector).
- [ ] **ID params are regex/UUID-validated** before use in a query or filesystem/Drive call — the sweep added guards to `google-drive-resources` (rename/delete/move ids), `google-calendar-sync` (`event_id` UUID via `/^[0-9a-fA-F-]{36}$/`, `google-calendar-sync/index.ts:179`). `drive-upload-init` walks the target folder's parent chain to confirm it lives under an allowed root, so a non-admin can't upload to an arbitrary Drive folder id (`drive-upload-init/index.ts:184-189`). A new fn taking a client id into a query/path without validation is a HIGH.
- [ ] **Dynamic RPC / `.or()` / `.filter()` built from client strings** — sanitize the operand; PostgREST `.or()` is a string mini-DSL and injectable.

---

## Layer 6 — PII / pay / sensitive field exposure

- [ ] **New column on `sponsors`/`sponsor_deliverables`/`campaign_briefs`/`revenue_events`/`profiles`** → confirm it's not exposed to `agency` (trimmed views) or to a non-admin via a loose SELECT policy. Pay, notes, ad_copy, source_text, and payment fields are the sensitive set.
- [ ] **`dangerouslySetInnerHTML` is DOMPurify-wrapped.** Known unsanitized usage: `Dashboard.js:1124` (announcement HTML rendered raw — stored XSS HIGH, still open). Other usages sanitize; a new one must too.
- [ ] **Session scope:** `signOut` should use `{scope:'global'}` — `nukeSession` (called by `signOut`) currently uses `supabase.auth.signOut({ scope: 'local' })` (`AuthContext.js:47`), leaving the refresh token alive (MED). Flag any new sign-out that copies the local scope.

---

## Threat-model checklist (per diff)

| Question | If "no" → |
|----------|-----------|
| Does every touched table have RLS + `WITH CHECK` on writes? | BLOCKER |
| Is any ownership/role field settable by the client without a trigger override? | BLOCKER |
| Do new `SECURITY DEFINER` objects set `search_path` and list columns explicitly? | BLOCKER |
| Could the service-role key / a secret reach the client bundle or git? | BLOCKER |
| Does every `--no-verify-jwt` edge fn gate before side effects? | BLOCKER |
| Are client-supplied IDs/URLs validated before query/fetch/FS use? | HIGH |
| Does any new sensitive column leak to `agency`/non-admin? | HIGH |
| Is user HTML rendered without DOMPurify? | HIGH |
| Does the Supabase security advisor return a new warning? | investigate |

**Design choices not to re-litigate:** trigger-based column locks over RLS WITH-CHECK splits; `x-cron-secret` header over `?secret=`; Vault over `ALTER DATABASE SET` (blocked on managed Postgres); directors treated as admin in `is_admin()`; Stripe webhook authenticated by signature not CRON_SECRET.
