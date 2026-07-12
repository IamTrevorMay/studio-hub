---
title: "Interaction Cost & Action-Minimization"
domain: ui-ux
tags:
  - interaction-cost
  - klm-goms
  - fitts-law
  - hicks-law
  - task-analysis
  - accelerators
  - efficiency
sources_reviewed: 14
last_updated: 2026-07-12
---

# Interaction Cost & Action-Minimization

Frameworks for deciding how much effort a UI is allowed to demand, how to measure that effort objectively, and how elite teams decide which actions earn one-click (or zero-click) treatment.

## TL;DR

- **Interaction cost = physical + mental effort (IC = P + M).** Never optimize click count in isolation — a design that saves one click but adds a decision, a memorization, or a "where did that go?" moment is usually a net loss (NN/g).
- **You can estimate task time on paper before building anything.** KLM-GOMS assigns seconds to each keystroke (~0.2s), mouse point (~1.1s), and mental prep (~1.35s). Sum the operators, compare two designs, pick the faster one. Predictions land within ~21% of reality for practiced users.
- **The 3-click rule is a myth** (no study has ever supported it; Porter's 2003 study of 44 users / 620 tasks / 8,000+ clicks showed no drop-off after click 3). What kills users is weak information scent and page-load waits, not click count. Budget *interaction cost*, not clicks.
- **Frequency is the multiplier that decides everything.** Value of an optimization = (seconds saved per use) x (uses per day) x (number of users). A 1-second saving on a 50x/day action beats a 30-second saving on a monthly action. Run a Top Tasks / frequency-weighted audit before optimizing anything.
- **One-click treatment is earned by: high frequency + low ambiguity + easy reversal.** Amazon 1-Click worked because the intent is unambiguous, the data is pre-stored, and orders are cancellable. If an action is rare, destructive, or ambiguous, do NOT make it one click.
- **Serve experts without taxing novices via accelerators** (Nielsen heuristic #7): keyboard shortcuts, command palettes, bulk actions, templates, defaults. Novices never see them; experts blow past the efficiency plateau.
- **Latency is interaction cost too.** 100ms feels instantaneous (Buchheit's rule; Superhuman targets <50ms). Amazon measured ~1% sales loss per 100ms of delay; Google saw 20% traffic drop from a 500ms search delay.
- **Removing fields/steps has measurable ROI** — Expedia removed one confusing optional form field and gained ~$12M/yr. But remove the *right* things: the field failed because it caused errors, not because it was "one field too many."

---

## 1. Interaction Cost — the master frame (NN/g)

**Definition:** "The sum of efforts — mental and physical — that users must deploy in interacting with a digital product in order to reach their goals." The theoretical ideal is zero interaction cost: the user thinks it, it happens. Everything a UI does is a tax collected on the way to the user's goal; the job is to lower the tax.

### The full component list

Interaction cost is not clicks. NN/g enumerates the actual components:

| Component | Type | Notes |
|---|---|---|
| Reading | Mental | Every label, tooltip, instruction |
| Scrolling | Physical (cheap) | Much cheaper than clicking to a new page |
| Looking around / visual search | Mental | Finding the target before you can hit it |
| Comprehending | Mental | Jargon, ambiguous labels, unfamiliar icons |
| Clicking/touching (incl. avoiding errors) | Physical | Small/crowded targets raise cost via precision demand |
| Typing | Physical | The most expensive common physical action |
| Waiting (page loads, spinners) | Both | Pure loss; also breaks flow state |
| Attention switching | Mental | Modals, new windows, context jumps |
| Memory load | Mental | Anything the user must carry from screen A to screen B |

Costs vary by user (a dyslexic user pays more for reading) and by device (mobile page loads and typing are far more expensive than desktop).

### The core equation and the tradeoff rule

**IC = P + M** (physical + mental effort). The critical NN/g insight: **it is not worth reducing P slightly if M grows a lot.** Classic failure: collapsing five clearly labeled buttons into one "smart" button with a hidden dropdown — one fewer click, but now every user must think, hover, and discover. Mental operators are more expensive than physical ones (KLM literally prices M at 1.35s vs 0.1s for a button press — a 13x ratio).

### Expected utility — why users abandon

Users behave (approximately) as: **Expected utility = Expected benefit − Expected interaction cost.** Two implications:

1. Between two paths to the same benefit, users take the cheaper one — even if it produces a worse outcome (they'll use the mediocre feature that's one tap away over the great feature buried three menus deep).
2. Users tolerate high cost only when motivation is high (your product is the only place to get X). The moment a competitor offers the same benefit cheaper, high-IC products bleed users. Marketing raises perceived benefit; UX lowers cost; both raise net utility.

### Micro-audit example (NN/g's dictionary lookup)

A "simple" task — look up a word's etymology in a dictionary app — decomposes into: splash-screen wait → find and tap search box → scan recent-search suggestions → type + evaluate autosuggest → wait for results → scan tabs for the right section → scroll to "ORIGIN OF..." → read. Eight cost-bearing substeps for one lookup. This decomposition move — narrating every substep of a "simple" task — is the single most useful audit habit. Do it out loud for any flow you're evaluating.

---

## 2. KLM-GOMS — pricing a flow in seconds

The Keystroke-Level Model (Card, Moran & Newell, 1980 CACM paper; 1983 book *The Psychology of Human-Computer Interaction*) is the simplest GOMS technique: list the physical/mental operators a practiced, error-free user executes, sum their empirically measured times, and you have a predicted task time — **before writing any code**. Best use: comparing two candidate designs for the same task.

### Operator table (memorize these)

| Op | Meaning | Time |
|---|---|---|
| **K** | Keystroke (press + release) | 0.20s avg skilled typist (55 wpm); 0.08s best typist (135 wpm); 0.12s good (90 wpm); 0.28s avg non-typist (40 wpm); 0.50s random letters; 0.75s complex codes; 1.20s worst-case unfamiliar keyboard |
| **P** | Point mouse to a target | 1.10s (average; actually governed by Fitts's law) |
| **B** | Mouse button press or release | 0.10s (a click = BB = 0.20s) |
| **H** | Home hands between keyboard and mouse | 0.40s |
| **D** | Draw n segments of total length l cm | 0.9n + 0.16l seconds |
| **M** | Mental preparation (decide/retrieve/verify) | 1.35s |
| **R/W** | System response time | Measured; count only the non-overlapping wait |

### Where to place M operators (the heuristic rules)

1. **Rule 0 (insert):** Put M before every keystroke chunk that isn't part of a text/number argument string, and before every P that selects a command (not an argument).
2. **Rule 1 (delete):** Remove an M if the operator after it is fully anticipated by the operator before it (P→M→K becomes P→K).
3. **Rule 2 (delete):** Within one cognitive unit (e.g., typing a known command name), keep only the first M.
4. **Rule 3 (delete):** Drop M before redundant terminators.
5. **Rule 4 (delete/keep):** Delete M before a keystroke terminating a constant string; keep it for variable strings.

### Worked comparison (from the literature)

Deleting a file, average typist:

- **Design A — drag to trash:** 2M + 3P + 2B = 2(1.35) + 3(1.1) + 2(0.1) = **6.2s**
- **Design B — select + Ctrl+T:** 2M + 1P + 2B + 2H + 2K = 2.7 + 1.1 + 0.2 + 0.8 + 0.4 = **5.2s**

Design B wins by ~1s per use despite having *more* discrete operations — count seconds, not steps. At 20 deletions/day across 500 users, that's ~2.8 person-hours saved daily from one shortcut.

### Accuracy, scope, limitations

- Prediction error: **~21% RMS** vs. observed times — plenty accurate for A-vs-B design decisions.
- Models **expert, error-free, routine** execution only. It says nothing about learnability, discoverability, or error recovery. A KLM-optimal design can still be undiscoverable garbage for new users.
- Practical ceiling: tasks under a few minutes. Longer tasks get tedious to model and errors dominate.
- Touch extensions exist (Tap, Swipe, Pinch, Drag, Tilt, plus a multiplicative "Distraction" factor for mobile contexts) — the exact constants are less settled than the desktop set, but the method transfers.

**Carl's move:** when a client debates two flows, don't argue taste — write both operator sequences on a whiteboard, price them, multiply by daily frequency. The argument usually ends in five minutes.

---

## 3. Fitts's Law — pricing pointing

**T = a + b · log₂(2D/w)** — time to acquire a target grows with distance (D) and shrinks with target width (w) along the axis of motion. The log₂ term is the Index of Difficulty in bits. This is *why* KLM's P averages 1.1s — and why P is not actually constant: big, close targets are fast; small, far ones are slow.

Movement has two phases: a fast ballistic phase (distance-driven) and a slow correction phase (size-driven). **Small targets are punished in the correction phase** — that's where the time and errors live.

### Design implications that actually matter

- **Bigger targets, always-labeled icons.** An icon + text label is one larger combined hit area; error rate falls as size grows (with diminishing returns).
- **Screen edges and corners are effectively infinite targets** for mouse UIs — the cursor pins against them, no deceleration needed. That's why the macOS menu bar (top edge) and Windows taskbar (bottom edge) are fast. **This does NOT apply to touchscreens** — edge placement gives no Fitts benefit on touch and can raise error rates.
- **Menu geometry ranking (fastest to slowest):** pie menus (everything equidistant) → rectangular/mega menus → long linear menus. For linear menus, put frequent items at the top or center the menu on the trigger.
- **Sequence-aware placement:** put the next control near where the user's pointer/finger already is. Submit button directly below the last form field, not at the top of the page. Mobile contextual actions adjacent to the element, not in a bottom sheet across the screen.
- **Thumb zone on mobile:** primary actions belong in the natural thumb arc (bottom-center); this is why floating action buttons and bottom tab bars won.
- **Don't crowd targets** — adjacent small targets convert speed into misclicks, and misclick recovery is one of the most expensive interaction costs there is (undo + re-navigate + re-orient).

---

## 4. Hick's Law — pricing choice

Decision time grows with the log of the number of equally likely choices. Doubling options doesn't double decision time, but every added option adds measurable delay and cognitive effort — and the log relationship only holds when options are *well-organized and familiar*. A disorganized list of 20 items is read linearly and priced linearly.

### Implications

- **Trim navigation; never present five equally weighted CTAs.** One primary action per screen; secondary actions visually demoted.
- Hick's covers **decision** time; Fitts's covers **movement** time. A full action = (Hick's: choose) + (Fitts's: acquire) + (KLM: execute). Optimize all three.
- **Category chunking beats item removal** when you can't cut options: 30 items in 5 labeled groups scan far faster than a flat 30 (users do two log-scale decisions instead of one linear scan).
- The corollary that teams forget: **defaults are the ultimate Hick's hack.** A pre-selected sensible default reduces n choices to a yes/no confirmation.
- Related: **Tesler's law (conservation of complexity)** — irreducible task complexity doesn't vanish, it moves. Every option you remove from the user either gets absorbed by the system (good: smart defaults, inference) or dumped back on the user later at a worse moment (bad: support tickets, workarounds). Ask *where the complexity went*, not just whether the screen looks cleaner.

---

## 5. Click budgets and the death of the 3-click rule

### The myth

"No important content more than 3 clicks away." Traced to Jeffrey Zeldman's 2001 *Taking Your Talent to the Web*, offered with **zero data** ("users *might* move on"). NN/g's verdict: not supported by any published study to date.

### The evidence

Joshua Porter (UIE, 2003): 44 users, 620 tasks, 8,000+ analyzed clicks. **No increase in drop-off and no decrease in satisfaction after the third click.** Users went as deep as 25 pages when they were finding what they wanted. Porter's conclusion: people complain about clicks when they're actually upset about *not finding the thing*. The fix is scent, not surgery on click counts.

### Why raw click-counting fails as a metric

1. **Context-dependent:** complex tasks legitimately need more steps; no universal threshold exists.
2. **Clicks are unequal:** a click that expands an accordion costs ~0.3s; a click that loads a new page costs the click + the wait + the re-orientation. NN/g is explicit that page-load clicks are a different species.
3. **It ignores the actual experience:** confusion, errors, and backtracking don't show up in a click count.

### When clicks DO matter (don't over-correct)

- When each click carries a **page-load wait**.
- When the flow is **repeated at high frequency** (this is the whole next section).
- When clicks are forced by **error-recovery loops**.
- When steps **compound cognitive load** — scanning long lists, tracking position, predicting how many steps remain.

### The right reframe: interaction-cost budget

Replace "max 3 clicks" with: *for this task at this frequency, what total seconds and how many decisions is the user allowed to spend?* A useful working posture:

- **Many-times-daily tasks** (mark done, log entry, reply): target one action from wherever the user already is, sub-second response. These deserve KLM modeling.
- **Daily/weekly tasks:** a few well-scented steps are fine; eliminate waits and re-orientation between steps.
- **Rare/complex/consequential tasks** (delete account, run payroll, configure billing): steps are *good* — they add safety and comprehension. Do not one-click these.

---

## 6. Frequency-weighted task analysis — how elite teams decide what gets one click

This is the decision layer above all the mechanics. Optimization effort should follow **frequency x cost**, not stakeholder volume or what demos well.

### The core math

> **Value of an optimization = Δt (seconds saved per execution) × f (executions per user per day) × N (users) × working days**

Worked example: shaving 4 seconds off an action done 30x/day by 10 staff = 20 min/day = ~87 hours/year. Shaving 60 seconds off a monthly report = ~2 hours/year. The "impressive" optimization is 40x less valuable. Elite teams keep a literal spreadsheet of (task, frequency, current KLM time, proposed KLM time, users affected) and sort by the product.

### Top Tasks method (Gerry McGovern)

Used 600+ times by organizations including the European Parliament, WHO, Cisco, Microsoft, IBM, Toyota. Mechanics (per McGovern and MeasuringU):

1. **Gather a long list** of candidate tasks (50–100) from analytics, search logs, support tickets, stakeholder interviews. Phrase in the *user's* language — no internal jargon. Actionable phrasing ("check whether my doctor is covered"), not feature names.
2. **Randomize order and have representative users vote for their top 5** (top 3 if the list is only 20–30 items). Randomization matters — position bias is real.
3. **Graph descending.** The distribution is always brutally skewed — a "long neck" where a handful of tasks capture a huge share of votes and the rest are noise. This skew replicates essentially every time the method is run.
4. **Sample sizes** (90% confidence): ~65 for ±10%, ~136 for ±7%, ~268 for ±5%. Rank order tends to stabilize around 200 respondents; 100–150 suffices for a homogeneous existing-customer base; 100 is enough for a pilot to see the skew.
5. **Use the top tasks as the design spine and as benchmark tests** — measure time-and-success on the top tasks release over release.

For an internal tool with 10 users, skip the survey and just *instrument*: event counts per feature per user per week give you the frequency column directly. Then interview for the pain column.

### The one-click decision checklist

An action earns one-click (or zero-click) treatment when it clears ALL of these:

1. **High frequency** — top-tasks head, done daily-plus by real users.
2. **Unambiguous intent** — the system already knows every parameter, or safe defaults cover >90% of cases (Amazon 1-Click works because address + payment are pre-stored and the intent "buy this" needs no configuration).
3. **Cheap to reverse** — undo exists, or consequences are trivial. One-click + irreversible = incident factory.
4. **Reachable from where the user already is** — a one-click action buried two navigations deep is a three-action task.
5. **Low collision risk** — big-enough target, not adjacent to a destructive neighbor (Fitts's correction phase again).

Fails on ambiguity → use smart defaults + one confirm. Fails on reversibility → keep the confirm step forever and invest in making the confirm fast instead. Fails on frequency → leave it alone; it doesn't merit the surface area.

### Zero-click is the real endgame

The frequency logic extends past one click: high-frequency + fully-inferable actions should be **automated or defaulted away entirely** (auto-save vs. save button; pre-filled forms; recurring tasks that create themselves; sync instead of import). Every mature efficiency program migrates its top tasks down the ladder: multi-step → few-step → one-click → zero-click. NN/g's progressive-disclosure framing adds the money line: it "earns money twice — lower training and support costs on one side, higher task completion on the other."

---

## 7. Accelerators — serving experts without taxing novices

Nielsen's usability heuristic #7 (Flexibility and Efficiency of Use): "Accelerators — unseen by the novice user — may speed up the interaction for the expert user such that the system caters to both inexperienced and experienced users." The point is you never have to choose between a learnable UI and a fast one — you layer them.

### The accelerator toolbox (NN/g taxonomy + practice)

- **Keyboard shortcuts** — the classic. Novice navigates menus; expert presses the key. Never override universal ones (Ctrl+C/V/A/P). Let power users customize (InDesign model).
- **Command palettes (Cmd+K)** — originated in code editors (Sublime, VS Code), now standard in Figma, Notion, Linear, Superhuman, Slack. Killer property: fuzzy search over *all* commands means the expert needs to memorize one shortcut, not fifty — and it lets you keep the visible UI minimal without amputating functionality.
- **Gestures** — swipe-to-archive/reply (WhatsApp swipe-to-reply), double-tap to like, long-press menus.
- **Batch/bulk operations** — checkboxes + act-on-many. Multiplies the value of every downstream action; often the single highest-ROI accelerator in ops tools.
- **Macros & automations** — record/script a command sequence, run with one trigger (Airtable automations pattern).
- **Templates, snippets, saved searches, recents** — pre-package the frequent 90% of an otherwise variable input.
- **Smart defaults & remembered state** — remember last sort order, last-used values, last filter. Cheapest accelerator to build; personalization can be this simple.
- **Customization** — user-arranged workspaces (Logic Pro Screensets recallable by one keystroke). Caveat from NN/g: most users never customize, so don't rely on it as the primary path.

### Discoverability without noise

- Show shortcuts inline next to menu commands (repeated passive exposure teaches experts; novices ignore it for free).
- Just-in-time contextual hints after the slow path is used ("Tip: swipe to do this faster" — the Slack pattern).
- Full cheat sheet in Help; `?` to open it is itself a convention.
- Reveal gradually — pitching accelerators at first-run overwhelms novices.
- Give visual feedback on accelerator use, and back destructive accelerators with undo.
- Anti-pattern: duplicating a function in five UI locations "for flexibility" — that raises learning cost without raising speed.

### Speed as product: latency budgets

Latency is interaction cost — waiting is pure loss and it breaks flow.

- **100ms rule** (Paul Buchheit, Gmail creator): under ~100ms, interactions feel instantaneous. Superhuman treats 100ms as a *maximum* and targets **<50ms**, with its renderer hitting 1–2 Chrome frames (<32ms).
- Business numbers: **Amazon: every 100ms of delay ≈ 1% of sales. Google: a 500ms delay on search results cut traffic 20%.**
- Superhuman's full playbook: keyboard shortcut for every action + Cmd+K palette + local caching/offline store + preloading likely-next threads + minimal animation. Reported outcome: customers save ~3 hours/week on email. Note the composition — the speed comes from *stacked* techniques (input speed + response speed + prediction), not one trick.
- Practical tiers to design against: <100ms feels instant (no feedback needed beyond the result); ~1s keeps flow (show the change, skip spinners); multi-second requires progress indication and is a candidate for optimistic UI (render the assumed success immediately, reconcile in background).

---

## 8. Case studies with numbers

**Amazon 1-Click (1999 patent).** Baseline e-commerce checkout was 4–5 steps (cart → login → address → payment → confirm). 1-Click stored payment + shipping and collapsed repeat purchase to a single action. Widely cited (secondary-source, treat as directional): conversion roughly 2.5% → 10%+, cart abandonment down 40–45%. Apple licensed it in 2000 for iTunes/App Store. When the patent expired in 2017, Shopify/Bolt-style one-click checkout followed immediately — the pattern was worth copying the day it was legal. The transferable lesson is the *precondition structure* (stored parameters + unambiguous intent + reversible order), not "remove steps."

**Expedia's $12M form field.** Analysts noticed a gap between "Buy Now" clicks and completed revenue. Cause: an optional "Company" field under "Name" — users entered their *bank's* name, then the bank's address, and the card verification failed. Deleting the field recovered ~$12M/yr plus support savings. Two lessons: (1) fields cost money even when optional, because they create *error* cost, not just typing cost; (2) their VP of analytics said they found "50 or 60 of these" through analytics — instrument funnels and hunt discrepancies; one-off audits don't find these.

**Porter / UIE 3-click study (2003).** 44 users, 620 tasks, 8,000+ clicks: no drop-off or satisfaction decline past 3 clicks; successful journeys ran 3–25 clicks. Killed a fake constraint that had been distorting IA decisions for years.

**Superhuman.** Positioned entirely on one attribute — speed — with a $30/mo price in a category Gmail gives away free. The 100ms/50ms budgets above; ~3 hrs/week reported savings. Proof that interaction cost is monetizable as the *headline* value prop for professional tools.

**Top Tasks deployments.** 600+ runs (EU Parliament, WHO, Cisco, Microsoft, IBM, Toyota) all reproduce the same skew: a small head of tasks dominates votes. The method's real product is political — it gives you a defensible, user-voted ranking to say *no* to the long tail with.

---

## 9. Playbooks

### 9.1 Steps-to-complete audit (half a day per product area)

1. List the candidate tasks; get frequency per task (analytics events > logs > user interviews, in that order of preference).
2. Sort by frequency x pain; take the top 5–10.
3. For each: perform the task yourself **from the app's resting state** (not from the ideal screen) and narrate every substep NN/g-style — waits, scans, reads, decisions, scrolls, clicks, typing, memory carries.
4. Record: total actions, total decisions (M-count), total waits, and wall-clock time. Screen-record so you can recount honestly.
5. For the top 3, write the KLM operator string and price it.
6. Propose the cheaper flow; price it too; compute Δt x f x N.
7. Ship, then re-measure the same tasks (these become your permanent benchmark tests, per Top Tasks practice).

### 9.2 Rapid heuristics when you can't run the full audit

- Any high-frequency action requiring **navigation before execution** → surface it where the user already is (dashboard, row-level action, keyboard shortcut, palette).
- Any form field → justify or delete; prefer defaults/inference over asking. Optional fields still cost (Expedia).
- Any confirmation dialog → replace with undo unless genuinely irreversible.
- Any page-load between steps of one task → collapse to inline/optimistic interaction.
- Any list the user scans repeatedly → default sort/filter to the frequent case; remember state.
- Any repeated multi-item operation done one-at-a-time → bulk actions.
- Anything the system already knows → never ask the user for it again.

### 9.3 The one-click promotion pipeline

For each top task, place it on the ladder and push it down one rung per iteration:

`multi-screen flow → single screen → single action → automatic/default`

Gate each promotion with the Section 6 checklist (frequency, unambiguous intent, reversibility, reachability, collision safety). Log every promotion's Δt x f x N so the efficiency program has a running ROI tally — that's what keeps it funded.

### 9.4 Expert-layer rollout order (for an existing product)

1. Instrument to find the true top 10 actions per role.
2. Ship undo for anything destructive (prerequisite for everything below).
3. Add keyboard shortcuts for the top 10; show them inline in menus/tooltips.
4. Add a Cmd+K palette exposing every command (one memorization covers all).
5. Add bulk select + bulk actions on the main list views.
6. Add just-in-time hints when the slow path is used repeatedly.
7. Measure adoption; expert-layer usage share is your power-user health metric.

---

## 10. Common mistakes

- **Counting clicks instead of pricing cost.** The 3-click rule is folklore. A cheap extra click with strong scent beats a saved click that forces a decision or a hunt.
- **Reducing P while inflating M.** Hamburger-ing the nav, icon-only toolbars, "smart" consolidated buttons — fewer visible actions, more thinking. Remember the 13x price gap between a mental op (1.35s) and a button press (0.1s).
- **Optimizing rare tasks because a loud stakeholder does them.** Frequency-weight or you're doing theater. The spreadsheet (task, f, Δt, N) settles it.
- **One-clicking the irreversible.** Speed without undo converts efficiency into incidents. Reversibility is the license for speed.
- **Over-simplifying for novices and capping experts.** Wizard-only flows with no accelerator layer put a permanent ceiling on your heaviest users — the ones who generate most of your value. Heuristic #7 exists precisely for this.
- **Progressive disclosure with too many layers, or hiding the wrong things.** Disclosure reduces load only if the hidden stuff is genuinely rare; burying frequent controls one level down is a per-use tax on everyone. Also don't confuse progressive *disclosure* (reveal more when ready) with progressive *reduction* (interface simplifies as expertise grows).
- **Treating latency as an engineering afterthought.** Waits are interaction cost with hard revenue numbers attached (1%/100ms at Amazon). Set a latency budget per interaction class at design time.
- **Removing steps that carried comprehension or safety.** Some steps exist to build understanding or prevent errors (payroll runs, deletions, publishing). Tesler's law: the complexity you remove goes somewhere — make sure it went into the system, not into support tickets.
- **Shipping accelerators nobody can discover.** Shortcuts absent from menus/tooltips/palette are features that don't exist. Conversely, don't scatter one function across five UI homes — duplication raises learning cost.
- **Auditing from the ideal screen.** Real cost includes getting there from the app's resting state. Measure from cold start.

---

## 11. Questions Carl should ask

**Diagnosis**
1. What are the ten actions your team performs most times per day? (If they can't answer with data → instrument first, optimize second.)
2. For the single most frequent action: walk me through it from app-open. How many screens, decisions, and waits? What does it cost in seconds, and times how many executions per day?
3. Where do users say "there's got to be a faster way" — and what workarounds/spreadsheets/sticky-notes have they built outside the product? (Workarounds are frequency-weighted pain made visible.)
4. What data are you asking users for that the system already knows or could default?
5. Where do funnel numbers and completion numbers disagree? (The Expedia question — that gap is where the money is.)

**Prioritization**
6. If we could make exactly one action one-click this quarter, which wins on Δt x f x N? Show the arithmetic.
7. Which of your "simplifications" removed a step but added a decision or a hunt? Any features that got *slower* for daily users after a redesign?
8. What's in your top-tasks head vs. long tail — and what long-tail features are currently occupying prime screen real estate?

**Safety & experts**
9. Which one-click actions are irreversible? Do they have undo, or a confirm? (If neither, that's the first fix.)
10. What can your most experienced user do without touching the mouse? Is there a command palette? Bulk actions on the main lists?
11. When a power user does the slow path 20 times in a row, does the product teach them the fast path?

**Measurement**
12. What's your latency budget for the core interaction, and what's the p95 today? (If no budget exists: instant <100ms for the top actions, and everything over ~1s needs a plan.)
13. Which top tasks do you re-benchmark (time + success rate) each release? If none — that's the scoreboard to build.

---

## Relevance notes (small media co / training facility / internal ops tools)

- **Internal ops apps live or die on this material.** With ~10 staff users, N is small but f is huge and users are captive — captivity hides cost as grumbling and workarounds instead of churn. Frequency-weight ruthlessly: the daily actions (task check-off, status change, logging hours, posting, moving cards) deserve KLM treatment; admin config screens don't.
- **Recurring operational flows are zero-click candidates:** anything on a schedule (payroll reminders, recurring tasks, syncs) should create itself; a human clicking to cause a predictable event is a design bug.
- **Training-facility front desk / coach tooling:** the top tasks are check-in, session logging, and next-appointment lookup, executed dozens of times daily on touch devices — thumb-zone Fitts placement and one-tap logging matter more than any dashboard.
- **Creator workflows:** publishing/clipping/scheduling pipelines are high-frequency and multi-step by nature — the promotion ladder (multi-screen → one screen → one action → automatic) is the roadmap, with bulk actions as the usual first big win.

---

## Sources

- Nielsen Norman Group — Interaction Cost: Definition — https://www.nngroup.com/articles/interaction-cost-definition/
- Nielsen Norman Group — The 3-Click Rule for Navigation Is False — https://www.nngroup.com/articles/3-click-rule/
- Nielsen Norman Group — Fitts's Law and Its Applications in UX — https://www.nngroup.com/articles/fitts-law/
- Nielsen Norman Group — Accelerators Maximize Efficiency in User Interfaces — https://www.nngroup.com/articles/ui-accelerators/
- Nielsen Norman Group — Flexibility and Efficiency of Use (Usability Heuristic #7) — https://www.nngroup.com/articles/flexibility-efficiency-heuristic/
- Nielsen Norman Group — Progressive Disclosure — https://www.nngroup.com/articles/progressive-disclosure/
- Wikipedia — Keystroke-level model (Card, Moran & Newell operator times, M-placement rules, accuracy) — https://en.wikipedia.org/wiki/Keystroke-level_model
- Kieras, D. — Using the Keystroke-Level Model to Estimate Execution Times — https://web.eecs.umich.edu/~kieras/docs/GOMS/KLM.pdf
- MeasuringU — How to Conduct a Top Task Analysis — https://measuringu.com/top-tasks/
- Gerry McGovern — Top Tasks: A How-To Guide — https://gerrymcgovern.com/books/top-tasks-a-how-to-guide/read-the-first-chapter/
- Superhuman — Why Superhuman Mail is built for speed: applying the 100ms rule to email — https://blog.superhuman.com/superhuman-is-built-for-speed/
- Center Centre / UIE — Testing the Three-Click Rule (Joshua Porter) — https://articles.centercentre.com/three_click_rule/
- rock paper scissors studio — Amazon One-Click Checkout: The UX Case Study That Revolutionized E-Commerce — https://rockpaperscissors.studio/amazon-one-click-checkout-the-ux-case-study-that-revolutionized-e-commerce/
- Duncan Jones — Case Study: How One Simple Change Increased Expedia's Revenue By $12 Million A Year — https://www.duncanjonesnz.com/case-study-expedias-12-million-a-year/
- Laws of UX — Fitts's Law / Hick's Law reference — https://lawsofux.com/fittss-law/
