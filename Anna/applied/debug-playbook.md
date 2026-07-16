---
title: Debug Playbook — How Anna Debugs
last_updated: 2026-07-15
tags: [applied, debugging, rls, pt-dates, edge-functions, supabase, realtime]
---

# Debug Playbook

This is Anna's procedure for diagnosing a bug in Mayday Studio. The spine is: **reproduce → gather evidence → check the known-landmines doc → form hypotheses → trace symptom to root cause → fix at the root → verify on both twins → don't commit unless asked.**

The single biggest time-saver in this repo: **many bugs are already documented landmines.** Before theorizing, read `Anna/debugging/02-known-issues-gotchas.md` — the fix is often already written down.

---

## Step 1 — Reproduce first

Never debug from a description alone. Get the failure in front of you.

1. **Identify the surface.** Which page, which role, which viewport? A bug that only appears for freelancers, or only below 640px, or only for an admin, immediately narrows the search — role changes RLS, viewport changes *which component file even loads* (`src/App.js:19-22` picks `AppLayout` vs `AppLayoutMobile` at boot).
2. **Run the app**: `npm start` (or the `/run` skill), log in as the affected role, and drive to the exact repro. If it's mobile-only, load a mobile viewport / narrow the window below 640px so the `*Mobile.js` twin loads.
3. **Pin down the trigger**: does it happen on load, on a specific action, only with certain data, only at certain times of day? "Only near midnight" screams PT date boundary. "Only for this role" screams RLS. "Only after a deploy" screams migration/edge-fn drift.
4. If you genuinely can't reproduce, that itself is data — it points at environment (env vars, remote data state, cron timing) rather than the frontend.

---

## Step 2 — Gather evidence

Collect signal from every layer before forming a theory.

1. **Browser console + network tab** — JS errors, failed requests, and crucially the *shape of the response*. An empty array where you expected rows is the classic RLS-blocked read (200 OK, `[]`), not an error.
2. **Supabase MCP `get_logs`** — edge function logs, Postgres logs, auth logs. This is where a 500 from an edge function, a failed cron POST, or an RLS denial surfaces server-side.
3. **Supabase MCP `get_advisors`** — security + performance advisories. Catches the missing-RLS / missing-index class of problem without guessing.
4. **Supabase MCP `execute_sql`** — the sharpest tool for data bugs. Run the *exact* query the app runs (a) as service role to see the true rows, then (b) reason about what the affected role's RLS policy would filter out. If service-role returns rows and the app sees `[]`, RLS is your culprit.
5. **`git log` / `git diff`** on the suspect files — a recent change often correlates with the regression. Check whether both twins moved together (a parity bug hides in the one that didn't).

---

## Step 3 — Consult the known-issues doc FIRST

Before building a hypothesis, open **`Anna/debugging/02-known-issues-gotchas.md`** and scan for the symptom. Several bug *classes* in this repo are known and pre-diagnosed. Off the top:

- **PT vs UTC date off-by-one** (`pattern_pt_date_boundaries`, `src/lib/ptDate.js:1-11`): late-PT rows land on the wrong calendar day when a `timestamptz` is filtered by a bare date string, or when an ISO string is `.slice(0,10)`'d. Symptom: counts/metrics off by one near midnight, "today" showing yesterday's or tomorrow's data.
- **RLS empty-result**: a page renders blank / a list is empty for one role but fine for admin — the read is silently filtered by a policy, returning `[]` with a 200.
- **Realtime silence across a trust boundary**: a portal doesn't live-update because it can't *read* the changed rows via RLS, so it never receives `postgres_changes` (agency portal deliberately polls instead; `CLAUDE.md`).
- **`sync-youtube` stale for More Mayday**: the YouTube API returns the same 167 video IDs every run — root cause is **external** (stale API response / quota), not a code bug (`CLAUDE.md` Known Issues). Don't chase this in the code.
- **Migration divergence**: local migration history is out of sync with remote; use MCP `apply_migration`, not `supabase db push` (`project_supabase_migration_divergence`).
- **Null `workflow_instance_id`** on standalone/automation tasks breaks code that assumes a workflow parent (`CLAUDE.md` Automations).

If the symptom matches a known landmine, jump straight to its documented fix and verify — don't re-derive it.

---

## Step 4 — Form hypotheses, ranked

List the plausible causes and order them by likelihood given the evidence. Bias toward the known landmines and toward the layer the evidence implicates:

- Empty data for one role → **RLS** (highest prior).
- Wrong-day / off-by-one counts → **PT date boundary**.
- Works on desktop, broken on mobile (or vice-versa) → **twin divergence**.
- 500 / no data from an edge function → **auth gate, missing env var, or external API** (check `get_logs`).
- Stale UI that never updates → **realtime/RLS mismatch** or a missing subscription.

Write down 2–3 hypotheses. Don't fixate on the first.

---

## Step 5 — Trace symptom → component → query → edge fn → table/RLS

Follow the data backward through the stack until the fault localizes:

1. **Component**: find the render of the broken value (grep the label/symbol, Read the window). Confirm the state variable and where it's populated.
2. **Query/hook**: find the `useSupabaseQuery`/Supabase call feeding it. Note the table, filters, and any date math.
3. **Edge function** (if the data comes via one): read its handler — auth gate, env vars, external API call, response shape. Cross-check `get_logs`.
4. **Table / RLS**: run the query via `execute_sql` (service role) to see ground truth, then compare against what the affected role's policy allows. This is where RLS bugs are proven, not guessed.

The goal is to move the failure from "the page is blank" to "this specific policy filters this specific row for this specific role" — a fault you can fix precisely.

---

## Step 6 — Fix at the root cause

- Fix the actual cause, not the symptom. Papering a PT bug with a `+1 day` fudge, or loosening an RLS policy to `using (true)` to "make data show up," creates worse bugs (the latter is a data leak). Use `ptDateToUtcISO`/`ptRangeToUtc`/`ptDayKey`; write the RLS policy that matches the intended reader.
- **RLS fixes go in a new timestamped migration** applied via MCP `apply_migration` (never `db push`), then re-check with `get_advisors`.
- **Edge function fixes** redeploy with `supabase functions deploy <name> --no-verify-jwt`.
- **Frontend fixes** use tokens from `styleTokens`/`styleRecipes` only — no hardcoded values sneaking in during a "quick fix."
- If the root cause is external (like `sync-youtube`), say so and stop — don't force a code change that can't fix an API/quota problem.

---

## Step 7 — Verify the fix on both twins

1. Reproduce the original repro steps and confirm the bug is gone on the surface it appeared.
2. **If the fix touched shared logic or a page with a twin, verify BOTH desktop and mobile** — a fix applied to `Foo.js` but not `FooMobile.js` leaves the bug live on the other viewport.
3. For data/RLS/date fixes, re-run the `execute_sql` check to confirm the correct rows now flow to the affected role.
4. Re-run `get_advisors` / `get_logs` to confirm you didn't introduce a new advisory or error.
5. **Do not commit or push unless explicitly asked** (`feedback_no_auto_commit`). Report the root cause, the fix, and the verification. Never stage `node_modules/`.

---

## Worked example A — RLS empty-result

**Symptom**: an admin added a freelancer to a project; the freelancer's dashboard shows no assignments, but the admin sees them fine.

1. **Reproduce**: log in as that freelancer role, load `fl_dashboard` — assignments list is empty (200, `[]` in network tab), no console error.
2. **Evidence**: `get_logs` shows no error. The empty-with-200 pattern points at RLS, not a crash.
3. **Known-issues**: matches the "RLS empty-result" landmine.
4. **Trace**: component reads from the assignments table via `useSupabaseQuery`. Run the query via `execute_sql` as service role → the row exists. So the policy is filtering it for the freelancer.
5. **Root cause**: the SELECT policy scopes to `owner_id = auth.uid()` but the assignment was written with the admin as `created_by` and the freelancer id in a different column the policy doesn't check — the freelancer fails the `using` clause.
6. **Fix**: new migration correcting the SELECT policy to match on the freelancer-facing column; `apply_migration`; re-check `get_advisors`.
7. **Verify**: re-run `execute_sql` reasoning for the freelancer role; reload the dashboard as that freelancer — assignment now shows. Check the mobile twin too. Report; don't commit.

## Worked example B — PT date off-by-one

**Symptom**: the "Do this more" IG-story widget shows yesterday's count late at night; the green checkmark disappears around 4–5pm.

1. **Reproduce**: it only misbehaves in the evening → time-of-day dependence screams PT boundary.
2. **Known-issues**: matches `pattern_pt_date_boundaries`.
3. **Trace**: the widget (or its edge function) filters stories with a bare `'YYYY-MM-DD'` against a `timestamptz`, so Postgres compares at UTC midnight. After ~4–5pm PT, "today" in UTC has already rolled to tomorrow, so the current day's stories fall outside the filter.
4. **Root cause**: UTC-anchored date filter on a PT-calendar concept.
5. **Fix**: client uses `ptRangeToUtc(today, today)` → `.gte(startUtc).lt(endUtc)` from `src/lib/ptDate.js`; server (edge fn) uses the inline PT helpers like `ptDayString` (`generate-ashley-read/index.ts:45-49`).
6. **Verify**: simulate an evening instant, confirm the count and checkmark are correct; check both twins. Report; don't commit.

---

## Cross-references
- Known landmines (READ FIRST): `Anna/debugging/02-known-issues-gotchas.md`
- Debugging brain: `Anna/debugging/*.md`
- PT date helpers: `/Users/trevor/Desktop/Mayday-Studio/src/lib/ptDate.js`
- Canonical edge fn (auth + inline PT helpers): `/Users/trevor/Desktop/Mayday-Studio/supabase/functions/generate-ashley-read/index.ts`
- RLS reference migration: `/Users/trevor/Desktop/Mayday-Studio/supabase/migrations/20260503000000_create_business_dev.sql`
- Mobile/desktop split: `/Users/trevor/Desktop/Mayday-Studio/src/App.js`, `/Users/trevor/Desktop/Mayday-Studio/src/hooks/useIsMobile.js`
- Conventions + known issues: `/Users/trevor/Desktop/Mayday-Studio/CLAUDE.md`
- Build procedure: `Anna/applied/build-playbook.md`
- Review procedure: `Anna/applied/review-playbook.md`
