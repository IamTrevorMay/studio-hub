---
title: Correctness-First Review Checklist (Mayday Studio)
last_updated: 2026-07-15
tags: [review, correctness, checklist, supabase, react]
---

# Correctness-First Review Checklist

How Anna reviews a diff/PR for the Mayday Studio app (React 18 CRA + Supabase). Work top-down by severity: a data-layer or security defect blocks merge; a style nit does not. Cite `file:line` in every comment.

## Severity rubric (rank findings by this)

| Sev | Meaning | Examples in this repo |
|-----|---------|-----------------------|
| **BLOCKER** | Data exposure, privilege escalation, data loss, or auth bypass | Missing RLS `WITH CHECK`, client-set `author_id`, unauthenticated `--no-verify-jwt` edge fn, `signOut({scope:'local'})` leaving refresh token |
| **HIGH** | Wrong results for real users, or a crash | PT/UTC boundary bug pulling wrong day's rows, unguarded `.single()` null deref, realtime subscription leak on a hot page |
| **MED** | Degraded correctness/perf under load, or half-done parity | N+1 query loop, desktop changed but Mobile twin not, query not going through `safeQuery` |
| **LOW** | Convention / hygiene | Hardcoded hex instead of token, `node_modules` staged, missing `getDisplayName` in a social context |

Prefer few high-confidence findings over a long list of maybes. If unsure whether something is a bug, say so explicitly and rank it MED at most.

---

## (a) Data layer

### RLS gaps — the primary boundary
RLS is *the* access boundary here, not client checks (see `02-security-review.md`). On any new/changed table or policy:

- [ ] **INSERT/UPDATE policies have a `WITH CHECK`, not just `USING`.** A UPDATE policy with `USING` but no `WITH CHECK` lets a user mutate a row into a state they shouldn't own. This exact gap was the `profiles` role self-promotion CRIT (closed by trigger `profiles_lock_admin_fields`). Smell: `FOR UPDATE ... USING (auth.uid() = user_id)` with no second clause → **fix:** add `WITH CHECK` and/or a column-lock trigger.
- [ ] **No `USING (true)` / `WITH CHECK (true)` on user-writable tables.** The chat tables (`channels`, `channel_messages`, `conversations`, `conversation_participants`) still carry this MED debt — any diff that adds a new table this way is a BLOCKER, not new debt.
- [ ] **Admin gates use `public.is_admin(auth.uid())`, not `role = 'admin'`.** `is_admin()` also returns true for `director_creative` / `director_comms`. Bare `role = 'admin'` silently locks those directors out (real MED bug on `progress_cards`, `tracking_post_goals`, `workflow_kanban_v2`).

### Client-side role checks
Client checks are UX, never security — but a *missing* one still ships a broken/leaky UI.

- [ ] Admin-only UI is gated with `{isAdmin && (...)}`. Flags come from `useAuth()` (`AuthContext.js:458-465`): `isAdmin` = `isAdminTier(role)` (admin + both directors), `isAssistant`, `isAgency`, `isFreelancer`, `canPost` = admin OR `posting_allowed`.
- [ ] A locked portal role (`agency`, `freelancer`) added to a page? Confirm the early-return guard in `AppLayout.js` / `AppLayoutMobile.js` still routes them to their locked page and that their RLS read set actually covers what the new UI queries — the agency reads through trimmed views (`agency_deliverables`, `agency_briefs`), so a raw `sponsor_deliverables` query from an agency-visible component returns nothing.

### N+1 queries
- [ ] No `await supabase...` inside a `.map`/`for` over a list. Smell: fetching each row's children in a loop → **fix:** one `.in('parent_id', ids)` query + group in JS. (Perf audit `audit_phase4_perf` targets exactly this.)

### Unsafe queries (`useSupabaseQuery`)
- [ ] User-facing reads that must survive a token refresh go through `safeQuery` from `useSupabaseQuery` (`src/hooks/useSupabaseQuery.js`). It retries once on JWT/`PGRST301`/401/403 errors after `refreshSession()`. A bare `await supabase.from(...)` on a page that stays open across a token expiry will throw a spurious auth error instead of retrying. Not every query needs it (fire-and-forget writes, edge-fn calls don't), but list/detail fetches on long-lived pages should.

---

## (b) PT-vs-UTC date boundary bugs — recurring bug class

The whole app runs on the **America/Los_Angeles** calendar (crons, Metricool, Google Calendar all assume PT), but Postgres `timestamptz` columns compare in **UTC**. This mismatch is a repeat offender (swept in commit `4240d094`; see `src/lib/ptDate.js` header comment and memory `pattern_pt_date_boundaries`).

**Two failure forms to spot:**

1. **Bare `'YYYY-MM-DD'` string filtered against a `timestamptz` column.** Postgres reads the string as UTC midnight, so a June 30 8pm PT row (which is July 1 in UTC) gets counted in July. Smell:
   ```js
   .gte('published_at', '2026-07-01').lte('published_at', '2026-07-31')  // WRONG
   ```
   **Fix** — anchor to PT via `ptRangeToUtc` and use a half-open range (real correct usage at `src/pages/Tracking.js:243,250-251`):
   ```js
   const { startUtc, endUtc } = ptRangeToUtc(start, end);
   query.gte('published_at', startUtc).lt('published_at', endUtc);  // note .lt, exclusive
   ```

2. **Deriving a day/month key from a UTC ISO slice.** `new Date(tstz).toISOString().slice(0,10)` gives the **UTC** calendar day, not the PT one — buckets late-PT rows into the wrong day/month. Smell: `.slice(0,10)` or `.slice(0,7)` on a timestamptz. **Fix:** `ptDayKey(iso)` / `ptMonthKey(iso)` from `ptDate.js` (both DST-aware via `Intl`).

**`ptDate.js` helper cheat-sheet:**
- `ptRangeToUtc(start, end)` → `{startUtc, endUtc}` for `.gte(startUtc).lt(endUtc)` (endUtc is PT-midnight of the day *after* `end`).
- `ptDateToUtcISO(dateStr, endExclusive?)` → single PT-midnight instant as UTC ISO.
- `ptDayKey(iso)` / `ptMonthKey(iso)` → PT-calendar `'YYYY-MM-DD'` / `'YYYY-MM'` bucket keys.

**Edge functions (Deno — cannot import `src/lib`)** inline their own `ptDayString(d?)` using `Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles'})`. Reviewing an edge fn that writes a daily-metric/day-key: confirm it uses that PT helper, not `d.toISOString().slice(0,10)`.

**SQL/RPC:** window a `timestamptz` by `(col AT TIME ZONE 'America/Los_Angeles')::date`, never `col::date` (which is a UTC cast).

**NOT a bug (don't flag):** plain `date`-typed columns (no TZ); rolling windows like `Date.now() - N*86400e3`; Metricool calls (the edge fn already passes `timezone=America/Los_Angeles`); pure display formatting.

---

## (c) Realtime subscription leaks

Pages subscribe with `supabase.channel(...).subscribe()` inside a `useEffect`. The effect **must** return a cleanup that calls `removeChannel`, or every remount/dep-change stacks a new live socket (leaks memory + fires duplicate refetches). Canonical correct shape (`src/pages/Deliverables.js:278-288`):
```js
useEffect(() => {
  const channel = supabase.channel('sponsors-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsors' }, () => fetchSponsors())
    .subscribe();
  return () => { supabase.removeChannel(channel); };   // REQUIRED
}, [fetchSponsors, refreshKey]);
```
Review checklist:
- [ ] Every `.channel(...).subscribe()` in a `useEffect` has a matching `return () => supabase.removeChannel(channel)`.
- [ ] The channel handle is captured in a local `const` (not recreated on each render outside the effect).
- [ ] Dep array is honest: callbacks referenced in handlers (`fetchSponsors`) are stable (`useCallback`) or intentionally in deps. An unstable callback in deps churns the subscription every render.
- [ ] Non-realtime effects too: `window.addEventListener` needs a matching `removeEventListener` (see `Deliverables.js:151`), timers need `clearTimeout` (`:940`).

---

## (d) Null guards

Supabase and jsonb payloads hand back nulls that crash on deref.

- [ ] **`.single()` result used before null-checking `data`.** A `.single()` on a filter that matches nothing returns `{data:null}` (or errors) — dereferencing `data.foo` throws.
- [ ] **jsonb / FK columns that are legitimately nullable.** The canonical case: `tasks.workflow_instance_id` is nullable (standalone automation tasks have no workflow). `workflow-complete-task/index.ts` guards it at `:47` (`!task.workflow_instance_id`) and `:138` (`if (!task.workflow_instance_id)`) to branch standalone vs workflow tasks. Any code that assumes a task belongs to a workflow instance must handle the null branch.
- [ ] `getDisplayName(profile)` already null-guards `profile` and `full_name` (`displayName.js:10-14`) — reuse it rather than `profile.full_name.split(...)` which throws on a missing profile.
- [ ] Optional-chain jsonb access from automation payloads / trigger configs (`payload?.video_id`), since template resolution runs on partially-populated objects.

---

## (e) Edge function auth

Functions deploy with `--no-verify-jwt`, so **Supabase does not gate them** — the function's own inline check is the only barrier. Reviewing any edge fn:

- [ ] **There is an inline auth gate before any side effect.** Accept **`CRON_SECRET`** (via `x-cron-secret` header or `?secret=`) **OR** a validated admin JWT. Canonical pattern (`run-automations/index.ts:516-554`): compare header to `Deno.env.get("CRON_SECRET")`; else `userClient.auth.getUser()` → look up `profiles.role` with the service-role client → 403 if not admin; else 401.
- [ ] **Privileged/spoofable actions require the cron secret, not just admin JWT.** `run-automations` event mode returns 403 `"Event mode requires CRON_SECRET"` (`:580-581`) so an admin can't hand-fire a fake `new_video` event and synthesize tasks. Apply the same reasoning to any new "fire an internal event" path.
- [ ] **New sync-*/drive-*/OAuth/Claude-cost/report fns keep their in-fn gate** — the gate is in the handler, not the `verify_jwt` flag (memory: don't strip it). Two fns instead use the shared `createHandler({auth})` wrapper (`fetch-rss` = `jwt`, `snapshot-daily-work` = `cron`) — equally valid, and both ARE authed (`shared/handler.ts:70-126`). The only intentionally-ungated endpoints are the tracking/unsub beacons (`mailer-track-open/click`, `jobs-view`, `mailer-unsubscribe`) — don't flag those. A new fn that burns Anthropic tokens or writes data without an admin check + per-user cap is a HIGH.
- [ ] **Stripe webhook** legitimately skips the CRON_SECRET check (the Stripe signature authenticates); gated on `stripe-signature` header presence. Don't flag that as missing auth.
- [ ] Cron transport is the **`x-cron-secret` header**, not `?secret=` in the URL (query lands in `cron.job_run_details` logs). Fns accept both for back-compat; new cron jobs should send the header.

---

## (f) Mobile / desktop parity

Many pages have a `*Mobile.js` twin (`Deliverables.js` + `DeliverablesMobile.js`, `Tracking.js` + `TrackingMobile.js`, `AppLayout.js` + `AppLayoutMobile.js`, `Ops` / `Messages`, etc.). A behavior change on one side frequently needs the same change on the twin.

- [ ] Diff touches a page with a `*Mobile.js` counterpart? Grep the twin for the same logic. A bug fix (esp. a PT-date fix or a role gate) applied to only one is a HIGH — the mobile users just don't get the fix. `Tracking.js` and `TrackingMobile.js` both import `ptRangeToUtc`; a boundary fix belongs in both.
- [ ] New role/portal early-returns exist in **both** `AppLayout.js` and `AppLayoutMobile.js`.
- [ ] Shared logic that diverged is a candidate to hoist into `src/lib` or a shared hook rather than fixed twice — but for a review, "apply to both twins" is the minimum bar.

---

## Fast pass order
1. Any SQL/migration → RLS `WITH CHECK` + `is_admin()` (BLOCKER hunt).
2. Any edge fn → inline auth gate present (BLOCKER hunt).
3. Any `timestamptz` filter or day/month key → PT helper (HIGH).
4. Any `.subscribe()` → cleanup (HIGH).
5. Any `.single()` / nullable FK deref → guard (HIGH).
6. Touched a page with a Mobile twin → check the twin (MED).
7. Style/displayName/commit hygiene → see docs 02 & 03 (LOW).
