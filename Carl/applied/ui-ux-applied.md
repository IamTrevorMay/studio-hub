---
title: "UI/UX Applied to the Mayday Studio App"
domain: applied
source_domain: ui-ux
tags:
  - mayday-studio-app
  - interaction-cost
  - command-palette
  - dashboards
  - freelancer-portal
  - neptune-performance
  - dark-ui
  - design-tokens
last_updated: 2026-07-12
---

# UI/UX Applied to the Mayday Studio App

Trevor — this is the efficiency-first playbook translated onto your actual surfaces: the Studio app you and the core team live in daily, the portals (freelancer, agency) other people touch weekly, and the software Neptune is going to need. The economics here are internal-tool economics: the same 5–10 people run the same ~15 workflows hundreds of times a day, so **learnability matters less, throughput matters enormously, and every saved second compounds** (see ui-ux/05-dashboard-internal-tool-design.md). One caveat runs through everything: you are the builder *and* the heaviest user, which means your instincts are excellent for your own paths and blind to everyone else's (see ui-ux/10-ux-research-metrics.md, §1).

## TL;DR

1. **Instrument before optimizing.** Log 5–10 events (page opens, card moves, task completes, status changes) per user per week for two weeks. With ~10 users you don't need a Top Tasks survey — the event counts *are* the frequency column. Every UX decision below should be re-ranked by `seconds saved × uses/day × users` (see ui-ux/01-interaction-cost-and-efficiency.md, §6).
2. **Ship a Cmd+K command palette.** The app has 30+ pages across Work/Admin modes and 6 roles — that's past the point where a sidebar alone scales. One registry, fuzzy search over pages + records + actions, recents-first empty state. It's also the action schema a future AI assistant drives (see ui-ux/07-keyboard-shortcuts-command-palettes.md).
3. **Adopt a 400ms latency budget, 100ms target, optimistic UI on every mutation.** Card moves, task checks, status changes should commit visually before Supabase confirms. Undo replaces spinners. Amazon lost ~1% of sales per 100ms; your version of that loss is flow-state breakage 200×/day.
4. **Kill the 7-step FreelancerTour.** Seven-step tours complete at ~16%; a 3-item checklist launched by the user completes at ~67%. Replace with checklist + working empty states (see ui-ux/12-onboarding-discoverability.md).
5. **Extract a token file from the inline styles.** 12–20 semantic color tokens + a 4px spacing scale, written down in one `tokens.md`. You build this app with AI assistance — a token contract is what keeps AI-generated screens on-system instead of adding the 14th button style (see ui-ux/09-design-systems-consistency.md).
6. **Tables + bulk actions + side drawers are the ops-tool trifecta.** Deliverables, Contractors, and Projects list views should get checkbox selection → contextual action bar → toast with Undo, and drawer detail instead of modals (see ui-ux/05, §4–5).
7. **Mobile is a companion, not a port** — triage, capture, approve. Except for Neptune, where the coach on the facility floor is **mobile-primary**: that's a different product with a one-thumb, under-60-seconds bar (see ui-ux/08-mobile-responsive-patterns.md).
8. **Watch one non-Trevor user per week.** David Korn doing a clip task, a freelancer submitting hours, the agency rep leaving a comment. Five users find ~85% of problems; you alone find your own paths only (see ui-ux/10).

---

## Part 1 — The Mayday Studio app (the daily driver)

### 1.1 The frequency audit comes first (Now, week 1)

The single biggest risk in this domain is optimizing what demos well instead of what runs 50×/day. The core math: **value = Δt × frequency × users × working days**. Shaving 4s off an action done 30×/day by 10 people is ~87 hours/year; shaving 60s off a monthly flow is ~2 hours/year — a 40× difference that is invisible without counting (see ui-ux/01, §6).

Concretely: add a lightweight `ui_events` table (or reuse your existing patterns) and log ~10 events — dashboard open, project card stage-move, sprint task complete, personal task complete, message sent, deliverable status change, analytics page open, research trend open, teleprompter session start, freelancer hours submit. Two weeks of data gives you the ranked list. My strong prior on what tops it: **task completes, card moves, message/channel checks, and dashboard opens** — which is why most of the Now list below targets those four.

Then keep a literal spreadsheet: task, daily frequency, current KLM seconds, proposed KLM seconds, users affected. Sort by the product. That spreadsheet *is* your UX roadmap.

### 1.2 Command palette (Now, weeks 2–4)

You have the exact profile where a palette pays: habitual daily users, a big surface (30+ pages, two sidebar modes, six roles), and pages that keep multiplying (Business Dev, Workflows, Jobs, Beta). The Work/Admin mode toggle is a fine pattern (see ui-ux/05, §7 — it's explicitly endorsed for separating everyday vs. administrative surface), but it also means some destinations are two mode-switches-and-a-scroll away. The palette is the escape hatch that makes everything one keystroke + a few letters away without redesigning the sidebar.

Build spec, stolen from Superhuman's five rules (see ui-ux/07, §3.3):

- **Cmd+K everywhere**, plus a visible "⌘K" affordance in the header so it teaches itself.
- **One central command registry** — decoupled from UI location. Definition of done for every new feature: "registered a palette command." This matters double for you because features ship weekly.
- **Search over three things**: pages (respecting role + your sidebar aliases — "Beat Sheet" and "production" should both hit), records (projects, deliverables, freelancers, BD initiatives), and actions ("new task," "invite freelancer," "sync YouTube").
- **Recents-first empty state.** Never open to an alphabetical dump — recents are the single biggest perceived-speed win.
- **Aliases** for your internal vocabulary drift (Clipping Tool = post_show, Custom Visuals = scene_builder — the aliases you already maintain for me should live in the registry).
- Dead simple v1: navigation + record jump only. Actions in v2. Don't build a form engine inside the palette.

Forward-looking reason to do it now: Cmd+K registries are converging with AI — the palette you build is the action schema an assistant executes later. Given how this app is developed, that's not hypothetical.

### 1.3 Speed: optimistic UI + the 400ms budget (Now, ongoing)

Every Supabase round-trip you currently await before updating the UI is a tax paid at your highest-frequency moments. The budget: **<100ms feels instant, 400ms (Doherty threshold) is the outer bound before flow breaks** (see ui-ux/04, ui-ux/05 §6). You don't need Linear's sync engine; you need their cheap 80%:

1. Optimistic updates on all mutations — card moves, checkbox toggles, status dropdowns commit locally first, reconcile on response, revert-and-toast on failure.
2. Stale-while-revalidate on list data — show cached, refresh in background. (This also chips at your known stale-tab problem: the UI should never look empty while refetching.)
3. Skeletons only on true first load; never spinner-flash a refetch.
4. Prefetch detail on row hover.
5. **Undo replaces confirmation** for recoverable actions. Keep type-the-name confirms only for entity-tree deletes (your BD phase-delete modal already does this correctly — that's the right pattern, don't spread it to non-destructive actions).

### 1.4 Keyboard layer (Next)

Calibration first: only ~6% of users prefer shortcuts even in Word, so the mouse path must stay excellent (see ui-ux/07, §2). But your daily-driver core (you, plus 1–3 admins) will internalize dozens. The layering:

- Global: Cmd+K (palette), `?` (cheat sheet), Cmd+Enter (submit any form/composer).
- Single-key when not typing, Gmail/Linear grammar: `c` create task, `j/k` move through lists, `x` select, `e` complete/archive, `g` then a letter for navigation.
- **The first thing to build is the "am I typing?" focus guard** and a single registry — never per-component listeners.
- Teach just-in-time: after someone mouses through the slow path 3×, show "Tip: press C" once. Show shortcuts in tooltips and palette rows so passive exposure does the teaching.

The killer capture pattern to pair with it: **global quick-add** — `c` from anywhere opens a one-line task composer with natural-language parsing ("pay editor invoice friday" → due date set). Low capture friction directly increases how much gets captured, and task creation is almost certainly in your top-5 frequency list.

### 1.5 Dashboard discipline (Now, small effort)

Apply the 5-second rule: open the Dashboard, and within 5 seconds you should know "is anything wrong / what needs me today?" (see ui-ux/05, §1–2). Your dashboard is the classic **morning-briefing hybrid** — so enforce the layout rule: operational content (overdue tasks, today's publishing schedule, IG story goal state, blocked freelancers, unresolved agency threads) goes top-left with the most contrast; analytical content (trend lines, platform metrics) goes below, never interleaved. The "Do this more" widget with green checkmarks is good glanceable design — the test is whether the *rest* of the screen earns its slots. Every widget must name the decision it supports; widgets that can't, move to Analytics. And with agency-unresolved counts, data-integrity alerts, and sync statuses all competing: red/amber only for things needing action *today*. Alarm fatigue is real — your daily YouTube missing-PDM noise is already an instance of it.

### 1.6 Tables, bulk actions, drawers (Next)

The list-heavy admin surfaces — Deliverables, Contractors/Freelancers, Jobs, Projects list view — should converge on one pattern stack (see ui-ux/05, §4–5):

- **Tables over cards** for anything you compare, sort, or bulk-edit. Cards for the stage-pipeline board (correct there), tables everywhere else.
- **Checkbox selection → floating contextual bar → toast with Undo.** "14 selected · Mark paid · Assign · Archive." Bulk actions are often the single highest-ROI accelerator in an ops tool, and payroll/deliverables reconciliation is exactly the use case.
- **Side drawer for record detail, not modals.** Drawer keeps the list visible and enables j/k record-to-record review — the flow you want when grinding through deliverables or contractor hours. You just fixed modals closing on text-drag; the deeper fix is fewer modals.
- **Inline editing** for low-stakes fields (status, tag, assignee) with Enter/Esc/tab-to-next; escalate to drawer for high-stakes fields (rates, payment info).
- Pagination or "load more" with persisted page-size preference — persisted **per account in Supabase**, per your own multi-machine rule, never localStorage.

### 1.7 Forms: the EAS gauntlet (Next)

Run every form through Eliminate → Automate → Simplify (see ui-ux/06). Priority targets by frequency: task creation (should be 1 field + optional details behind "More"), BD initiative/task forms (heavy metadata — title + workstream visible, everything else progressively disclosed; two disclosure levels max per ui-ux/03), freelancer hours entry (pre-fill the current bi-weekly period, remember last-used values), and invite flows. Rules that pay everywhere: validate on blur (+22% success, −42% completion time vs submit-only), top-aligned labels, never placeholder-as-label, forgiving formats normalized server-side, Cmd+Enter submits. Benchmark to actually measure: **% of submissions that succeed on first try — 78% is the compliant-form standard, 42% is what unaudited forms score.**

### 1.8 Tokens and the dark theme (Next)

You have the classic small-team setup where consistency rots fastest: inline styles, 100–200KB single-file pages, five screens built in five sprints. The fix is not a component library — it's **12–20 semantic tokens + a 4px spacing scale in one file**, and a 30–60 minute interface inventory (screenshot every button, chip, input; count the variants) to scope it (see ui-ux/09). Given AI-assisted development, the token file doubles as the prompt-time contract; teams report AI-generated-code review pass rates jumping from ~12% to ~78% once tokenized. Realistic v1: `tokens.js` exporting surface ramp, text tiers, semantic status colors, spacing, radii — then new/edited pages consume it; don't retrofit all 30 pages.

Dark-theme specifics worth encoding in those tokens (see ui-ux/11): `#0f0f1a` base is fine; elevation = *lightness*, so build a 4–6 step surface ramp (~4–8% lighter per level) instead of shadows; text tiers at 87% / 60% / 38% white, never pure white; desaturate the indigo family for large fills and check `#6366f1` hits 4.5:1 on every surface it sits on (it's borderline on lighter raised panels); status colors always paired with an icon or label — ~8% of men can't read a red/green dot system, and your status-chip-heavy UI (project stages, BD statuses, sync health) is exposed here.

### 1.9 Mobile (Next → Later)

The Studio mobile experience should be an explicit **companion**: notifications triage, quick task capture, approvals, status checks, and the away-from-desk creator jobs (check today's schedule, review a sponsor deliverable between shoots). The audition for every mobile screen: one thumb, under 60 seconds, primary actions in the bottom third, 44pt targets (see ui-ux/08). Data tables don't survive mobile — 2–3 identifying fields as stacked cards, rest behind a tap. Don't chase desktop parity; "powerful sidekick" is the scope statement.

---

## Part 2 — The portals (freelancer + agency)

### 2.1 Replace the FreelancerTour (Now)

The numbers are unambiguous: 7-step tours complete at ~16%; 3-step at ~72%; checklist-launched tours at ~67% vs ~23% auto-fired (see ui-ux/12). The current auto-triggered 7-step tour is teaching almost nobody. Replace with:

- A **3-item onboarding checklist** on the freelancer dashboard: "Complete your profile (payment info)" → "Open your assignment folder" → "Log your first hours." Each item is an action, progress visible, dismissible.
- **Empty states that do three jobs**: not broken / what will live here / one action that fills it. "No assignments yet — your producer assigns work here; you'll get a notification" beats a tour slide seen once and forgotten.
- Keep pull over push: ~76% of static tooltips are dismissed within 3 seconds; anchor any remaining hints to the moment someone first enters a flow.

Measure "time to first unaided task" — first hours submission or file upload without a Slack/DM question. Every "where do I…" message from a freelancer is an onboarding bug, not a support ticket.

### 2.2 Agency portal: protect the peak-end (Now, cheap)

The agency portal is read-only and comment-driven, so its UX *is* the comment loop. Two things matter: (1) the unresolved-thread mechanic you built is the right model — keep the invariant that any admin reply clears it for everyone; (2) the 20s polling + realtime means state can visibly lag — make freshness explicit ("updated 12s ago") rather than letting a stale row erode trust (H1, visibility of system status — see ui-ux/04). This portal is also a business surface: the agency's felt experience of working with Mayday Media is mostly this screen plus your response latency. Peak-end rule says invest in the moment a proposal gets confirmed — make that state change loud and satisfying, not a silent row update.

### 2.3 Portal provisioning (standing rule)

For any external party — freelancer, agency, future Neptune coach — onboarding is mostly upstream of the UI: pre-provisioned access, one link, and a first screen showing *their* work waiting. If adding a partner takes staff more than ~2 minutes, it won't happen consistently and the partner gets the degraded path (see ui-ux/12, §portals). Your invite-flow-reads-invitation-table pattern is right; keep extending it rather than inventing per-portal setup.

---

## Part 3 — Neptune Performance (the facility)

Neptune's software needs are a different genre and it's worth naming that before anything gets built:

1. **Coach on the floor = mobile-primary, not companion** (see ui-ux/08, §1). Logging an athlete session, pulling up a program, capturing video notes — one thumb, gloves-adjacent conditions, 10–90 second sessions. If you extend Mayday Studio for this, it's a new mobile-first surface, not a responsive reflow of an admin page. Wroblewski's test verbatim: core task, one thumb, under 60 seconds.
2. **Parent/athlete booking = one-shot consumer forms**, the opposite optimization target from your internal tools: completion rate over throughput. ≤5 visible fields (~120% better conversion than longer forms), defer account creation to post-booking, mobile-first because local-service traffic is phone-dominant (see ui-ux/06). Strong recommendation: **buy this** (Mindbody-class scheduling or similar) rather than build, at least through launch — booking is generic CRUD + payments, exactly where buy beats build (see ui-ux/05, §7 build-vs-buy math). Build only what's differentiated: athlete development data and its presentation.
3. **The facility dashboard** (utilization, memberships, session counts) belongs in Studio's Analytics/BD world and follows the same 5-second rule. Operational (today's sessions, no-shows) vs analytical (utilization trend vs. capacity) split applies directly.
4. **The BD page is Neptune's cockpit until launch** — its UX priority tracks the launch countdown. The four-level hierarchy (Phase → Workstream → Initiative → Task) is at Nielsen's 2-level disclosure ceiling once you count the Completed expanders (see ui-ux/03); resist adding a fifth level or nested sub-tasks. If the tree feels heavy, the fix is the My Stuff view + palette jump-to-initiative, not more structure.

---

## Sequencing

**Now (next 30 days)**
1. Instrument 5–10 events; start the frequency spreadsheet (ui-ux/01, ui-ux/10)
2. Cmd+K palette v1 — navigation + record jump, recents-first (ui-ux/07)
3. Optimistic UI on the top-3 mutations by frequency; 400ms budget adopted as policy (ui-ux/05)
4. Replace FreelancerTour with 3-item checklist + empty states (ui-ux/12)
5. Dashboard 5-second pass: operational top-left, cut widgets that name no decision (ui-ux/05)

**Next (this quarter)**
6. Global quick-add with NL parsing + single-key shortcut layer with focus guard (ui-ux/07)
7. Bulk actions + drawer pattern on Deliverables and Contractors (ui-ux/05)
8. EAS pass on task creation, BD forms, hours entry; on-blur validation everywhere (ui-ux/06)
9. `tokens.js` + interface inventory; dark-theme surface ramp and text tiers encoded (ui-ux/09, ui-ux/11)
10. Weekly one-user observation ritual: watch a freelancer, David, or the agency rep do a real task (ui-ux/10)

**Later**
11. Mobile companion scope-down done deliberately (triage/capture/approve) (ui-ux/08)
12. Neptune coach-floor mobile surface (build) + booking (buy) (ui-ux/08, ui-ux/06)
13. Palette v2: actions + AI intent layer on the command registry (ui-ux/07)
14. If productizing Studio for other creator teams: onboarding, empty states, and adopt-tier design system become the actual product work — budget a quarter, not a sprint (ui-ux/09, ui-ux/12)

## What I'd need to know (facts that would change this advice)

- **Actual event frequencies.** Everything above assumes tasks/cards/messages dominate. If Teleprompter or PostShow sessions are actually the highest-minutes surfaces, the optimization order flips toward those tools.
- **Who uses the app daily besides you, and on what hardware?** If it's realistically 2–3 daily drivers, the keyboard layer's ROI rises and the onboarding work falls; if assistants/members are daily, the reverse.
- **Mobile share of sessions today.** If >25% of core-team usage is already on phones, the companion app jumps from Later to Next.
- **Neptune's software plan** — buy vs. build for booking/CRM, headcount of coaches at launch, and whether athletes/parents get any app at all in year one. This determines whether Part 3 is a Studio extension or a separate product.
- **Is productization of Studio real?** If yes, roughly a third of this playbook re-prioritizes: learnability, onboarding, and theming stop being nice-to-haves.
- **The agency's actual usage pattern** — sessions/week and time-to-reply on threads. If they check twice a month, portal polish drops below freelancer-portal work.
- **Freelancer count trajectory.** At 3 freelancers, the checklist is enough; at 15+, invest in the full time-to-competence pipeline and hours-entry throughput.

## Sources

Drawn from all 12 reference docs in `Carl/ui-ux/` (01–12), applied against `Carl/context/mayday-context.md` and the app architecture in `CLAUDE.md`.
