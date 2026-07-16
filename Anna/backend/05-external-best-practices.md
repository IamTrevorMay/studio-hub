---
title: External Best Practices — Supabase & Postgres (2025–2026)
last_updated: 2026-07-15
tags: [backend, external, best-practices]
---

# External Best Practices — Supabase & Postgres (2025–2026)

The other backend docs describe what *this* repo does. This one describes what the wider Supabase/Postgres
world considers correct as of 2025–2026, cites the sources, and — for each practice — maps it to Mayday
Studio: **what we do, where we already comply, and where we should improve.** The point is calibration: our
conventions are largely sound (the `agency_comments` trigger, the `is_admin()`/`is_agency()` helpers, the
Vault cron secret), but "we already do X" is only credible when measured against the current external
standard. Where we diverge, this doc is honest about it.

Read alongside `02-migrations-rls.md` (the house RLS pattern), `03-cron-automations.md` (the Vault cron
wiring), and `../review/02-security-review.md` (the six-layer threat model). Nothing here overrides those —
it grounds them.

---

## 1. RLS hardening

### 1.1 RLS enabled is the whole ballgame — the default is *off*

Tables created via raw SQL or the Table Editor have RLS **off by default**; a table with grants and no RLS is
readable (and often writable) by anyone holding the anon key, which ships in the client bundle by design. This
is not theoretical: **CVE-2025-48757** (May 2025) found 303 endpoints across 170 Lovable-built projects
exposing Supabase tables to unauthenticated anon-key requests — ~13,000 users' records, reset tokens, and
payment metadata paged straight out of `/rest/v1/<table>`. The fix is one line per table:
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` plus real policies (never `USING (true)` as the only gate).
([Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security),
[CVE-2025-48757 breakdown](https://vibeappscanner.com/supabase-row-level-security))

**Applied to Mayday Studio:** We comply well. The house pattern (`02-migrations-rls.md`) puts
`enable row level security` immediately after every `create table`, and the security review makes a missing
RLS a BLOCKER. The residual risk is the *ad-hoc* table — anything created through the dashboard or a hotfix
`execute_sql` that skips the migration ritual. Mitigation already in the playbook: run
`get_advisors` (type `security`) after any schema change — it flags RLS-disabled tables and permissive
policies. Treat a new advisor warning as a finding, every time.

### 1.2 Wrap `auth.uid()` / helper calls in a scalar subselect — the initplan trap

Calling `auth.uid()`, `auth.jwt()`, or a `SECURITY DEFINER` helper *bare* inside a policy makes Postgres
re-evaluate it **once per row**. Wrapping it — `(select auth.uid()) = user_id`, `(select public.is_admin())`
— lets the planner hoist it into a single `InitPlan` evaluated **once per statement**, cached for the whole
scan. On large tables this is a 90–100×+ difference; teams have rewritten dozens of policies in a single
migration purely for this. The technique is only valid for values that don't vary by row (which `auth.uid()`
and role helpers satisfy).
([Supabase RLS performance guide](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv),
[the auth.uid() initplan trap](https://dev.to/arvavit/76-rls-policies-rewritten-in-one-migration-the-authuid-init-plan-trap-in-supabase-4hg))

**Applied to Mayday Studio — divergence.** Our canonical policy shape calls helpers **bare**:
`using ( public.is_admin(auth.uid()) )` and `exists (select 1 from profiles where id = auth.uid() ...)`
(see `02-migrations-rls.md`). At our current data scale (thousands of rows, not millions) the per-row cost is
invisible, so this is not a live problem. But it is a latent one: the `platform_daily_metrics`,
`audience_snapshots`, and any analytics table that grows unbounded are the places it will first bite. **Improve:**
for *new* policies on high-row tables, prefer `(select public.is_admin(auth.uid()))` and
`user_id = (select auth.uid())`. Don't mass-rewrite existing policies without a measured reason — the risk of
a typo'd policy outweighs a micro-optimization on a 2k-row table.

### 1.3 Index the columns your policies filter on, and add `TO authenticated`

RLS predicates are just WHERE clauses; a policy on `owner_id = auth.uid()` still does a seq scan unless
`owner_id` is indexed. Supabase measures >100× wins from indexing non-PK RLS columns. Separately, always
scope policies with `TO authenticated` (or the specific role) rather than leaving them role-open — a policy
that only rules out `anon` via `auth.uid() IS NOT NULL` still gets *evaluated* for anon; naming the role lets
the planner skip it entirely.
([Supabase RLS performance guide](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv))

**Applied to Mayday Studio:** We reliably write `to authenticated` (per the house pattern) — good. Indexing
of RLS filter columns is inconsistent: FK columns like `initiative_id`, `phase_id` usually get indexes for the
join, but ownership columns (`owner_id`, `created_by`, `user_id`) are often only covered by a `unique
(idea_id, user_id)` composite that may not front the RLS predicate. **Improve:** when a new table's policy
filters on a bare `owner_id`/`user_id`, add a btree index on it in the same migration.

### 1.4 Never trust the client for ownership or role — enforce in triggers + policy

The client bundle is public; every field in a request body is attacker-controlled. Ownership and role must be
stamped server-side, not read from the payload. The robust pattern is a `BEFORE INSERT` trigger that
overwrites the identity column from `auth.uid()`, *plus* a `WITH CHECK` policy asserting the same — two
independent gates. ([Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security),
[production RLS patterns](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices))

**Applied to Mayday Studio — reference implementation.** This is exactly our `agency_comments` pattern: the
`set_agency_comment_author` `BEFORE INSERT` trigger forces `NEW.author_id := auth.uid()` and snapshots
`author_role` from `profiles`, while the INSERT policy *also* `WITH CHECK (author_id = auth.uid())`
(`20260709190000_agency_portal.sql:156-190`). The security review makes a client-settable ownership column
with no trigger override a BLOCKER. We're ahead of the curve here — the one thing to watch is that **every new
"authored by me" table copies both halves**, not just the policy.

---

## 2. `SECURITY DEFINER` functions & views

### 2.1 Pin `search_path` on every definer object — the CVE-2018-1058 class

A `SECURITY DEFINER` function runs with the *owner's* privileges. If its `search_path` is not pinned, a
caller can `SET search_path = evil_schema;` and plant a shadowing function or operator that resolves before
`pg_catalog`, executing attacker code as the definer — a full privilege-escalation. The standing rule:
**pin `search_path` on the function itself** (role- or session-level settings are bypassable), put only trusted
schemas on it, and append `pg_temp` **last** so a temp-table shadow can't win. Prefer `set search_path =
pg_catalog, pg_temp` (or `public, pg_temp` when the function genuinely needs `public`) and schema-qualify
object references. ([Abusing SECURITY DEFINER functions — Cybertec](https://www.cybertec-postgresql.com/en/abusing-security-definer-functions/),
[CVE-2018-1058 guide — PostgreSQL wiki](https://wiki.postgresql.org/wiki/A_Guide_to_CVE-2018-1058%3A_Protect_Your_Search_Path))

**Applied to Mayday Studio — compliant, with a maintenance obligation.** Every `is_*` helper and trigger fn
here is `security definer ... set search_path = public, pg_temp`, and a repo-wide sweep
(`20260602120000_security_definer_search_path_sweep.sql`) fixed the backlog. **Do not regress** — a new
definer function without a pinned `search_path` is a BLOCKER, and `get_advisors` flags it. Our functions use
qualified references (`public.profiles`), which is the belt to the search_path suspenders.

### 2.2 `security_barrier` on views that gate access, and list columns explicitly

A plain view can leak rows: the planner may push a cheap user-supplied function down *below* the view's own
WHERE, so a `WHERE is_agency(...)` filter runs after an attacker's predicate has already seen every row.
`WITH (security_barrier)` forbids that reordering, making the view a real trust boundary. Second rule:
definer/barrier views must **enumerate columns**, never `SELECT *` — a later `ALTER TABLE ADD COLUMN pay`
silently joins the exposed set otherwise.
([Supabase RLS docs — security definer/invoker views](https://supabase.com/docs/guides/database/postgres/row-level-security))

**Applied to Mayday Studio — reference implementation.** The agency portal is textbook: `agency_deliverables`
and `agency_briefs` are `WITH (security_barrier)` views that list columns explicitly (dropping pay/notes/
ad_copy/source_text), gated by `WHERE is_agency(auth.uid()) OR is_admin(auth.uid())`, while the base tables
exclude agency from their own policies — two independent gates (`20260709190000_agency_portal.sql:107-130`).
The one live hazard, already called out in the security review: a base table gaining a sensitive column while
someone assumes the view hides it. It only hides it because the view is column-explicit. **Improve/enforce:**
any migration adding a column to `sponsor_deliverables`/`campaign_briefs`/`sponsors`/`revenue_events` must
consciously decide whether the agency views should include it — and the default answer is no.

### 2.3 `REVOKE EXECUTE` from `anon`/`public` on definer functions

A definer function that bypasses RLS shouldn't be directly callable by roles that have no business invoking it.
After creating it, `REVOKE EXECUTE ... FROM anon, public` (and `authenticated` unless a logged-in user
legitimately calls it), granting only to the roles that need it.
([Abusing SECURITY DEFINER functions — Cybertec](https://www.cybertec-postgresql.com/en/abusing-security-definer-functions/))

**Applied to Mayday Studio:** We do this for the sensitive ones (`agency_comments` trigger fn revokes at
`:175`; agency helper execution locked at `:135`). It's applied *selectively* rather than universally — the
`is_*` helpers used inside policies must stay callable by `authenticated` (policies evaluate as the caller), so
a blanket revoke would break them. That's the correct nuance, not a gap. **Improve:** for a *new* definer
function that is only ever called by another function or a trigger (never directly by a client), revoke from
`anon, authenticated, public` outright.

---

## 3. Edge function (Deno) best practices

### 3.1 Prefer platform JWT verification; if you skip it, you own auth entirely

Supabase's guidance: keep `verify_jwt = true` (the default) so the platform validates the caller's JWT before
your handler runs, and use an RLS-scoped client (`ctx.supabase`) rather than the service-role client for
user-initiated work — only reach for the service role when you genuinely need to bypass RLS. When you *do*
skip verification (`auth: 'none'` / `--no-verify-jwt`), "your handler is fully responsible for authenticating
the caller. Never use it on an endpoint that reads or writes sensitive data without verifying the caller some
other way." Internal callers (cron/pg_net/another function) should present a secret on a header, not a user JWT.
([Securing Edge Functions — Supabase docs](https://supabase.com/docs/guides/functions/auth))

**Applied to Mayday Studio — divergence, deliberate.** We deploy **every** function `--no-verify-jwt` and gate
inline (the three patterns in `01-edge-function-anatomy.md`: admin-JWT, `CRON_SECRET`-or-JWT dual, and pure
`--no-verify-jwt`). This is the opposite of the platform default, and it means the *inline gate is the only
barrier* — a function that forgets it is wide open (the historical `workflow-trigger-event` CRIT was exactly
this). The choice is defensible (uniform deploy command, cron and browser callers share one function) but it
concentrates all auth risk in hand-written code. **Improve (two levers):** (1) A new `--no-verify-jwt` function
with no gate before its first side effect is a BLOCKER — the review already enforces this; keep it absolute.
(2) Consider whether purely user-facing functions with no cron caller would be *safer* left at `verify_jwt =
true`, letting the platform do the check. Also note we mostly use the **service-role client** even for
user-scoped reads and re-check the role in code; the more defensive default (an RLS-scoped client built from
the caller's Authorization header) would make an auth mistake fail *closed*.

### 3.2 CORS: allowlist origins for anything exposing sensitive data; centralize the headers

`Access-Control-Allow-Origin: *` is fine for public/idempotent endpoints but wrong for any function that
returns admin PII to a browser — reflect only allowlisted origins and set `Vary: Origin`. Route *all* responses
(success and error) through one `json()`/`error()` helper so you can't ship a response that forgot its CORS
headers. ([Securing Edge Functions — Supabase docs](https://supabase.com/docs/guides/functions/auth),
[Deploying Edge Functions securely — Gosign](https://www.gosign.de/en/magazine/supabase-edge-functions-secure/))

**Applied to Mayday Studio — partial.** Most functions use `Allow-Origin: *`, which is acceptable for the
service-role RPC style. The one that returns admin PII to a browser (`assistant-summary`, powering
`assist.mmcreate.io`) *does* allowlist origins and set `Vary: Origin` (`:21-36`) — correct. We do **not** have
a shared `json()/error()` wrapper; each function inlines its `corsHeaders` and can forget them on an error
path. **Improve:** a tiny shared `shared/http.ts` returning CORS-stamped `json()`/`error()` would remove a
whole bug class and is low-risk to introduce incrementally.

### 3.3 Secrets: env for edge-only, Vault for anything Postgres reads; never hardcode

Store edge-function credentials as project secrets read via `Deno.env.get(...)`; never hardcode them in code.
For secrets that a **database** function needs (the pg_cron/pg_net case), use **Supabase Vault** — it stores
authenticated-encrypted secrets that stay encrypted in backups and replication, and you read the decrypted
value at call time. The dividing line: env var for edge-only secrets, Vault for secrets SQL must see.
([Environment Variables — Supabase docs](https://supabase.com/docs/guides/functions/secrets),
[Vault — Supabase docs](https://supabase.com/docs/guides/database/vault))

**Applied to Mayday Studio — compliant post-remediation.** Edge secrets (`ANTHROPIC_API_KEY`,
`METRICOOL_TOKEN`, service-role key) live in function env; the cron secret lives in Vault
(`vault.decrypted_secrets where name = 'cron_secret'`) after the `20260601140000` migration. See §5 for the
history-leak residue. Also relevant: Supabase's move to **publishable/secret API keys** (replacing
anon/service_role naming) — worth tracking, but no action needed until Supabase deprecates the legacy keys.
([Migrating to new API keys — Supabase docs](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys))

### 3.4 Idempotency: dedup on a stable provider event id, with a persisted key + TTL

Every webhook provider delivers **at-least-once** — duplicates are the contract, not an edge case. Make
processing idempotent: dedup on the provider's stable event id (Stripe's `evt_...`, not the request body,
which re-serializes), persist first-seen keys in Postgres with a TTL that exceeds the provider's retry window,
and forward your event id downstream as the next hop's idempotency key so the whole chain dedupes.
([Implement webhook idempotency — Hookdeck](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency),
[Webhook idempotency & deduplication — Hooklistener](https://www.hooklistener.com/learn/webhook-idempotency-and-deduplication))

**Applied to Mayday Studio — good pattern, one gap.** The Automations engine dedups via template keys resolved
at runtime (`payroll_{{today}}`, `clip_{{video_id}}`) so a re-fired trigger can't create a duplicate task —
the right shape (`03-cron-automations.md`). The gap is at the **external webhook boundary**: the Stripe sync
path should dedup on Stripe's `evt_...` id, and any provider webhook should persist the event id (unique
constraint on an `ingested_events(event_id)` table) rather than trusting the trigger fires once. **Improve:**
audit `sync-stripe`/`sync-fourthwall` ingestion for event-id-level dedup; a unique constraint plus
`on conflict do nothing` is the cheap, correct guard.

### 3.5 Cold-start & structured logging

Cold starts are dominated by import cost — pin dependency versions, use `npm:`/`jsr:` specifiers (never bare
specifiers), and keep the module graph small. Log **structured** (JSON with a request id and the function
name) so `get_logs` and the dashboard are searchable, and always `try/catch` around side effects returning a
JSON error rather than letting the runtime 500.
([Development tips — Supabase docs](https://supabase.com/docs/guides/functions/development-tips),
[Edge Functions in Deno: a production guide — DEV](https://dev.to/kanta13jp1/supabase-edge-functions-in-deno-a-production-guide-5d95))

**Applied to Mayday Studio — mostly compliant, logging is ad hoc.** We import via `https://esm.sh/...` and
`jsr:`/`deno.land/std` (pinned versions) and wrap handlers in `try/catch` returning JSON errors — good. Logging
is `console.log` with inconsistent shape, which makes cross-function log queries harder. **Improve:** a shared
`log(level, event, ctx)` helper emitting one JSON line per event would make `get_logs` far more useful during
incident debugging (ties into the debug playbook).

---

## 4. Migration discipline

### 4.1 Forward-only, idempotent DDL; reconcile divergence instead of force-replaying

The durable convention is forward-only migrations (a new migration to undo, never editing an applied one) with
idempotent DDL — `IF NOT EXISTS` / `CREATE OR REPLACE` wherever available — so a partial or re-run apply is
safe. When local migration history diverges from the remote, the wrong move is to blindly replay; you
reconcile (repair the history table or apply the delta directly) rather than let the tool re-run applied
migrations. ([Zero-downtime Postgres migrations — GoCardless](https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts),
[Migration best practices for zero-downtime — DEV](https://dev.to/mickelsamuel/postgresql-migration-best-practices-for-zero-downtime-deployments-1c4))

**Applied to Mayday Studio — this is the single most important repo constraint.** Our migration history **has
diverged** from the remote. The standing rule (`02-migrations-rls.md`, and the `ANNA.md` non-negotiables):
apply via the Supabase MCP **`apply_migration`**, which executes the SQL directly and records it — **never
`supabase db push`**, which would try to replay already-applied migrations and can corrupt state. We also write
idempotent DDL (`if not exists`, `or replace`, guarded `DO $$` for realtime publication adds). This matches the
external standard; the discipline to keep is: write the file for the git record *and* apply the same SQL via
MCP, forward-only, every time.

### 4.2 Zero-downtime column changes: expand/contract, catalog defaults, `lock_timeout`

The hard parts of online DDL: (a) On PG 11+, `ADD COLUMN ... DEFAULT` is instant (default stored in the
catalog, applied on read) — no table rewrite. (b) Adding a `NOT NULL` column to a big table still needs the
expand/contract dance: add nullable → backfill in batches → add the constraint (`NOT VALID` then `VALIDATE`) →
enforce. (c) Precede every DDL that takes a table lock with `SET lock_timeout` so a blocked migration aborts
instead of freezing the app behind an `ACCESS EXCLUSIVE` lock. (d) Build indexes `CONCURRENTLY`. (e) Rename/
retype via views or expand-contract, never a bare `ALTER COLUMN TYPE` on a hot table.
([Zero-downtime Postgres migrations — GoCardless](https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts),
[Migration best practices — DEV](https://dev.to/mickelsamuel/postgresql-migration-best-practices-for-zero-downtime-deployments-1c4))

**Applied to Mayday Studio — untested at our scale, but the habits matter.** Most tables are small enough that
a rewrite lock is milliseconds, so we've never been bitten — but analytics tables (`platform_daily_metrics`,
`audience_snapshots`) are the ones that will eventually be large. **Improve:** for those tables specifically,
(1) add columns with a catalog default rather than a backfilling default, (2) use `CREATE INDEX CONCURRENTLY`
(note: cannot run inside a transaction, so it needs its own migration and can't be inside `apply_migration`'s
transactional block — run it as a standalone statement), and (3) never do a bare `ALTER COLUMN TYPE` on them.
The CHECK-constraint role swap we do (`DROP CONSTRAINT ... ADD CONSTRAINT profiles_role_check`) is fine on the
small `profiles` table but would be a scan-and-lock on a large one — use `ADD CONSTRAINT ... NOT VALID` +
`VALIDATE CONSTRAINT` if `profiles` ever grows.

---

## 5. pg_cron, scheduled jobs & secret/PII remediation

### 5.1 pg_cron secret handling: Vault, read at call time — never hardcoded in SQL

A pg_cron job that calls an edge function via `net.http_post` needs a secret. Hardcoding it in the
`cron.schedule` SQL stores it in plaintext in `cron.job` and in every migration file / git blob. The correct
pattern: store it in **Vault** and read `decrypted_secret` inside the job body at execution time.
([Vault — Supabase docs](https://supabase.com/docs/guides/database/vault),
[Scheduling Edge Functions — Supabase docs](https://supabase.com/docs/guides/functions/schedule-functions))

**Applied to Mayday Studio — remediated, with a known git residue.** The **original** trends cron migration
`20260328200001_cron_generate_trends.sql` hardcoded `CRON_SECRET` in the SQL. It was **rotated and moved to
Vault** by `20260601140000_cron_secret_via_vault.sql`, which re-registers every affected job to read
`vault.decrypted_secrets where name = 'cron_secret'`. The stale literal is dead but **still in git history** —
that's a history-remediation question (§5.3), not a live vulnerability. **Never copy the hardcoded pattern**; a
diff reintroducing a plaintext secret in a new migration is a BLOCKER.

### 5.2 Monitor scheduled jobs and prune their history

pg_cron records every run in `cron.job_run_details`; query it for `status = 'failed'` (the error is in
`return_message`) to know when a job silently died — a cron failure produces no user-facing error, so without
monitoring it's an invisible outage. Two operational chores: alert on failed runs (a heartbeat/last-success
check is more robust than only catching execution errors), and **prune the table** — it grows unbounded;
schedule a nightly `DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days'`.
([pg_cron debugging guide — Supabase docs](https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz),
[Cron job monitoring — Webalert](https://web-alert.io/blog/cron-job-monitoring-background-tasks))

**Applied to Mayday Studio — the likely gap.** We have many cron jobs (`daily-generate-trends`, `run-reports`,
graphics posting, drive-watch, snapshots — `03-cron-automations.md`) but no evidence of a failed-run alert or a
`job_run_details` prune. A stale `generate-trends` or a silently-dead `sync-*` would only surface when a human
notices missing data. **Improve (highest-leverage operational item):** (1) add a prune job for
`cron.job_run_details`; (2) add a lightweight monitor — a daily job that scans `job_run_details` for
`status='failed'` in the last 24h and writes a row into `notifications` for admins (reusing the existing bell
system). This turns invisible cron failures into a visible signal and directly addresses the known
"sync-youtube stale for More Mayday" class of silent-staleness bugs.

### 5.3 Secrets in git history: rotate first, scrub second (and only if it's worth it)

When a secret leaks, the correct order is **rotate/revoke first** (that stops the bleeding immediately),
**then** decide whether to scrub history. Scrubbing means rewriting history with `git filter-repo` (the
officially-recommended modern tool) or BFG, which forces every collaborator to re-clone and won't purge
provider-side caches (GitHub PR diffs may still show it until support purges them). For a *private* repo where
the leaked value is already rotated and invalid, a history rewrite is often not worth the disruption.
([Rewriting a repo to remove secrets — Simon Willison](https://til.simonwillison.net/git/rewrite-repo-remove-secrets),
[BFG & git-filter-repo — Elegant Software](https://www.elegantsoftwaresolutions.com/blog/bfg-git-filter-repo-cleaning-leaked-secrets-from-history))

**Applied to Mayday Studio — correct call, correctly deferred.** The leaked `CRON_SECRET` (and a Triton anon
JWT) were **rotated** — the values in history are invalid. The tracked-`.env`/`.env.save` leak was closed with
`git rm --cached` in `b99c36d6`. The security review's standing decision: **do not rewrite history** unless the
repo goes public, because the live values are all dead and the rewrite cost (everyone re-clones) exceeds the
benefit on a private repo. This matches the external guidance exactly (rotate first; scrub is optional cleanup).
The one absolute: a diff that *reintroduces* a plaintext secret is a BLOCKER regardless.

### 5.4 PII exposure through views is a first-class secret concern

A trimmed/definer view is a PII boundary, and the failure mode is silent: a `SELECT *` view (or a column added
to a base table that an explicit view was assumed to hide) leaks pay/notes/PII to a role that should never see
it. The discipline is the same as §2.2 — column-explicit views, conscious decision on every new base-table
column. ([Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security))

**Applied to Mayday Studio:** Covered by the agency trimmed-view pattern (§2.2) and Layer 6 of the security
review. The improvement is procedural, not code: **make "does this new column leak to agency/non-admin?" a
required question on every migration touching `sponsors`/`sponsor_deliverables`/`campaign_briefs`/
`revenue_events`/`profiles`** — the trimmed views only protect us because they're column-explicit *and* someone
remembered to check.

---

## Top improvement recommendations (backend/security)

Ranked by leverage:

1. **Add cron-failure monitoring + `job_run_details` pruning (§5.2).** Highest operational leverage. We run
   many pg_cron jobs with no failed-run alert, so silent staleness (the known sync-youtube class) is invisible
   until a human notices. A daily scan of `cron.job_run_details` for `status='failed'` → `notifications` row,
   plus a 7-day prune job, closes this cheaply and reuses the existing bell system.
2. **Event-id idempotency at external webhook boundaries (§3.4).** Our Automations engine dedups well, but
   provider webhooks (Stripe/Fourthwall) should dedup on the provider's stable event id via an
   `ingested_events(event_id)` unique constraint + `on conflict do nothing`, not trust-the-trigger-fires-once.
3. **Fail-closed edge-function auth posture (§3.1) + shared CORS `json()/error()` helper (§3.2).** Every
   function is `--no-verify-jwt` with a hand-written gate as the only barrier, mostly using the service-role
   client. Introduce a shared `shared/http.ts` (CORS-stamped responses, removing the forgot-CORS bug class) and,
   for new user-only functions with no cron caller, prefer an RLS-scoped client built from the caller's JWT so
   an auth mistake fails closed rather than open.

---

## Sources

- Supabase — Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase — RLS Performance and Best Practices: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
- Supabase — Securing Edge Functions (auth): https://supabase.com/docs/guides/functions/auth
- Supabase — Environment Variables / secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase — Vault: https://supabase.com/docs/guides/database/vault
- Supabase — Scheduling Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions
- Supabase — Edge Functions development tips: https://supabase.com/docs/guides/functions/development-tips
- Supabase — Migrating to publishable/secret API keys: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- Supabase — pg_cron debugging guide: https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz
- PostgreSQL wiki — A Guide to CVE-2018-1058 (protect your search_path): https://wiki.postgresql.org/wiki/A_Guide_to_CVE-2018-1058%3A_Protect_Your_Search_Path
- Cybertec — Abusing SECURITY DEFINER functions in PostgreSQL: https://www.cybertec-postgresql.com/en/abusing-security-definer-functions/
- GoCardless — Zero-downtime Postgres migrations, the hard parts: https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts
- DEV — PostgreSQL migration best practices for zero-downtime deployments: https://dev.to/mickelsamuel/postgresql-migration-best-practices-for-zero-downtime-deployments-1c4
- DEV — 76 RLS policies rewritten: the auth.uid() init-plan trap: https://dev.to/arvavit/76-rls-policies-rewritten-in-one-migration-the-authuid-init-plan-trap-in-supabase-4hg
- MakerKit — Supabase RLS best practices (production patterns): https://makerkit.dev/blog/tutorials/supabase-rls-best-practices
- VibeAppScanner — Supabase RLS mistakes, the (select auth.uid()) trap & CVE-2025-48757: https://vibeappscanner.com/supabase-row-level-security
- Hookdeck — How to implement webhook idempotency: https://hookdeck.com/webhooks/guides/implement-webhook-idempotency
- Hooklistener — Webhook idempotency and deduplication: https://www.hooklistener.com/learn/webhook-idempotency-and-deduplication
- Webalert — Cron job monitoring: https://web-alert.io/blog/cron-job-monitoring-background-tasks
- Gosign — Deploying Supabase Edge Functions securely: https://www.gosign.de/en/magazine/supabase-edge-functions-secure/
- DEV — Supabase Edge Functions in Deno, a production guide: https://dev.to/kanta13jp1/supabase-edge-functions-in-deno-a-production-guide-5d95
- Simon Willison — Rewriting a Git repo to remove secrets from history: https://til.simonwillison.net/git/rewrite-repo-remove-secrets
- Elegant Software — BFG & git-filter-repo, cleaning leaked secrets from history: https://www.elegantsoftwaresolutions.com/blog/bfg-git-filter-repo-cleaning-leaked-secrets-from-history
