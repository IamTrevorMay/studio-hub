---
title: Review Playbook — How Anna Runs a Review Pass
last_updated: 2026-07-15
tags: [applied, review, security, code-review, rls, styling, mobile-parity]
---

# Review Playbook

This is Anna's procedure for reviewing a change in Mayday Studio — whether it's Anna's own diff before handing back, a teammate's PR, or an audit of a file. The output is **actionable, ranked, one-line-per-finding**, and every finding has been **adversarially verified** before it's reported. No praise, no scope creep, no noise.

Two skills back this up and Anna should reach for them rather than re-deriving checklists from scratch:
- **`/code-review`** — correctness bugs + reuse/simplification/efficiency cleanups at a chosen effort level (`--comment` posts inline, `--fix` applies).
- **`/security-review`** — dedicated security pass on the pending diff.

Use the skills for breadth; use the procedure below to know *what this repo specifically gets wrong* and to keep the signal-to-noise high.

---

## Step 1 — Get the diff and scope the review

1. Get the actual change set:
   - Working tree: `git diff` (unstaged) / `git diff --staged`, or `git diff main...HEAD` for a branch.
   - A GitHub PR: use `gh pr diff <n>` (the `/review` skill wraps this for PRs).
2. **Exclude `node_modules/` from your attention entirely.** It shows up dirty as normal local package drift (`CLAUDE.md` Important Notes). Any change under `node_modules/` is noise — if it's *staged*, that itself is a finding ("node_modules staged; unstage").
3. **Classify the changed layers.** Bucket each changed file so you apply the right checklist:
   - **Migration** (`supabase/migrations/*.sql`) → RLS + constraint + idempotency review.
   - **Edge function** (`supabase/functions/*/index.ts`) → auth, secrets, input validation, PT dates.
   - **Page frontend** (`src/pages/*.js`) → mobile/desktop parity, style-token compliance, role gating.
   - **Shared lib/hook** (`src/lib/*`, `src/hooks/*`) → blast radius (who imports this?).
4. Note the **surface** and its trust model: admin-only, Work Mode, or a locked portal (freelancer/agency/partner). The trust boundary determines what "correct authz" even means.

---

## Step 2 — Run the checklists in order: correctness → security → style

Work outward from "does it do the right thing" to "is it safe" to "does it match the house style." Consult the `Anna/review/*.md` checklists for the full lists; the high-value, repo-specific traps are below.

### 2a. Correctness

- **Mobile/desktop parity (the #1 trap here).** The desktop page and its `*Mobile.js` twin are separate lazy-loaded components (`src/App.js:19-22`, breakpoint 640px via `src/hooks/useIsMobile.js`). A diff that changes `Foo.js` but not `FooMobile.js` (or vice-versa) is almost always a bug — the behavior will silently diverge by viewport. **Always check: did both twins change together?** If only one did, that's a finding unless the change is provably desktop- or mobile-only.
- **PT date boundaries (the #2 trap).** Any new date filter, day/month bucket, or `.slice(0,10)` on a `timestamptz` is suspect. Postgres compares `timestamptz` in UTC, so filtering with a bare `'YYYY-MM-DD'` pulls late-PT rows from the wrong calendar day; slicing an ISO string yields the *UTC* day, not the PT day (`src/lib/ptDate.js:1-11`, `pattern_pt_date_boundaries`). The fix is `ptDateToUtcISO` / `ptRangeToUtc` / `ptDayKey` / `ptMonthKey` on the client, and the inline PT helpers (like `ptDayString`/`ptHour` in `generate-ashley-read/index.ts:45-57`) on the server. Flag any raw UTC date math.
- **Null guards on optional FKs.** e.g. `workflow_instance_id` can be null for standalone/automation tasks (`CLAUDE.md` Automations) — code that assumes it's present breaks. Check new joins/lookups for the null branch.
- **Migration idempotency.** `create ... if not exists`, `drop trigger if exists` before `create trigger`, `create or replace function`. A migration that fails on re-run is a finding.
- **Realtime vs RLS mismatch.** If a component subscribes to `postgres_changes` on a table the current role can't read via RLS, it will silently receive nothing — the correct pattern there is polling (agency portal, `CLAUDE.md`). Flag realtime subscriptions on cross-boundary data.

### 2b. Security

- **RLS on every new table.** A `create table` with no `alter table ... enable row level security` + policy is a critical finding. Confirm the policy matches the reader: admin-only → `is_admin(auth.uid())` for-all (bd pattern, `20260503000000_create_business_dev.sql:116-145`); portal → per-user or `is_agency()`-style exclusion + SECURITY DEFINER views that strip sensitive columns. A copy-pasted `admin all` policy on a table freelancers need to read is both wrong and a leak.
- **Edge function auth.** Every `Deno.serve` handler must authenticate before doing service-role work (the service-role client bypasses RLS). The canonical gate is cron-secret OR admin-JWT with an explicit 401 fallback (`generate-ashley-read/index.ts:204-222`). A function deployed `--no-verify-jwt` with *no* in-handler auth check is a critical finding.
- **Secrets.** No hardcoded tokens/keys anywhere — they come from `Deno.env.get(...)`. A secret literal in a migration or committed file is critical (there is already history of exactly this: `20260328200001_cron_generate_trends.sql`). Also confirm `.env` isn't being committed.
- **Trust-the-server, not-the-client on identity.** Author/owner fields must be stamped server-side, never accepted from the client — e.g. `agency_comments` forces `author_id = auth.uid()` and snapshots `author_role` in a BEFORE INSERT trigger (`CLAUDE.md` Agency Portal). Flag any INSERT that trusts a client-supplied `author_id`/`role`/`owner_id`.
- Run **`get_advisors`** (Supabase MCP) against the project after schema changes — it independently catches missing RLS and missing indexes.

### 2c. Style compliance

- **No hardcoded style values.** Every hex, rgba, or off-scale pixel in a `style={}` object is a finding — values must come from `src/lib/styleTokens.js` and shapes from `src/lib/styleRecipes.js` (`feedback_use_style_system`). Watch for `#0f0f1a`/`#6366f1`/`rgba(255,255,255,...)` literals that should be `colors.bg`/`colors.accent`/`colors.textMuted`, and magic spacing like `padding: 15` that should be a `spacing.*` token. `npm run lint:styles` (the standalone `scripts/lint-styles.js` script) is the objective check — run it. (The `mayday/no-style-magic-numbers` ESLint rule named in `styleTokens.js:4` is not actually wired into any eslint config; don't cite it as CI-enforced — the `lint:styles` script is.)
- **No Tailwind classes in JSX** (this repo is inline-styles only).
- New shape overriding a recipe inline instead of extending the recipe → finding (extend `styleRecipes.js`).
- Role gates present where required (`{isAdmin && ...}`, `ADMIN_PAGE_KEYS` registration for admin pages).

---

## Step 3 — Verify every finding adversarially before reporting

This is the step that separates a useful review from noise. **For each candidate finding, ask: "Can I actually make this fail?"** and try to.

1. **Trace the real path.** Read the surrounding code, not just the diff hunk. A "missing null guard" isn't a bug if a `not null` DB constraint or an upstream default guarantees the value. A "missing RLS" isn't a finding if a later migration in the same set adds it.
2. **Construct the failing input.** For a PT date bug: pick a concrete instant (June 30, 8pm PT) and confirm it lands in July under the diff's UTC logic. For an RLS gap: name the role and query that would read a row it shouldn't. If you can't construct a failing case, downgrade or drop the finding.
3. **Reproduce cheaply where possible.** `execute_sql` via MCP can confirm an RLS or query-shape assumption in seconds. `npm run lint:styles` confirms a style finding objectively. Prefer a 10-second check over a confident guess.
4. **Kill false positives ruthlessly.** A review full of "consider maybe" hedges trains the reader to ignore you. If you're not confident it fails, either verify it or cut it. (This maps to the effort levels in `/code-review`: low/medium = fewer high-confidence findings; high/max = broader, may include uncertain — label uncertainty explicitly when you keep it.)

---

## Step 4 — Rank by severity

Order findings so the reader fixes the important things first:

1. **Critical** — security holes (missing RLS, unauthenticated service-role edge fn, leaked secret, client-trusted identity), data loss, crashes on the happy path.
2. **High** — correctness bugs that fire in normal use: mobile/desktop divergence, PT off-by-one, null-guard misses.
3. **Medium** — style-system violations, missing role gates, non-idempotent migration, realtime/RLS mismatch causing stale UI.
4. **Low** — nits, naming, minor simplifications. Keep these few; drop them entirely if the diff is large and the high-severity list is long.

---

## Step 5 — Output format: one line per finding

Each finding is a single actionable line: **location → problem → fix.**

```
src/pages/Analytics.js:842 — HIGH: date filter uses raw '2026-07-01' on a timestamptz, pulls late-PT June rows into July. Fix: wrap with ptRangeToUtc() from src/lib/ptDate.js.
src/pages/Analytics.js — HIGH: AnalyticsMobile.js not updated to match the new filter; mobile will show the old range. Fix: mirror the change in AnalyticsMobile.js.
supabase/migrations/20260715_add_widgets.sql:22 — CRITICAL: table `widgets` has no RLS. Fix: enable RLS + admin-all policy (see bd migration lines 116-145).
src/pages/Dashboard.js:1204 — MEDIUM: hardcoded '#6366f1'. Fix: colors.accent from styleTokens.
```

Lead with a one-sentence verdict (ship / ship-with-fixes / block), then the ranked list. If the diff is clean, say so plainly — don't manufacture findings.

- Use `--comment` on `/code-review` to post inline on a PR, or `--fix` to apply cleanups directly.
- **Do not commit or push** as part of a review unless explicitly asked (`feedback_no_auto_commit`). Reporting is the deliverable.

---

## Worked example — reviewing a "new admin widget" diff

Diff adds a `widgets` table migration, a `sync-widgets` edge function, and renders the widget in `Dashboard.js`.

1. **Classify**: migration + edge fn + one page → three checklists, and immediately note `DashboardMobile.js` is absent from the diff (parity flag, pending verification).
2. **Correctness**: the widget filters "today's" rows with `.eq('date', new Date().toISOString().slice(0,10))` → PT off-by-one. *Verify*: an 11pm-PT row on the 14th has UTC date the 15th, so it's mis-bucketed — confirmed HIGH. Mobile twin missing → confirmed HIGH (Dashboard has a `DashboardMobile.js` twin).
3. **Security**: migration enables RLS but the policy is `using (true)` → any authenticated user (including freelancers/agency) reads admin widgets. *Verify*: name the freelancer role reading the row — CRITICAL. Edge function: has the cron-or-admin gate from the canonical anatomy — OK.
4. **Style**: widget card uses `border: '1px solid rgba(255,255,255,0.06)'` literal → should be `colors.border`; `lint:styles` flags it — MEDIUM.
5. **Rank + report**:
   ```
   Verdict: BLOCK — RLS policy leaks admin data.
   migration:18 — CRITICAL: widgets RLS is `using (true)`, exposes admin rows to all roles. Fix: use is_admin(auth.uid()) (bd pattern).
   Dashboard.js:610 — HIGH: today filter mis-buckets late-PT rows. Fix: ptDayKey/ptRangeToUtc from src/lib/ptDate.js.
   (diff) — HIGH: DashboardMobile.js not updated; widget absent on mobile. Fix: mirror render in the mobile twin.
   Dashboard.js:640 — MEDIUM: hardcoded border rgba. Fix: colors.border.
   ```

---

## Cross-references
- Review checklists: `Anna/review/*.md`
- Skills: `/code-review`, `/security-review`, `/review` (GitHub PRs)
- Conventions: `/Users/trevor/Desktop/Mayday-Studio/CLAUDE.md`
- PT date helpers: `/Users/trevor/Desktop/Mayday-Studio/src/lib/ptDate.js`
- Style system: `/Users/trevor/Desktop/Mayday-Studio/src/lib/styleTokens.js`, `styleRecipes.js`
- Canonical RLS migration: `/Users/trevor/Desktop/Mayday-Studio/supabase/migrations/20260503000000_create_business_dev.sql`
- Canonical edge-fn auth: `/Users/trevor/Desktop/Mayday-Studio/supabase/functions/generate-ashley-read/index.ts:204-222`
- Build procedure: `Anna/applied/build-playbook.md`
- Debug procedure: `Anna/applied/debug-playbook.md`
