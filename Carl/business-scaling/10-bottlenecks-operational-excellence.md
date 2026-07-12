---
title: "Bottlenecks & Operational Excellence (Theory of Constraints, Lean)"
domain: business-scaling
tags:
  - theory-of-constraints
  - lean
  - queue-theory
  - capacity-planning
  - throughput
  - flow-metrics
  - bottlenecks
sources_reviewed: 15
last_updated: 2026-07-12
---

# Bottlenecks & Operational Excellence

## TL;DR

- **Every system has exactly one binding constraint at a time.** Improving anything other than the constraint improves nothing — it just piles up inventory (or WIP, or drafts, or unedited footage) somewhere else. Goldratt compressed all of TOC into one word: *focus*.
- **Exploit before you elevate.** Most organizations run their actual constraint at under 50% of its capacity. Squeezing the existing bottleneck (protect its time, feed it a buffer, take non-constraint work off it) typically exposes 30%+ hidden capacity before you spend a dollar on new hires or equipment.
- **100% utilization is a bug, not a KPI.** Queue math is brutal: wait times grow non-linearly with utilization and go vertical past ~80%. A knowledge-work team where everyone is "fully booked" is mathematically guaranteed to be slow. Plan slack at the constraint's feeders; keep urgent-response resources under 50% loaded.
- **Little's Law is the one formula to memorize:** Cycle Time = WIP ÷ Throughput. If a content pipeline finishes 2 videos/week and has 12 videos in flight, every video takes ~6 weeks door-to-door regardless of how hard anyone works. Cutting WIP is the cheapest speed upgrade that exists.
- **In knowledge work the constraint is usually a person or a policy, not a machine** — often the founder (approvals, creative sign-off, on-camera time) or an invisible rule ("everything gets estimated," "the owner reviews everything"). Look for the biggest pile of waiting work; the constraint is immediately downstream of it.
- **Measure throughput dollars, not busyness.** Throughput accounting: T = revenue − truly variable costs; judge every decision by ΔT − ΔOE, not by whether it keeps people busy or lowers unit cost.
- **Batch size and handoffs are the silent killers of small teams.** Big batches (film 6 videos, then edit 6, then publish 6) delay feedback and multiply delay cost by queue length. Smaller batches + fewer handoffs beat working harder, essentially always.
- **The constraint moves.** After you fix one, re-run the five steps. The most dangerous failure mode is inertia — still optimizing last year's bottleneck.

---

## 1. Throughput thinking: the operating system

### The Goal's three measures (Goldratt)

Theory of Constraints replaces cost-world thinking with three system-level measures:

- **Throughput (T)** — the rate at which the system generates money through *sales* (not production, not output, not "content shipped to a folder"). T = Sales − Totally Variable Costs (TVC). For a media company TVC is small (contractor per-video fees, ad spend on a specific campaign); for a training facility it's near zero per additional client hour until you hit capacity.
- **Inventory / Investment (I)** — money tied up in things intended to be sold. In knowledge work: unfinished projects, filmed-but-unedited footage, signed-but-unstarted sponsor deliverables, half-built features. All of it is frozen cash and frozen attention.
- **Operating Expense (OE)** — money spent turning I into T: payroll, rent, software, utilities. Fixed-ish.

**Net Profit = T − OE.** Every proposed decision gets tested against three questions: does it increase T? decrease I? decrease OE? — *in that order of leverage*. T has no ceiling; OE cuts bottom out fast and often cut T with them.

### Throughput accounting vs. cost accounting

Traditional cost accounting allocates fixed costs to units and pushes managers to maximize utilization everywhere ("that editor costs $X/day, keep them busy"). Throughput accounting refuses to allocate: it's cash-focused. Consequences that matter for a small company:

- A "high-margin" product that consumes lots of constraint time can be worse than a "low-margin" one that barely touches the constraint. **Rank offerings by throughput per unit of constraint time** (T ÷ constraint-minutes), not by gross margin.
- Overtime, outsourcing, or a $2k tool that adds constraint capacity is evaluated purely on ΔT vs. ΔOE — if the constraint gates $10k/week of throughput, almost anything that adds constraint hours pays for itself.
- Efficiency gains at non-constraints are worth approximately **zero** in profit terms. They only matter if they free capacity you redeploy to the constraint or convert to lower OE.

**Carl's framing for clients:** "Stop asking 'how do we cut costs?' Start asking 'what limits how much we can sell and deliver this month, and what is one hour of that limit worth?'"

---

## 2. The Five Focusing Steps (POOGI)

Goldratt's Process Of On-Going Improvement. This is the master loop; everything else in this doc is technique inside one of these steps.

1. **IDENTIFY the constraint.** Find the weakest link. You cannot manage a constraint you haven't named. (Diagnostics in §3.)
2. **EXPLOIT the constraint.** Get the maximum out of it *as-is*: no capital, no hires. Protect it from interruptions, feed it only quality inputs, offload anything a non-constraint could do, never let it idle. TOC Institute's field data: most orgs run their constraint at **<50% of its real capacity** before exploitation.
3. **SUBORDINATE everything else.** Every other resource, policy, and schedule now serves the constraint's pace. This is the emotionally hard step: it means deliberately *not* maximizing non-constraints — letting people be "idle" rather than producing WIP the constraint can't absorb.
4. **ELEVATE the constraint.** Only now spend: hire, buy equipment, add a room, license a tool. TOC Institute warning: doing steps 2–3 properly typically exposes **≥30% hidden capacity within the first few months** — most planned elevations turn out unnecessary.
5. **GO BACK TO STEP 1 — beware inertia.** The constraint has moved. The rules, buffers, and habits you built for the old constraint are now potential policy constraints themselves.

### Exploit vs. elevate — the money question

Premature elevation is the most expensive TOC mistake in small companies: hiring a second editor while the first editor loses 40% of the week to unclear briefs, re-cuts from vague feedback, and asset-hunting. Exploitation checklist for a human constraint:

- [ ] Is the constraint ever waiting for inputs? (starvation)
- [ ] Is the constraint doing work someone cheaper/less-loaded could do?
- [ ] Is the constraint redoing work because of poor upstream quality? (defects hitting the constraint cost double — they burn constraint time twice)
- [ ] Is the constraint interrupted, meeting-ed, or context-switched?
- [ ] Is there a buffer of ready work in front of it so it never idles?
- [ ] Is the constraint working on the highest-throughput-per-hour work available?

Only when all six answer "no problem" is elevation justified.

### Types of constraints

- **Physical/resource:** a person, a machine, a room, camera time, cage/court hours, coach hours. Rarest kind in knowledge work but common in a facility.
- **Policy constraint:** a rule or habit — "founder approves everything," "we estimate every request," "we only publish Tuesdays," "one invoice run per month." Goldratt claimed most real constraints are policies. Cheapest to fix, hardest to see because they masquerade as "how we do things."
- **Market constraint:** you have more capacity than demand. The constraint is sales/marketing. Five steps still apply — exploit means maximizing conversion of existing demand, subordinate means the whole delivery org serves reliability/lead-time promises that win more demand.
- **Paradigm constraint:** beliefs ("we can't charge more," "the audience only wants X") that create policy constraints.

**Rule of thumb:** if adding people/equipment wouldn't obviously raise output, you're staring at a policy or market constraint, not a physical one.

### Drum-Buffer-Rope (DBR)

The TOC scheduling mechanism, translatable straight into knowledge work:

- **Drum:** the constraint sets the tempo. Its schedule *is* the company schedule. Everything releases work at the drum's pace.
- **Buffer:** a deliberate queue of ready work *in front of the constraint only* — sized in time, not units — so variability upstream never starves it. Everywhere else, buffers are waste; here, the buffer is sacred.
- **Rope:** a signal tying work release at the front of the pipeline to constraint consumption. New work enters only when the constraint pulls — this caps WIP mechanically instead of by willpower.

Published DBR implementation results (manufacturing studies): **WIP −30%, average wait time −25%, machine utilization +15%** vs. conventional scheduling — from *sequencing*, not new capacity.

---

## 3. TOC outside factories: finding the constraint in knowledge work

### Why it's harder than in a plant

In a factory the bottleneck announces itself: pallets stack up in front of a machine. In knowledge work, inventory is invisible — it lives in Notion, Drive folders, inboxes, and "I'll get to it" lists. Substitute signals:

1. **The pile test.** Where does work wait longest? Map the pipeline stages and count items sitting in each. The constraint is the stage immediately *after* the biggest pile.
2. **WIP aging.** For each in-flight item, how long has it been in its current stage? Cluster of ancient items in one column = constraint. Practitioner rule: compare item age against the 70th/85th percentile of historical cycle time; anything past the 85th percentile is at risk and its column is suspect.
3. **The "waiting on" census.** Ask everyone: "What are you waiting on right now, and from whom?" Tally the answers. The most-named person/step is your constraint candidate. (In founder-led companies the modal answer is the founder.)
4. **Wait-to-start vs. touch time.** For a few finished items, reconstruct the timeline: total elapsed days vs. days someone actively worked it. The gap lives in queues; find which queue owns most of it.
5. **The demand test.** If the answer to "why can't we ship 2x?" is "we couldn't sell it," constraint is the market, and the ops work is subordination (reliability, speed) in service of sales.

**Self-correcting property:** you don't need to be certain. Pick the best candidate, exploit it, and watch throughput. Feedback arrives in days-to-weeks: if you elevated upstream of the real constraint, WIP piles grow and throughput doesn't; if downstream, the elevated step starves. Wrong guesses are cheap and informative — hypothesis-driven action beats six weeks of process-mapping.

### Case study: Drum-Buffer-Rope at Microsoft (XIT Sustained Engineering)

The canonical proof that DBR works on pure knowledge work. Team maintained 80+ internal apps, ~85 change requests/quarter arriving, worst-performing unit in Q1 2005, backlog 500% over capacity.

**Diagnosis:** 3 developers completing only 17 requests/quarter. Upfront estimation consumed **40% of total capacity** (4 dev-hours + 4 test-hours per request), yet only ~50% of estimated work was ever attempted — so 15–20% of all capacity was spent estimating work that never happened. The constraint wasn't coding skill; it was *management policy*.

**Three interventions:**
1. **Buffer:** an 8-slot ready queue before development (the drum), ending monthly reprioritization thrash.
2. **Kill upfront estimates:** assume every change averages 5 days (viable only once the buffer smoothed flow).
3. **Rebalance:** moved one tester to dev (3:3 → 4:2).

**Results over 9 months:** throughput 17 → **56 requests/quarter** (+229%); lead time **5 months → 2 weeks**; on-time from ~0% → **90%+**; backlog 80 → <10; cost/request **$7,500 → $2,900**. Zero new headcount. Moral quoted from the case: *"management is the bottleneck to improving engineering."*

### Translating to a content pipeline (media company)

Typical YouTube-first pipeline: Idea → Research/Script → Shoot → Edit → Review → Thumbnail/Title → Publish → Promotion/Clipping. Benchmarks from creator-ops literature: a 10-minute high-quality video runs **15–20 hours of labor** and **$500–$2,000** all-in. Constraint patterns Carl should expect:

- **On-camera talent time** is often the true physical constraint (only the creator can shoot). Exploit: batch shoot days, everything else prepped to broadcast-ready before talent walks in, never burn talent hours on tasks others can do. Subordinate: scripts, sets, and thumbnails scheduled around shoot capacity, not vice versa.
- **Founder review/approval** is the classic policy constraint — edits waiting days for notes. Exploit: fixed daily review window, structured feedback templates, "approved unless flagged in 24h" defaults for low-risk items.
- **Editing** *looks* like the constraint (biggest visible queue) but frequently isn't — the queue in front of editing is often caused by vague briefs and re-cut loops (defect waste hitting a near-constraint). Fix input quality before hiring editor #2.
- **Ideation is almost never the constraint;** weak *pipelines* for ideas are. Ideas rot in random docs — that's inventory waste, not a creativity shortage.
- The buffer concept maps directly to a **publish buffer**: N finished videos banked ahead of schedule. Consistency failures are a buffer problem, not a discipline problem.

### Translating to a training facility (service business)

A baseball facility's candidate constraints, roughly in order of likelihood by lifecycle stage:

- **Pre-launch / early:** market constraint — empty cage hours. The whole system subordinates to demand generation (content flywheel, local partnerships, trial offers). Do not "exploit" coaches who have no clients.
- **Growing:** peak-hour cage/mound/space capacity (4–8pm weekdays, weekends). Exploit: scheduling density, off-peak pricing, semi-private formats that raise revenue per cage-hour. Throughput-per-constraint-minute logic: a 4-athlete small group at $40/head beats a $75 private in the same cage hour.
- **Mature:** star-coach hours. Exploit: leverage the star for assessments/programming/content while junior coaches deliver reps; productize the star's method so throughput isn't 1:1 with their calendar.
- **Perennial policy constraints:** booking friction, no-show policy, session-length defaults (60 min when 45 delivers the same value = 25% hidden capacity).

---

## 4. Lean waste in knowledge work

### The 8 wastes (TIMWOODS / DOWNTIME), translated

Taiichi Ohno's original 7 (Toyota Production System) + the Western 8th (unused talent). Knowledge-work manifestations:

| Waste | Factory meaning | Knowledge-work / creator-ops version |
|---|---|---|
| **T**ransport | Moving product around | Handoffs; files bouncing between Drive/Slack/email; exporting/re-importing between tools; "can you resend that?" |
| **I**nventory | Stockpiles | Filmed-but-unedited footage; idea backlogs nobody grooms; half-written scripts; signed sponsor deals not started; feature branches unmerged |
| **M**otion | Walking, reaching | Searching for assets; hunting the latest version; re-entering the same data in two systems; excessive clicks/tool-switching |
| **W**aiting | Idle machines/people | Waiting on approvals, feedback, uploads, renders, replies; the #1 waste in knowledge work by elapsed-time share |
| **O**verproduction | Making before it's needed | Content nobody asked for; reports nobody reads; features nobody uses; producing ahead of what the constraint can absorb |
| **O**ver-processing | More steps than the customer values | Polishing a v1 past the point the audience can perceive; multi-layer approvals; 4K workflows for platform-compressed shorts; meetings that could be a message |
| **D**efects | Rework/scrap | Re-cuts from vague briefs; re-shoots from missed checklist items; bugs; wrong-spec sponsor deliverables (these burn the constraint twice) |
| **S**kills (unused talent) | Ignoring worker knowledge | Editors never consulted on retention data; coaches with no input into programming; contractors treated as hands, not brains |

A ninth waste named for office/service contexts: **knowledge waste** — expertise, solutions, and lessons not captured or shared (the fix that lives in one person's head; the sponsor-negotiation playbook that leaves with the employee).

### TOC vs. Lean — when to reach for which

- **TOC:** targets the weakest link; act locally at the constraint; profit model = maximize T while minimizing I and OE. Best when a clear bottleneck exists and you need results in ~a quarter. Sequenced, surgical.
- **Lean:** eliminate waste and add value across the whole stream; profit = price − cost, grow it by removing waste. Best for cultural transformation, high process variation, and defining customer value. Broad, continuous.
- **Synthesis Carl should use:** run Lean's value-stream map to *see* the system, then apply TOC to decide *where* to act first. Waste at the constraint is catastrophic; waste elsewhere is merely annoying. De-waste the bottleneck, then work outward. (Lean Enterprise Institute's take: TOC slots neatly into the lean five-step change framework as the prioritization engine.)

---

## 5. Queue theory for operators (no hard math)

### Little's Law

**L = λW**, or in flow terms: **Average Cycle Time = Average WIP ÷ Average Throughput.** Holds for any stable system regardless of distribution. Uses:

- **Predict delivery:** 12 items in flight, 2 finished/week → new item entering today averages ~6 weeks to done. No estimation meeting required.
- **Set WIP limits:** a stage that completes 2 items/day with a 4-day in-stage time should cap at 8 items. More than that adds wait, not output.
- **Team-level heuristic:** healthy WIP ≈ number of active people ±1. Beyond that, cycle time and predictability degrade — every extra concurrent item is pure queue.
- **Expose the lie of "we're working on it":** starting work does nothing; only finishing moves T. Value is realized when the user receives something usable — not at kickoff, standup, or sprint planning.

### The utilization curve (M/M/1 intuition)

With variable arrivals and service times, mean queue length behaves like **ρ/(1−ρ)** (ρ = utilization). Wait time is *non-linear* in utilization:

- **50% utilization:** latency roughly 2× the no-load baseline. Fine.
- **80%:** the knee. Queue times start climbing steeply; small demand spikes hurt.
- **90–96%:** wait times are many multiples of service time (simulation example: ~20-second waits for tasks that take moments at 96%).
- **→100%:** wait approaches infinity. At full utilization the server never has slack to absorb a burst, so the queue grows without bound.

The same 10% demand spike that's invisible at 70% utilization is catastrophic at 90% — which is why backlogs "appear from nowhere" in busy teams. Reinertsen's jab: teams proudly run product development at 98.5% utilization and then wonder why everything takes forever.

### Kingman's formula (VUT): why variability is the third lever

Wait ≈ **V × U × T**: a Variability term × a Utilization term (ρ/(1−ρ)) × mean service Time. Implications:

- Two identical-capacity businesses differ wildly in wait time if one has lumpier demand or sloppier process variation. **Cutting variability lets you run higher utilization for the same wait.**
- Practical variability reducers: standardized briefs/checklists (service-time variance ↓), publishing cadence and booking windows (arrival variance ↓), triage classes so big jobs don't sit behind small ones.
- Guidance from capacity-management practice: treat **>80% planned utilization as a caution zone**; go above it only knowingly.

### Reinertsen: the economics of flow

From *The Principles of Product Development Flow* — the deepest treatment of queues in knowledge work:

- **Cost of Delay (CoD):** the money lost per unit time a piece of work is late. Only ~**15% of product developers can quantify their CoD**; without it, every "should we ship now or polish?" argument is opinion vs. opinion. For a creator business CoD is estimable: a video's expected first-month revenue + channel-momentum value per week of delay; a sponsor deliverable's contractual penalty/relationship cost.
- **Queue blindness:** only ~**2% of organizations measure their queues**, yet queues — not effort — dominate cycle time. Make queues visible (boards, aging reports) before optimizing anything.
- **Queue size multiplies delay cost:** a 5-minute delay to a queue of 20 jobs creates 100 job-minutes of delay; the same hiccup with 2 jobs queued costs 10. Long queues make every disruption expensive — another reason to cap WIP.
- **Batch size is U-shaped, not "smaller is always better":** total cost = transaction cost (falls with batch size) + holding/delay cost (rises with batch size). Reduce transaction costs (setup, publishing overhead, deploy friction) and the optimal batch shrinks. Big batches also create "death spirals": large projects attract scope and become too big to kill.
- **Cadence & fast feedback:** regular rhythms (weekly review, fixed shoot days, sprint cadence) cut coordination overhead and shrink feedback loops; Team New Zealand's two-boat side-by-side testing beat rivals' sequential testing by generating more information per cycle.
- **Single queue beats many:** one shared, sequenced intake outperforms per-person queues (per-person queues strand work behind whoever's busy).

### Flow metrics worth tracking (small-team set)

1. **Throughput** — items finished per week, by type. The drumbeat.
2. **Cycle time** — start-to-done per item; watch the 85th percentile, not the average.
3. **WIP** — total in-flight; hold near team size ±1.
4. **Work item age** — age of in-flight items vs. 70th/85th percentile historical cycle time; the leading indicator (cycle time is trailing — by the time it's bad, the damage is done).
5. **Flow efficiency** — touch time ÷ elapsed time. Knowledge-work teams measuring for the first time are routinely shocked to find it far below 40%, often under 15% — meaning the leverage is in queues, not in working faster.

### Backlog-recovery math (when you're already drowning)

Recovery capacity must exceed arrival rate, and the surplus is all that eats the backlog: **weeks to clear ≈ backlog ÷ (throughput − arrival rate)**. A team finishing 10/week with 10/week arriving and 80 queued will *never* clear it — surplus is zero. Options, in order: cut arrivals (say no, batch, raise prices), raise throughput *at the constraint*, or declare bankruptcy on the backlog (archive everything past an age threshold; genuinely important items come back).

---

## 6. Playbooks

### Playbook A: 90-minute constraint hunt (any small company)

1. **Draw the pipeline** left-to-right on a whiteboard: every stage from "request/idea" to "delivered/published/cash collected." Include approval steps — especially the invisible ones.
2. **Count WIP per stage** right now. Write the number under each stage.
3. **Age the WIP:** mark items sitting >2× typical stage time.
4. **Find the pile → name the constraint:** the stage after the biggest/oldest pile.
5. **Classify it:** person? equipment/space? policy? market? (If piles are small everywhere and people are idle-ish → market constraint; go fix sales.)
6. **Run the exploitation checklist** (§2) on it. List every hour the constraint loses to starvation, interruptions, rework, and delegable work.
7. **Pick 1–3 exploit moves, implement this week.** Set a throughput baseline (items/week) and re-measure in 2–4 weeks.
8. **Only then discuss hiring/spending.**

### Playbook B: install DBR on a content pipeline

1. **Declare the drum** (e.g., talent shoot capacity: 2 shoot-days/month → X videos/month max; or editor capacity). Publish the number.
2. **Build the buffer:** keep 2–4 *fully ready* items staged in front of the drum (scripts locked, assets pulled, locations booked). Buffer size = enough to cover the worst realistic upstream hiccup, no more.
3. **Tie the rope:** new projects enter production only when the drum consumes one. Everything else stays in a ranked ideas list — options, not commitments. (Ideas are cheap options; WIP is expensive inventory.)
4. **Subordinate the calendar:** review windows, thumbnail work, and sponsor integrations schedule around drum dates.
5. **Bank a publish buffer** downstream (2–4 finished pieces) so publishing cadence survives drum variability.
6. **Track drum utilization and buffer health weekly.** Buffer chronically full → drum is truly binding, consider elevating. Buffer chronically empty → constraint is upstream (scripting? decisions?); go back to step 1 of the five steps.

### Playbook C: capacity math for a service/facility business

1. **Theoretical capacity:** units of the scarce resource × operating hours (e.g., 4 cages × 6 peak hours × 6 days = 144 peak cage-hours/week).
2. **Effective capacity:** subtract cleaning/changeover, no-shows, scheduling fragmentation (15–30% typically vanishes here). This gap *is* your exploitation opportunity — attack changeover time and booking granularity before building cage #5.
3. **Demand profile:** bookings by hour-of-week. Constraint = the hours that sell out, not the weekly average. A facility at "60% overall utilization" can be hard-constrained 4–8pm.
4. **Throughput per constraint-hour:** rank every offering by revenue per peak-hour consumed. Shift low-T/hour uses (solo rentals, admin, lessons that could be off-peak) out of peak.
5. **Price the constraint:** peak/off-peak pricing is subordination via wallet.
6. **Elevate last:** more space/coaches only when steps 2–5 are exhausted and the buffer (waitlist) is persistent.

### Playbook D: weekly ops review agenda (20 minutes)

1. Throughput last week vs. trailing 4-week average — by pipeline.
2. Oldest 3 in-flight items — why are they stuck, who unblocks them today?
3. WIP count vs. limit — over? nothing new starts this week.
4. Constraint health — did the drum idle? why? buffer status?
5. One waste to kill this week (rotate through the 8 categories).

---

## 7. Common mistakes

1. **Optimizing non-constraints and calling it progress.** New gear for a stage with idle capacity, speed-ups upstream of the bottleneck — output unchanged, WIP up, money gone. *Full utilization of a non-constraint never improves the system optimum.*
2. **The 100%-busy fetish.** Managers demand everyone look loaded; queue math guarantees the result is glacial cycle times and fragile response to spikes. Slack at non-constraints is a feature. Judging people by busyness *creates* overproduction waste.
3. **Elevating before exploiting.** Hiring editor #2 while editor #1 loses 40% of the week to bad briefs and rework. Remember: proper exploit/subordinate typically finds ≥30% hidden capacity.
4. **Treating symptoms as constraints.** The biggest queue sits *in front of* the constraint — the constraint is the next stage, and the queue may itself be caused by defects/rework flowing into it. Fix input quality before capacity.
5. **Missing policy constraints.** Searching for an overloaded person when the real limiter is "founder approves everything," "we estimate all work up front" (Microsoft's 40%-of-capacity estimation tax), or "we only invoice monthly."
6. **No cost of delay → politics decides priority.** Loudest stakeholder wins; expedites shred flow. Even crude CoD numbers ($/week late) end most prioritization fights.
7. **Big batches for "efficiency."** Batch-of-6 filming/editing/publishing feels efficient, but delays feedback by weeks and multiplies delay cost by queue length. Shrink transaction costs, then shrink batches.
8. **Averages instead of percentiles/variability.** Planning to average cycle time and average demand guarantees missed commitments — Kingman says variability, not just load, sets your waits. Watch 85th percentiles and tails.
9. **Inertia after a fix.** The buffer rules, staffing ratios, and approval flows built for the old constraint quietly become the new constraint. Re-run step 1 quarterly.
10. **Local metrics that fight global flow.** Per-person utilization targets, per-department cost KPIs, "videos edited" instead of "videos published and performing." Individually optimizing each part severely under-optimizes the whole.
11. **Infinite-queue denial.** Accepting every request/booking/sponsor deal with no WIP cap or intake policy. Queues must be bounded deliberately, or reality bounds them with burnout and missed deadlines.
12. **Confusing motion with throughput.** Starting projects, holding meetings, "making progress" — T only moves when something reaches the customer/audience and cash follows.

---

## 8. Questions Carl should ask a client

**Finding the constraint**
- "If demand doubled tomorrow, what breaks first?" (Fast constraint locator.)
- "Where does work wait the longest right now? Show me the oldest three in-flight items."
- "What is everyone waiting on, and from whom?" (If one name dominates — often the founder — that's the constraint.)
- "Could you sell twice as much if you could deliver it?" (No → market constraint; ops work changes character entirely.)

**Exploit/subordinate**
- "What percentage of your bottleneck's week goes to things only they can do?"
- "How often does the constraint sit idle waiting for inputs, decisions, or fixes to upstream mistakes?"
- "What rule, if deleted today, would speed everything up?" (Hunts policy constraints.)
- "What are you doing to keep non-bottleneck people busy that just creates piles?"

**Flow & queues**
- "How many things are in flight right now? How many people do you have?" (WIP ≫ headcount = red flag.)
- "How long from 'we decided to do this' to 'the customer/audience has it' — and how much of that was actual work time?" (Flow efficiency; expect shock.)
- "What does one week of delay on your most important project cost you, in dollars?" (CoD literacy test — 85% can't answer.)
- "What's your planned utilization for the people who handle urgent work?" (>80% = built-to-be-slow.)

**Batch & buffer**
- "What's your batch size for [filming / releases / invoicing / programming], and why that number?"
- "How many finished-but-unpublished pieces do you have banked? What happens to your cadence when a shoot falls through?"
- "What's the transaction cost of publishing/shipping one unit, and what would halving it enable?"

**Money**
- "Rank your offerings by profit per hour of your scarcest resource — not by margin. Ever done that math?"
- "This proposed hire/purchase: how many extra units of throughput per month, worth how much, against what added OE?"

**Inertia**
- "When did you last check whether your bottleneck is still the bottleneck?"
- "Which of your current processes were built for a problem you no longer have?"

---

## 9. Quick-reference numbers

| Fact | Value | Source context |
|---|---|---|
| Wait-time knee in utilization curve | ~80%; latency 2× baseline at 50%; →∞ at 100% | M/M/1 queue models, simulations |
| Typical constraint utilization before exploitation | <50% of true capacity | TOC Institute field data |
| Hidden capacity exposed by exploit+subordinate | ≥30% in first months | TOC Institute |
| DBR implementation effects (mfg studies) | WIP −30%, wait −25%, utilization +15% | DBR literature |
| Microsoft XIT DBR case | Throughput +229% (17→56/qtr), lead time 5 mo→2 wks, cost/request $7,500→$2,900, 9 months, no new headcount | Forte Labs case study |
| Estimation overhead in that case | 40% of capacity; 15–20% wasted on never-done work | Same |
| Developers who know their cost of delay | ~15% | Reinertsen |
| Organizations that measure queues | ~2% | Reinertsen |
| Healthy team WIP | ≈ active people ±1 | Kanban practice |
| At-risk work item age | > 85th percentile of historical cycle time | Flow-metrics practice |
| Cost of a 10-min high-quality YouTube video | 15–20 labor hours, $500–$2,000 | Creator-ops benchmarks |
| Little's Law | Cycle time = WIP ÷ Throughput | Little (1961) |

---

## Sources

- Theory of Constraints Institute — Five Focusing Steps (POOGI): https://www.tocinstitute.org/five-focusing-steps.html
- Tiago Forte, "Theory of Constraints 107: Identifying the Constraint" (Forte Labs): https://fortelabs.com/blog/theory-of-constraints-107-identifying-the-constraint/
- Tiago Forte, "Theory of Constraints 105: Drum-Buffer-Rope at Microsoft" (Praxis/Medium): https://medium.com/praxis-blog/theory-of-constraints-105-drum-buffer-rope-at-microsoft-fda187c6d1d9
- Tiago Forte, "Theory of Constraints 102: The Illusion of Local Optima" (Forte Labs): https://fortelabs.com/blog/theory-of-constraints-102-local-optima/
- Lean Enterprise Institute — "What is the Theory of Constraints, and How Does it Compare to Lean Thinking?": https://www.lean.org/the-lean-post/articles/what-is-the-theory-of-constraints-and-how-does-it-compare-to-lean-thinking/
- The Lean Way — "The 8 Wastes of Lean": https://theleanway.net/The-8-Wastes-of-Lean
- TXM — "The Ninth Waste in the Lean Office (and TIMWOOD)": https://txm.com/the-ninth-waste-in-the-lean-office/
- Erik Bernhardsson — "Waiting time, load factor, and queueing theory": https://erikbern.com/2018/03/27/waiting-time-load-factor-and-queueing-theory.html
- Dan Slimmon — "The most important thing to understand about queues": https://blog.danslimmon.com/2016/08/26/the-most-important-thing-to-understand-about-queues/
- Rowtons Training — "Understanding the Kingman Formula in Capacity Management": https://rowtonstraining.com/kingman-formula-in-capacity-planing-management/
- Eric Ries, "Lessons Learned: The Principles of Product Development Flow" (on Reinertsen): http://www.startuplessonslearned.com/2009/07/principles-of-product-development-flow.html
- Wikipedia — Throughput accounting: https://en.wikipedia.org/wiki/Throughput_accounting
- InfoQ — "The Mathematics of Backlogs: Capacity Planning for Queue Recovery": https://www.infoq.com/articles/capacity-planning-queue-recovery/
- Kanban Tool — "Queuing Theory & Kanban": https://kanbantool.com/kanban-guide/queuing-theory
- Scrum.org — "4 Key Flow Metrics and How to Use Them": https://www.scrum.org/resources/blog/4-key-flow-metrics-and-how-use-them-scrums-events
