---
title: Build Playbook — How Anna Ships a Feature End-to-End
last_updated: 2026-07-15
tags: [applied, build, workflow, edge-functions, migrations, styling, realtime]
---

# Build Playbook

This is the repeatable procedure Anna follows to build a feature in Mayday Studio. It moves from data outward: **DB → backend → frontend → realtime → verify**. Every step is grounded in how this repo actually works (see `CLAUDE.md` for conventions, and the brain docs referenced inline).

The golden rule that sits above everything: **DB first, both twins always, tokens only, never auto-commit.** If you internalize nothing else, internalize that.

---

## Step 0 — Scope is already settled (usually)

Trevor's standing preference is that the **orchestrator** clarifies scope via a multi-choice question *before* building (`feedback_clarify_before_build`). By the time work reaches Anna, that decision is normally made. Anna's job is execution, not re-litigating scope.

That said, Anna still does a fast sanity read of the request:

1. Restate the feature in one sentence to yourself. If two credible interpretations exist and picking wrong would waste real work, surface the ambiguity back up rather than guessing.
2. Note the **surface**: is this admin-only, a Work Mode page, a contractor/agency portal, a tool, an edge function, a cron job? The surface dictates RLS shape, which layout twin(s) you touch, and where the nav entry lives.
3. Note whether it needs **new data** (migration), **new compute** (edge function), or is **pure frontend** on existing data. This determines how many of the steps below apply.

Do not gold-plate. Build the feature as scoped; don't invent adjacent features.

---

## Step 1 — Locate the code

Never start editing blind. Map the feature to concrete files first.

1. **Find the page and its Mobile twin.** Almost every top-level page has a desktop file and a `*Mobile.js` sibling in `src/pages/` — e.g. `BusinessDev.js` + `BusinessDevMobile.js`, `Analytics.js` + `AnalyticsMobile.js`, `Deliverables.js` + `DeliverablesMobile.js`. The mobile/desktop split is a **hard lazy-load boundary** decided at boot in `src/App.js:19-22` via `isMobileViewport()` from `src/hooks/useIsMobile.js` (breakpoint 640px). There is no responsive CSS bridge — the two files are genuinely separate components. **If you change behavior in one, you almost always must change it in the other.**
2. **Find relevant edge functions.** They live in `supabase/functions/<name>/index.ts` (30+ of them). Grep for the domain: `sync-*`, `metricool-*`, `google-*`, `generate-*`, `drive-*`. Read the file header comment block — every well-formed function documents its auth, body shape, and deploy command up top (see `generate-ashley-read/index.ts:1-16`).
3. **Find the tables.** Use the Supabase MCP `list_tables` before touching schema. Cross-reference the "Database" and feature-specific sections of `CLAUDE.md` (e.g. the `bd_*` tables, `agency_*` tables, `automations`/`automation_runs`).
4. **Pages are 100–200KB single-file components.** Do NOT read them whole — read targeted line ranges (`CLAUDE.md` "Important Notes"). Grep for the symbol, then Read the window around it.

Deeper map: `Anna/architecture/*` (app shell, schema, edge-fn catalog) and `Anna/debugging/01-root-cause-playbook.md` for the surface.

---

## Step 2 — DB first: write the migration

If the feature needs new data, schema comes before any TS or JSX.

1. **Timestamp-name the file.** Convention is `supabase/migrations/YYYYMMDDHHMMSS_short_description.sql` (e.g. `20260503000000_create_business_dev.sql`, `20260709190000_agency_portal.sql`). Use a timestamp *after* the newest existing migration.
2. **Write idempotent DDL.** Use `create table if not exists`, `create index if not exists`, `create or replace function`, `drop trigger if exists` before `create trigger`. The `bd_*` migration (`20260503000000_create_business_dev.sql`) is the canonical shape to copy.
3. **Add CHECK constraints for enums.** Statuses, tags, roles, priorities are all `text ... check (col in (...))` — see `bd_initiatives.status` and `.tag` at lines 43-50. Do not invent lookup tables for small fixed sets.
4. **Reference `profiles(id)`** for owner/creator FKs (`owner_id uuid references profiles(id)`), and use `on delete cascade` for child rows (links, tasks) so deleting a parent cleans up.
5. **ENABLE RLS on every new table and write policies.** This is non-negotiable — an un-RLS'd table is a security hole flagged by `get_advisors`. The pattern for admin-only surfaces:
   ```sql
   alter table my_table enable row level security;
   create policy "my_table admin all" on my_table
     for all to authenticated
     using (public.is_admin(auth.uid()))
     with check (public.is_admin(auth.uid()));
   ```
   `public.is_admin(uid)` is a `security definer stable` helper defined in the bd migration (lines 8-18). For non-admin surfaces, model the policy on the actual reader — freelancer portals use per-user `INSERT` policies (`freelancer_profiles`), the agency portal uses `is_agency()` exclusion + SECURITY DEFINER views (`agency_deliverables`, `agency_briefs`) to strip sensitive columns. **Match the RLS shape to who reads the data**, not a copy-paste of admin-all.
6. **Add to realtime if the UI needs live updates:** `alter publication supabase_realtime add table my_table;` (bd migration lines 150-154).
7. **Touch triggers + business logic in-DB where it belongs.** `updated_at` auto-touch (bd lines 159-175) and the recurring-task spawn trigger (lines 181-212) live in the DB, not the app. Prefer a trigger over app-side write-back for invariants.
8. **Apply via MCP `apply_migration`, NOT `supabase db push`.** Migration history has diverged from remote (`project_supabase_migration_divergence` memory). `db push` will fight you. Write the file to `supabase/migrations/` for source control AND apply the same SQL through the Supabase MCP `apply_migration` tool so it actually lands on the remote project.
9. **Verify with `get_advisors`** (security + performance lint) after applying. Fix any new RLS or missing-index warnings your migration introduced.

---

## Step 3 — Backend: the edge function

If the feature needs server compute (external API calls, Claude, cron, service-role writes), add an edge function following the canonical anatomy.

**Canonical anatomy** (distilled from `generate-ashley-read/index.ts`):

1. **Header comment block** — one-paragraph purpose, `Auth:` line, `Body:` shape, and the literal `Deploy:` command. Future-you and reviewers read this first (lines 1-16).
2. **CORS headers constant** including `x-cron-secret` in allow-headers (lines 21-25).
3. **`admin()` client factory** using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (lines 36-41). Service role bypasses RLS — so the function itself must enforce authz.
4. **`Deno.serve(async (req) => { ... })`** handler:
   - Short-circuit `OPTIONS` → 200, reject non-`POST` → 405 (lines 200-201).
   - **Dual auth**: accept a `CRON_SECRET` via `?secret=`, `X-Cron-Secret` header, or `Bearer <secret>` for cron; OR validate an admin JWT by calling `db.auth.getUser(token)` then checking `profiles.role` (lines 204-222). Reject with 401 if neither. Copy this block verbatim for any admin-or-cron function.
   - Parse body defensively: `try { body = await req.json(); } catch {}` (line 226).
   - Wrap the real work in `try/catch`, return `jsonResp({ error: ... }, 500)` on throw (the outer catch at the file's tail).
5. **Env vars** come from `Deno.env.get(...)` — never hardcode. This repo uses `METRICOOL_TOKEN`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, the service role key, etc. (`CLAUDE.md` Edge Functions section). **Never** put a secret in a migration or committed file — there's already one leaked-secret cleanup in history (`20260328200001_cron_generate_trends.sql`, now rotated to Vault).
6. **PT date correctness on the server too.** Edge functions re-implement PT helpers inline (`ptDayString`, `ptHour` in ashley lines 45-57) because they can't import `src/lib/ptDate.js`. If you bucket by day/hour or filter a `timestamptz` by calendar date, do it in Pacific time, not UTC.
7. **Deploy:** `supabase functions deploy <name> --no-verify-jwt`. The `--no-verify-jwt` flag is mandatory here because these functions do their own auth (cron secret OR admin JWT) rather than relying on the platform gateway. You can also deploy through the Supabase MCP `deploy_edge_function`.
8. **Cron wiring** (if scheduled): add a `pg_cron` job in a migration that POSTs to the function with the `CRON_SECRET`. See the trends/ashley cron migrations for the shape.

---

## Step 4 — Frontend: build both twins with tokens only

Now the UI. Two absolute rules govern every line of JSX here.

**Rule 1 — Inline styles, token-sourced, no hardcoded values.**
- All styling is inline `style={}` objects; there is **no Tailwind in JSX** (`CLAUDE.md` Styling).
- Pull every value from `src/lib/styleTokens.js` (`colors`, `spacing`, `radii`, `fontSizes`, `fontWeights`, `shadows`, `transitions`, `zIndex`) and compose shapes from `src/lib/styleRecipes.js` (`card()`, `pill()`, `badge()`, `button()`, `input()`, `sectionHeader()`, `modalOverlay()`, `modal()`).
- **Never hardcode** a hex, an off-scale pixel, or a raw rgba (`feedback_use_style_system`). The dark base is `colors.bg` (`#0f0f1a`), muted text is `colors.textMuted`, accent is `colors.accent` (`#6366f1`) — reach for the token, not the literal. Spacing is a 4px scale (`spacing.xs..huge`); don't pick 5/7/9.
- If a recipe is missing a variant you need, **extend the recipe** in `styleRecipes.js` — don't override it inline in the page (that's the whole point of the system).
- `npm run lint:styles` (the standalone `scripts/lint-styles.js` node script — flags hardcoded hex/rgba and off-scale spacing/radii/font-size literals in `style={}`/`const styles` objects) is the objective check. Run it before you consider the frontend done. Note: the `mayday/no-style-magic-numbers` ESLint rule referenced in `styleTokens.js:4` is **not** wired into any eslint config — the `lint:styles` script, not ESLint, is what actually enforces this.

**Rule 2 — Update desktop AND mobile.**
- The desktop page (`Foo.js`) and the mobile twin (`FooMobile.js`) are separate lazy-loaded components. New feature = implement in both, matching the interaction model to each form factor (mobile often collapses side-by-side panels into tabs/sheets).
- Match the **existing page's conventions**: module-level color/const objects (`STATUS_COLORS`, `EVENT_TYPE_COLORS`), a `const styles = { ... }` object near the bottom of the file, `useAuth()` for role gates (`isAdmin`, `isAssistant`, `canPost`), `useSupabaseQuery` for reads, `useVisibilityRefresh` for tab-refocus refresh.
- **Gate admin features** with `{isAdmin && (...)}`. If the page is admin-only, register its key in `ADMIN_PAGE_KEYS` (Admin Mode) — see `CLAUDE.md` Admin/Work Mode. Locked portals (agency/freelancer) short-circuit in `AppLayout.js`/`AppLayoutMobile.js` via an early return.
- Wire nav where appropriate (sidebar folder, `useNavConfig`).

---

## Step 5 — Realtime & notifications (if needed)

1. **Realtime**: if you added the table to `supabase_realtime` in Step 2, subscribe in the component with a Supabase channel on `postgres_changes` (this is how presence, channels, and bd tables stay live). Remember RLS applies to realtime too — a portal that can't *read* a row via RLS won't receive its `postgres_changes` either, so fall back to polling for cross-boundary data (the agency portal polls every 20s for deliverable rows it can't read; `CLAUDE.md` Agency Portal "Freshness").
2. **Notifications**: use the existing bell/`notifications` table rather than inventing a channel. For scheduled flags (overdue tasks, due-today), add a daily `pg_cron` check that inserts into `notifications` — the bd notifications cron (`20260503000001_cron_business_dev_notifications.sql`) is the template. For admin-visible counts, extend `get_notification_summary` (that's how `agency_unresolved_count` surfaces).

---

## Step 6 — Verify

Do not declare done until you've observed the behavior.

1. **Build/lint**: `npm run build` (CI=true, so warnings fail) and `npm run lint:styles`. Fix everything.
2. **Run it**: use the `/run` skill (or `npm start`) to launch the app and drive the feature. Check the surface you built — and if you touched both twins, resize below 640px (or use a mobile viewport) to load `AppLayoutMobile` and confirm the mobile path.
3. **Confirm the change actually works**: use the `/verify` skill to run the app and observe the real behavior, not just that it compiles.
4. **Backend checks**: for edge functions, tail Supabase logs via MCP `get_logs`, run `execute_sql` to confirm rows landed correctly, and re-run `get_advisors`.
5. **Tests**: if the area has coverage, `npm run test:frontend` / `test:edge` / `test:db` as relevant.

---

## Step 7 — Stop. Do not commit.

**Never run `git commit` or `git push` automatically** (`feedback_no_auto_commit`, `CLAUDE.md` Commit Style). When the feature is built and verified, **report what you did and pause.** Trevor commits explicitly. Also: `node_modules/` shows up dirty in `git status` as normal local drift — **never stage or commit it** (`CLAUDE.md` Important Notes).

If asked to commit later: branch first if on `main`, use an action-first message ("Add …", "Wire …", "Redesign …"), and append the required `Co-Authored-By` trailer.

---

## Worked mini-example — how the Business Dev feature was structured

This is the reference build in this repo; use it as a template.

1. **Scope** (`CLAUDE.md` Business Dev section): a permanent admin-only multi-phase program tracker, hierarchy Phase → Workstream → Initiative → Task, four tab views, its own `bd_*` tables — explicitly *not* sharing the Goals page's `initiatives` table.
2. **DB first** — `20260503000000_create_business_dev.sql` created `bd_settings`, `bd_initiatives`, `bd_initiative_links`, `bd_tasks`, `bd_milestones`; enum CHECKs for workstream/status/tag/priority; `on delete cascade` on child links/tasks; `is_admin()` helper; admin-all RLS on all five; realtime publication for all five; `updated_at` touch triggers; and the recurring-task spawn trigger (server owns recurrence, not the client). A later migration (`20260503010000_business_dev_phases.sql`) added `bd_phases` and the `phase_id` FKs — showing how to evolve the schema in a follow-up timestamped migration rather than editing the original.
3. **Backend** — recurrence and notifications run in-DB (trigger + `20260503000001_cron_business_dev_notifications.sql` daily cron into `notifications`), so no bespoke edge function was needed. That's the right call: prefer a trigger/cron over an edge function when the logic is pure data.
4. **Frontend** — `src/pages/BusinessDev.js` + `src/pages/BusinessDevMobile.js`, four tabs (Phases / Timeline / Calendar / My Stuff), tag pills, per-phase filters, admin-gated, delete-phase confirm modal.
5. **Realtime** — the five tables are in the realtime publication, so the page reflects edits live.
6. **Notifications** — reuses the existing bell system via the daily cron; no new notification surface invented.

The lesson: **most of the feature's correctness lived in the migration.** Get the schema, constraints, RLS, and triggers right, and the frontend becomes a thin, token-styled view over solid data — built twice, once per twin.

---

## Cross-references
- Conventions of record: `/Users/trevor/Desktop/Mayday-Studio/CLAUDE.md`
- Design tokens: `/Users/trevor/Desktop/Mayday-Studio/src/lib/styleTokens.js`
- Style recipes: `/Users/trevor/Desktop/Mayday-Studio/src/lib/styleRecipes.js`
- PT date helpers: `/Users/trevor/Desktop/Mayday-Studio/src/lib/ptDate.js`
- Canonical edge function: `/Users/trevor/Desktop/Mayday-Studio/supabase/functions/generate-ashley-read/index.ts`
- Canonical migration: `/Users/trevor/Desktop/Mayday-Studio/supabase/migrations/20260503000000_create_business_dev.sql`
- Review procedure: `Anna/applied/review-playbook.md`
- Debug procedure: `Anna/applied/debug-playbook.md`
