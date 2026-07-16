---
title: Root-Cause Playbook
last_updated: 2026-07-15
tags: [debugging, method, reproduce, tracing]
---

# Root-Cause Playbook

The general debugging method for Mayday Studio (React 18 / CRA+Craco frontend, Supabase backend). The rule that governs everything below: **reproduce first, root-cause second, fix third.** A bug you cannot reproduce is a bug you cannot verify you fixed. Symptom-patching (adding a `?.`, wrapping in try/catch, filtering out the bad row) hides the failure without removing it — do not do this.

## 1. Reproduce before you touch anything

### Run the app locally
- Dev server: `npm start` (CRA via Craco). Hot-reloads.
- Prod build sanity check: `npm run build`. Some bugs only surface in the minified build (dead-code elimination, env var inlining) — if the symptom is "works locally, broken on Vercel," build locally first.
- Env: `.env` holds Supabase keys (`REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`) and the Triton read-only pair (`REACT_APP_TRITON_SUPABASE_URL`, `REACT_APP_TRITON_SUPABASE_ANON_KEY`, see `src/tritonClient.js:3-4`). Never commit it. If the client fails to init, a missing env var is the first suspect — `tritonSupabase` is `null` when its vars are absent (`src/tritonClient.js:7-9`).

### Reproduce on BOTH variants
Most pages ship a desktop file and a `*Mobile.js` twin (e.g. `Dashboard.js` / `DashboardMobile.js`, `Ops` / `OpsMobile.js`, `SprintBoard` / `SprintBoardMobile`). `AppLayout.js` renders desktop, `AppLayoutMobile.js` renders mobile, chosen by viewport. **A bug reported on one is not automatically present on the other, and a fix to one does not propagate.** Always check which variant the reporter saw, reproduce it there, and confirm whether the twin shares the defect. Locked portals (`AgencyPortal.js`, freelancer pages) short-circuit via early returns in the layout files — reproduce inside the correct role.

### Reproduce as the right role
Behavior is role-gated: `admin`, `assistant`, `member`, plus `freelancer`, `agency`, `partner`. Use `useAuth()` flags (`isAdmin`, `isAssistant`, `canPost`, `isAgency`). A screen that is "empty" for one role may be RLS-denied, not broken — see `03-supabase-debug.md`. Reproduce under the reporter's role, not your admin session.

## 2. Where the logs live

| Layer | Where | How |
|---|---|---|
| Frontend runtime | Browser DevTools console | `console.error`/`console.warn` are used liberally. AuthContext logs every auth event: `console.log('Auth event:', event)` at `src/contexts/AuthContext.js:241`. |
| Frontend network | DevTools Network tab | Inspect the Supabase REST/RPC call, the `functions/v1/*` edge call, its status code and JSON body. A 401/403 is auth/RLS; a 500 is edge-function crash; a 200 with `[]` is usually RLS filtering. |
| Edge functions | Supabase logs | MCP `mcp__claude_ai_Supabase__get_logs` (service `edge-function`), or the Supabase dashboard → Edge Functions → Logs. Functions log `[DIAG]` prefixed diagnostics (e.g. sync-youtube staleness at `supabase/functions/sync-youtube/index.ts:665`). |
| Postgres | Supabase logs | `get_logs` with service `postgres`. RLS denials, constraint violations, statement errors land here. |
| Vercel deploy/runtime | Vercel MCP | `get_deployment_build_logs`, `get_runtime_logs`, `get_runtime_errors` for prod-only failures. |

## 3. Trace a bug from UI symptom to root cause

Follow the data, layer by layer. Do not skip layers — the bug is usually one layer deeper than where it presents.

1. **UI symptom → page component.** Identify the page (Dashboard, Analytics, Accounting, Deliverables, BusinessDev…) and the correct variant. Pages are 100–200KB single-file components — read *line ranges*, not the whole file. Grep for the visible string, the widget name, or the state setter to jump to the relevant block.
2. **Component → query or edge call.** Find the `supabase.from('table')...` query or the `supabase.functions.invoke('fn-name')` / `fetch('/functions/v1/...')` call feeding the broken UI. Note the exact table, columns, filters, and any `.eq()/.gte()/.lt()` — date filters are a top bug source (see PT/UTC gotcha in `02-known-issues-gotchas.md`).
3. **Query → table / RLS.** Use `mcp__claude_ai_Supabase__list_tables` to confirm the schema matches what the code assumes (column renamed? nullable? FK missing?). Run the exact query with `mcp__claude_ai_Supabase__execute_sql` **as service role** to see the true rows. If service-role returns data but the app sees `[]`, it is RLS — inspect the policy (`03-supabase-debug.md`).
4. **Edge function → source + logs.** Read the function under `supabase/functions/<name>/index.ts`. Pull its logs with `get_logs`. Reproduce its failure by invoking it with the same payload. Common causes: missing env secret, CORS, expired third-party token, timeout on a slow upstream (Metricool, YouTube, Google).
5. **Confirm the mechanism.** State the causal chain in one sentence ("the `.gte('2026-07-01')` filter treats the date as UTC midnight, so 8pm-PT rows from June 30 fall into July"). If you cannot state it, you have not root-caused it yet.

## 4. Tooling you have

- **Supabase MCP** — `list_tables`, `execute_sql` (run the real query / test a policy as a given role), `get_logs` (edge + postgres), `get_advisors` (security + performance lints, surfaces missing/overbroad RLS and unindexed FKs), `list_migrations`, `apply_migration` (the correct way to ship schema — **not** `supabase db push`; see divergence note in `02`), `list_edge_functions` / `get_edge_function` / `deploy_edge_function`.
- **Edge function source** — always read `supabase/functions/<name>/index.ts` and its `shared/` helpers before trusting the logs; the log line often points into shared code.
- **RLS policies** — read them via `execute_sql` against `pg_policies`, or check the migration that created them under `supabase/migrations/`.
- **`/verify` skill** — runs the app and observes real behavior to confirm a fix does what it claims. Use it to close the loop after every fix.
- **`/run` skill** — launches/drives the app to see a change working or capture a screenshot. Use for reproduction and for confirming both desktop and mobile.

## 5. Fix discipline

- Fix the **root cause**, not the symptom. If a null crashes a render, ask *why is it null* — a broken query or an RLS denial upstream, not a missing guard downstream.
- Respect conventions or you introduce a second bug: inline `style={}` objects only (no Tailwind), style tokens/recipes from `src/lib/styleTokens.js` / `styleRecipes.js` (never hardcoded values), PT date helpers from `src/lib/ptDate.js` for any date boundary.
- If the fix touches a page with a mobile twin, fix or explicitly check the twin.
- Ship schema changes with `apply_migration`. Never `supabase db push` (migration history is diverged).
- **Never commit or push automatically** — pause and report; the user commits explicitly.
- Re-verify with `/verify` or `/run` under the reporting role and variant. A fix is not done until reproduced-fixed.
