---
title: Supabase Debugging
last_updated: 2026-07-15
tags: [debugging, supabase, rls, edge-functions, realtime, migrations, cron]
---

# Supabase Debugging

How to diagnose the Supabase layer of Mayday Studio: RLS denials, edge-function failures, realtime that won't fire, migration apply failures and divergence recovery, and cron jobs. All tool names below are the MCP Supabase tools available to Anna.

## MCP tools you have

| Tool | Use for |
|---|---|
| `mcp__claude_ai_Supabase__list_tables` | Confirm schema, columns, nullability, FKs before trusting code assumptions |
| `mcp__claude_ai_Supabase__execute_sql` | Run the exact query as service role; test policies; query `pg_policies`, `cron.job`, `supabase_migrations.schema_migrations` |
| `mcp__claude_ai_Supabase__get_logs` | Edge-function and Postgres logs (pick the service) |
| `mcp__claude_ai_Supabase__get_advisors` | Security + performance lints — surfaces missing/overbroad RLS, unindexed FKs, SECURITY DEFINER risks |
| `mcp__claude_ai_Supabase__list_migrations` | See applied migration history on the remote |
| `mcp__claude_ai_Supabase__apply_migration` | Ship schema changes (the correct path — never `supabase db push`) |
| `mcp__claude_ai_Supabase__list_edge_functions` / `get_edge_function` | Enumerate / read deployed function source |
| `mcp__claude_ai_Supabase__deploy_edge_function` | Redeploy after an edge fix (or CLI `supabase functions deploy <name> --no-verify-jwt`) |

There are two projects: **main** (read-write) and **Triton** (read-only — see gotcha (g) in `02`). Point queries at the right one.

---

## Decision tree

```
UI shows no data / partial data
├─ Network tab: what did the call return?
│  ├─ 200 with []  ─────────────► likely RLS (Section A). Confirm with service-role execute_sql.
│  ├─ 401 / 403    ─────────────► auth or RLS deny (Section A). Check role + JWT.
│  ├─ 500 / 4xx from functions/v1 ► edge function crash (Section B). get_logs.
│  └─ never returns / hangs ────► client deadlock (auth-lock, gotcha (f)) OR upstream timeout (Section B).
│
Row changed but UI didn't update live
└─ realtime not firing ─────────► RLS read set (Section C).

Schema change
└─ apply failed / drift ────────► migration divergence (Section D).

Scheduled job didn't run
└─ check cron.job (Section E).
```

---

## A. RLS denials

**Symptom:** query returns `200 []` (empty) or `403`, even though the row exists.

Supabase RLS filters silently: a denied `SELECT` returns *no rows*, not an error. So "empty screen" is the classic RLS tell, not a crash.

**Diagnose:**
1. Run the exact query with `execute_sql` — this runs as **service role** and bypasses RLS. If rows come back here but the app sees `[]`, RLS is filtering them.
2. Inspect the policies:
   ```sql
   select policyname, cmd, roles, qual, with_check
   from pg_policies where tablename = 'your_table';
   ```
   Read `qual` (the `USING` clause for read/update/delete) and `with_check` (for insert/update). Compare against the current user's role and `auth.uid()`.
3. Run `get_advisors` (security) — it flags tables with RLS disabled, permissive/overbroad policies, and SECURITY DEFINER views that leak.
4. Confirm the app's role: RLS keys off `auth.uid()` and the `profiles.role` / helper functions (`is_agency()`, admin checks). Reproduce under the reporter's role, not admin.

**Common causes here:**
- New table shipped without an INSERT policy → the client can read but every write 403s. (This is why `freelancer_profiles` has an explicit INSERT policy so freelancers can self-create during setup — CLAUDE.md → Contractor Portal.)
- Role deliberately excluded via a helper predicate (e.g. `is_agency()` excludes agency accounts from staff-wide policies on `sponsors`, `sponsor_deliverables`, etc.; they read trimmed SECURITY DEFINER views `agency_deliverables` / `agency_briefs` instead — CLAUDE.md → Agency Portal). An "empty" agency screen may be *correct*.
- Policy references a column the query doesn't select, or `auth.uid()` is null because the JWT didn't attach.

**Test a policy without shipping:** wrap a query in the role context or read the policy predicate and evaluate it by hand against a known row from `execute_sql`. Fix by editing/adding the policy in a migration via `apply_migration`.

## B. Edge-function failures

**Symptom:** a `functions/v1/<name>` call 500s, times out, or returns a CORS/auth error.

**Diagnose:**
1. `get_logs` with the edge-function service, scoped to the function. Look for the thrown error and any `[DIAG]` lines (functions log structured diagnostics, e.g. sync-youtube staleness at `supabase/functions/sync-youtube/index.ts:665`).
2. Read the source: `supabase/functions/<name>/index.ts` and its `shared/` helpers. The log stack usually points into shared code.
3. Reproduce by invoking the function with the same payload (event functions take `{ event, source, payload }`, e.g. `run-automations`).

**Failure classes:**
- **Missing env secret** — functions read `METRICOOL_TOKEN`, `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, the service-role key, YouTube refresh tokens, etc. A missing/rotated secret throws early. Note the CRON_SECRET was rotated to Vault (gotcha (d)) — old inline value is dead.
- **CORS** — browser blocks the response; DevTools shows a CORS error, not a JSON body. The function must return the CORS headers (and handle the `OPTIONS` preflight). Check the shared CORS helper is imported and applied on every return path, including error returns.
- **Auth error** — functions deployed `--no-verify-jwt` expect their own secret check (query `?secret=` or header); functions that *do* verify JWT 401 when the client omits/expires the token. Match the client's call to the function's expectation.
- **Timeout / memory** — slow upstreams (Metricool, YouTube, Google, Stripe) blow the function's execution budget; large batch loops OOM. Symptom is a hang then a platform-level 5xx with little in the logs. Fix by paginating/batching and adding upstream timeouts, not by retrying blindly.

**Redeploy after a fix:** `deploy_edge_function` (MCP) or CLI `supabase functions deploy <name> --no-verify-jwt`.

## C. Realtime not firing

**Symptom:** a row changes in the DB but the subscribed client never gets a `postgres_changes` event; a manual refresh shows the new data.

**Cause:** Realtime only emits `postgres_changes` for rows the subscriber is allowed to **read under RLS**. If the subscribing role is excluded from that table's read policy, it will *never* receive events for it — this is by design, not a broken subscription.

**Canonical case:** the Agency portal is excluded from reading deliverable rows (`is_agency()`), so it gets no `postgres_changes` for them. It compensates with 20s polling plus realtime only on tables it *can* read (`agency_comments`, its own `ad_read_proposals`) — CLAUDE.md → Agency Portal.

**Diagnose:**
1. Confirm the subscribing role can `SELECT` the row (run the read query under that role / inspect the policy per Section A). No read access → no events. Expected.
2. Confirm the table is in the realtime publication (`supabase_realtime`); a table added without being published emits nothing to anyone.
3. Check the channel actually subscribed with fresh auth — after a token refresh the socket auth must be re-set before channels re-subscribe (the app does this at `src/contexts/AuthContext.js:417-437`). A channel that subscribed with a stale token can go silent.

**Fix:** if the role legitimately needs live updates, add it to the read policy (weigh the data exposure) or fall back to polling like the agency portal does. Do not "fix" by broadening RLS carelessly — run `get_advisors` after any policy change.

## D. Migration apply failures & divergence recovery

**Symptom:** `supabase db push` reports drift / tries to re-run applied migrations / refuses; local files disagree with the remote history.

**Cause:** the migration history is diverged between local and remote (gotcha (c)).

**Recover:**
1. **Never** run `supabase db push`. Use `apply_migration` for new changes — it writes directly to the remote and records history.
2. Inspect remote history: `list_migrations`, or `select version, name from supabase_migrations.schema_migrations order by version;` via `execute_sql`.
3. Before writing a migration, `list_tables` to see the *actual* current schema. Author the migration to be idempotent (`if not exists`, `create or replace`) so a partial prior apply doesn't wedge it.
4. If an `apply_migration` half-applied and errored, read the error, inspect real state with `execute_sql`, and write a corrective idempotent migration — do not blindly re-run the failed one.

## E. Cron jobs

**Symptom:** a scheduled task (trends, automations, syncs) didn't run or ran at the wrong time.

**Diagnose:**
```sql
select jobid, jobname, schedule, active, command from cron.job;
select * from cron.job_run_details order by start_time desc limit 20;  -- if available
```
- Confirm the job exists and `active` is true.
- Read the `schedule` — it is **UTC**. The trends job is `0 15 * * *` = 15:00 UTC = 8am PT (`supabase/migrations/20260328200001_cron_generate_trends.sql:9`). PT wall-clock drifts by an hour across DST while the UTC cron stays fixed — factor that in before calling it "wrong."
- Cron jobs POST to edge functions via `net.http_post` with a secret. If the function 401s, the secret in the job or the function's expectation is stale (gotcha (d)) — check both, and cross-reference the edge logs (Section B).
- Automations run through `run-automations` (hourly schedule mode + HTTP event mode); dedup keys prevent duplicate task creation — a "missing" automated task may be dedup, not failure. Check `automation_runs` for the audit trail.

---

### Golden rules
- Empty result ≠ crash — suspect RLS first, confirm with a service-role `execute_sql`.
- `get_advisors` before *and* after any policy or schema change.
- Realtime silence for a role usually means that role can't read the row — expected.
- Ship schema only via `apply_migration`; author it idempotently.
- Cron schedules are UTC; convert to PT with the DST caveat in mind.
