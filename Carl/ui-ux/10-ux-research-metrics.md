---
title: "Lightweight UX Research & UX Metrics"
domain: ui-ux
tags:
  - ux-metrics
  - usability-testing
  - heart-framework
  - sus
  - product-analytics
  - ux-debt
  - dogfooding
sources_reviewed: 13
last_updated: 2026-07-12
---

# Lightweight UX Research & UX Metrics

Reference for measuring UX with a team of 1-5 people and near-zero research budget. The core thesis: small teams don't need a research department — they need three cheap habits (watch 5 users, ask one question after each task, instrument 5-10 events) run on a regular cadence, plus one prioritization ritual (frequency × severity) so findings actually get fixed.

## TL;DR

- **Test with 5 users, iterate, repeat.** Five users surface ~85% of usability problems in a design (Nielsen/Landauer model, L≈31% per user). Three rounds of 5 beat one round of 15 — redesign between rounds.
- **The starter metric trio: task success rate, time-on-task, SEQ.** Average task completion across products is ~78%; average SEQ is ~5.5/7. Below those numbers, you have a findable problem.
- **SUS is the cheapest credible "overall usability" score.** 10 questions, 0-100 scale, average = 68 (the 50th percentile, NOT a percentage). 80+ is top-10%. Stable enough at 8-12 respondents for decisions.
- **Use HEART + Goals→Signals→Metrics to pick metrics, not to add dashboards.** Choose 2-3 of the five categories that match what you're actually trying to change; write the goal in one sentence before naming any number.
- **Instrument 5-10 critical events, not everything.** Tracking everything creates data debt. One funnel (signup→activation→habit) and one retention curve answer most questions a small team has. Activation is the strongest predictor of retention.
- **Dogfooding finds quality bugs, not desirability truth.** Your own team is a biased sample on fast machines who already know the UI. Pair internal use with even one real-user session per week (Torres's continuous-discovery minimum).
- **Prioritize UX debt by frequency × severity.** Rate severity on Nielsen's 0-4 scale, count how many users hit the issue, plot value-vs-effort, then reserve 1-2 backlog items per sprint for debt so the list doesn't just grow.
- **Qual finds problems; quant sizes them.** Numeric data from 5 users should not drive decisions — 5 users is for *watching*, 20-30+ is for *measuring*.

---

## 1. Measurement philosophy for small teams

Big-company UX research answers "is this statistically better?" Small-team UX research answers "what is broken and what do I fix first?" These need different machinery.

- **Formative vs. summative.** Formative research (watch people, find problems, fix them) needs tiny samples and high frequency. Summative research (score the product, compare over time) needs bigger samples and standard instruments. Most small-team value is formative; run summative measures (SUS, funnel conversion) quarterly as a health check, not weekly.
- **Discount usability (Nielsen, 1989-).** The founding argument: cheap, fast, frequent studies (5-user tests, paper prototypes, heuristic evaluation) produce more design improvement per dollar than rare, elaborate studies. Thirty-plus years of evidence supports it. The real goal is to improve the design, not document its weaknesses.
- **The trap for internal tools** (like Mayday Studio): the builder is also the primary user, so "research" degrades into "I noticed it annoyed me." That catches builder-path friction and misses everything on the paths the builder doesn't take (contractor portal, agency portal, mobile). The fix is structural: watch the *other* roles use the tool, on their machines, doing their real tasks.
- **Behavior beats opinion.** What users do (task success, drop-off, repeated visits) is more trustworthy than what they say (survey answers, feature requests). Use attitudinal data (SUS, SEQ, comments) to explain behavioral data, not replace it.

---

## 2. Task-level metrics: the working trio

These three are measurable in any moderated session or unmoderated test with zero special tooling — a stopwatch and a tally sheet suffice.

### Task success rate (effectiveness)
- **Definition:** users who complete a task ÷ users who attempt it. Decide *before* the session what counts as success (binary is fine; "partial success" levels add nuance but cost consistency).
- **Benchmark:** average completion rate across products is **~78%** (Sauro/MeasuringU, across hundreds of tasks). A core task below ~70% is a red flag; below 50% is a fire.
- **Gotchas:** define the task without leading language ("Find where you'd change your payment method," not "Go to Settings and click Payment"). Don't rescue struggling participants — a rescue is a failure.

### Time-on-task (efficiency)
- **Definition:** elapsed time from task start to success (usually reported only for successful attempts; report failures separately).
- **Use:** best as a *relative* measure — this release vs. last, expert vs. novice, your flow vs. a competitor's. Absolute times mean little without context.
- **Reporting:** task times are right-skewed; use the **median** (or geometric mean), never the arithmetic mean, at small n.

### Error rate (diagnostics)
- **Definition:** count of wrong turns, wrong clicks, or error states per task attempt. Optional at first; add it when you need to know *why* success is low.

### Single Ease Question — SEQ (perceived ease)
- One question, asked **immediately after each task**: "Overall, how difficult or easy was this task to complete?" 1 (very difficult) to 7 (very easy).
- **Benchmark:** average SEQ across 400+ tasks / ~10,000 users is **~5.5** (MeasuringU found 5.3-5.6).
- **SEQ predicts hard outcomes** (MeasuringU regression across 286 tasks): correlates r = .66 with completion rate and r = -.53 with task time. Rules of thumb:
  - SEQ ≈ **4.7** → ~58% completion (bottom 30th percentile — bad)
  - SEQ ≈ **5.9** → ~86% completion (top 30th percentile — good)
  - SEQ ≈ **6.3** → ~90% completion; above ~5.9 completion plateaus near 90%
- **Why Carl loves it:** it costs 5 seconds per task, works in unmoderated tests, and a below-5 score tells you exactly *which task* to go watch someone do.

---

## 3. Standardized questionnaires

### System Usability Scale (SUS)
The default "overall usability" instrument. 10 alternating positive/negative statements, 5-point agreement scale, administered **after the whole session** (not per task).

- **Scoring:** odd items score (response − 1), even items score (5 − response); sum × 2.5 → 0-100. **The score is not a percentage.** A 68 is not "68% good."
- **Benchmarks (MeasuringU / NN/g):**
  - Average across studies: **68** = 50th percentile
  - **73+** ≈ top 30% (roughly a "B")
  - **80+** ≈ top 10% (an "A"; also the approximate threshold where users start recommending the product)
  - Below ~51 ≈ bottom 15% ("F")
- **Small-sample robustness:** unusually forgiving — at n=5 the score lands within ~6 points of the true score about half the time; 8-12 respondents give decision-grade stability; Tullis & Stetson found 12-14 enough for tight confidence intervals. Sample means stay bell-shaped even at small n, so ordinary stats work.
- **Two dimensions hidden inside:** items 4 and 10 form a **learnability** sub-scale (usually scores higher than the other 8 "usability" items). Worth splitting out when onboarding is the question.
- **Limits:** SUS was never diagnostic — it tells you *that* usability is bad, never *what* to fix. Pair it with observation.
- **Known error source:** 11-17% of researchers mis-score the reversed items. Use a spreadsheet formula once, verify it once, reuse forever.

### UMUX-Lite (mention-worthy alternative)
Two items ("This system's capabilities meet my requirements" / "This system is easy to use"), correlates highly with SUS. Use when 10 questions is too many — e.g., an in-app intercept.

### NASA-TLX
Six 21-point workload dimensions (mental demand, physical demand, temporal demand, performance, effort, frustration). Overkill for consumer/business apps; appropriate for high-consequence, high-load workflows (medical, aerospace, live-production control rooms). For a creator-ops tool, the only defensible use is a genuinely stressful real-time surface (e.g., a live-show teleprompter/switcher workflow).

### NPS caveat
NPS correlates strongly with SUS and is cheaper (one question), but it measures loyalty sentiment, not usability, and is noisy at small n. For an internal tool with 10 users, NPS is theater. Skip it.

### Sample-size rule that resolves the apparent contradiction
- **5 users** → qualitative problem-finding (watch and listen). Do not average their numbers into a KPI.
- **20-30+ users** → quantitative claims (SUS deltas, completion-rate comparisons, A/B). NN/g is explicit: numeric data from 5 users should not inform design decisions.
- SUS is the partial exception (usable at 8-12); everything else quantitative needs the bigger n.

---

## 4. HEART framework + Goals → Signals → Metrics

Developed by Kerry Rodden, Hilary Hutchinson, and Xin Fu at Google (CHI 2010, "Measuring the User Experience on a Large Scale"). Its purpose, per Rodden, was never five more dashboard numbers — it's a **vocabulary for choosing the right metric for the question you're actually asking**.

### The five categories
| Category | What it measures | Example metrics |
|---|---|---|
| **Happiness** | Attitude/satisfaction | SUS, SEQ, CSAT, in-app rating, survey verbatims |
| **Engagement** | Depth/frequency of voluntary use | Sessions per user per week, actions per session, content created |
| **Adoption** | New users/feature uptake | % of accounts using feature X within 30 days of launch, signups |
| **Retention** | Do they come back | Week-4 retention, churn rate, resurrection rate |
| **Task success** | Effectiveness/efficiency | Completion rate, time-on-task, error rate, funnel conversion |

### How to use it (the actual method)
1. **Pick 2-3 categories that matter for this product/feature.** Not all five. Engagement is meaningless for a tool people are required to use for work (an internal ops app) — there, Task Success and Happiness carry the weight. Retention is meaningless for a one-shot flow.
2. For each chosen category, run **Goals → Signals → Metrics**:
   - **Goal:** one sentence describing what success looks like *for the user* ("Contractors can log hours in under a minute without asking anyone").
   - **Signals:** observable behaviors or attitudes indicating the goal is met/missed (hours logged on time; Slack DMs asking how to log hours).
   - **Metrics:** the precise trackable number per signal (% of contractors with hours submitted by deadline; support-question count per pay period).
3. **Write goals before looking at what's easy to track.** The classic failure mode is reverse-engineering goals from whatever the analytics tool already shows.

### Common misuses
- Instrumenting all five categories "for completeness" → dashboard nobody reads.
- Using Engagement metrics on captive/internal users (they're forced to engage; the number can't fall, so it can't inform).
- Skipping Signals and jumping Goal→Metric, which produces metrics with no causal story.

---

## 5. Five-user testing: the math and the playbook

### The model (Nielsen & Landauer)
Problems found with n users = **N(1 − (1 − L)^n)** where N = total problems, L = share found per user. Empirically **L ≈ 31%** across projects. So:
- 1 user → ~31% of problems
- 5 users → ~85%
- 15 users → ~100%
- The first users find the *most serious* problems; each added user finds mostly repeats.

### Why 3 × 5 beats 1 × 15
Spend the same budget on **three studies of 5**, redesigning between rounds. Round 2 verifies the fixes actually worked (fixes often don't, or introduce new problems) and probes deeper layers (IA, task flow) once surface problems stop masking them. One 15-user study documents weaknesses; three 5-user studies improve the design.

### Exceptions to "5 is enough"
- **Quantitative benchmarking:** ~20 users minimum.
- **Card sorting:** ~15 users.
- **Multiple distinct user groups:** 3-4 users per group for two groups; ~3 per group for three or more. "Distinct" means genuinely different behavior/tasks — admin vs. contractor vs. agency partner, not marketing-persona differences. For Mayday Studio, admin, freelancer, and agency roles are three real groups: 3 users each ≈ 9-user rounds when testing cross-role surfaces.
- **Eyetracking / desirability studies:** larger samples; out of scope for small teams anyway.

### Lean moderated test — step-by-step (60-90 min total prep, ~30 min per session)
1. **Pick 3-5 tasks** on the flow you're worried about. Write scenario prompts without UI words ("You just finished a shoot and need to hand off the footage" — not "Click Submit Files").
2. **Recruit 5 people** who resemble real users. For internal tools: the actual users, minus the person who built it. For external products: hallway/community/customer-list recruits; incentives of $50-100 for 30-45 min are typical (User Interviews' own study paid $85).
3. **Run it:** think-aloud protocol; you say almost nothing ("What are you looking at? What did you expect to happen?"). Never explain the UI. Record if allowed.
4. **After each task:** SEQ. **After the session:** SUS if you want a tracking score.
5. **Log per task:** success (Y/N), time, errors/wrong turns, SEQ, quotes.
6. **Same-day debrief (30 min):** list every observed problem, one line each. No solutions yet.
7. **Rate severity × frequency** (Section 8), pick fixes, fix, schedule round 2.

Unmoderated variant: tools like Maze/Lyssna/UserTesting run the same tasks async and auto-capture success/time/SEQ — trade richness for volume and speed.

---

## 6. Continuous discovery: the cadence habit

Teresa Torres's definition (Continuous Discovery Habits): **"at a minimum, weekly touchpoints with customers, by the team building the product, conducting small research activities in pursuit of a desired product outcome."**

Key points for a small team:
- **Weekly ≠ weekly studies.** One 20-30 minute conversation or observation per week is the bar. Small, consistent loops beat big, rare projects.
- **The trio does it themselves.** PM/designer/engineer (or, in a tiny company, founder/builder) attend and take notes — no insight middlemen. Insights received secondhand don't change minds.
- **The classic failure:** treating discovery as a project phase — 10 interviews at kickoff, then never again. Most teams that try continuous discovery struggle to sustain it (Torres's own observation); the antidote is automating recruitment (standing calendar link, in-app intercept, advisory panel of repeat users) so each week's session costs ~zero setup.
- **What practitioners actually do** (User Interviews field study, 2023): weekly-to-monthly cadence; recruitment is the #1 pain ("a big headache," "scraping the bottom of the barrel" for niche audiences); synthesis is kept deliberately light — quick post-session debriefs, shared Notion/Slack notes, no fancy reports.
- **Interview craft in one line:** ask about specific past behavior ("Walk me through the last time you…"), never about hypotheticals or preferences ("Would you use…?"). People are unreliable predictors and reliable narrators.

---

## 7. Instrumentation: clicks, funnels, and the tracking plan

### Start narrow — the 5-10 critical events rule
The common failure is tracking everything, then drowning. Instead (Amplitude's guidance, matches Mixpanel/Posthog doctrine):
1. **Define 5-10 critical events** tied to core value. Example for a project-management-ish tool: `project_created`, `teammate_invited`, `first_task_completed`, `plan_upgraded`. For each event, 2-5 properties (who, which entity, from what surface).
2. **Write a tracking plan first** — a one-page doc standardizing event names and properties *before* code. Skipping this creates **data debt**: inconsistent names, duplicate events, missing properties that quietly make every later analysis wrong. Pick one naming convention (e.g., `object_verb` in snake_case) and never deviate.
3. **Instrument** via SDK or autocapture. Autocapture is a safety net, not a plan — you still need named critical events.
4. **Build one lifecycle view:** acquisition → activation → engagement → retention → monetization, with conversion between stages.

### The two analyses that pay the bills
- **Funnel analysis:** conversion through a defined multi-step flow; answers "where do users drop off?" One well-chosen funnel (e.g., signup → key setup action → first value moment) beats ten speculative ones.
- **Retention/cohort analysis:** do users come back, by signup cohort? Amplitude's cross-product finding: **activation is the strongest predictor of retention** — 69% of top performers in 7-day activation were also top performers in 3-month retention; a 7% day-7 return rate is already top-quartile for many product categories. Translation: fix the first-session experience before optimizing anything downstream.
- Add path analysis/segmentation later, only when a funnel raises a "why."

### North Star discipline
One metric that captures delivered value ("messages sent per week," "hours logged on time," "briefs approved per month"), with the funnel metrics as leading indicators underneath. For a B2B/PLG product, revenue is the outcome; activation/adoption are the levers. The point is alignment, not the specific choice.

### DIY instrumentation without a vendor
For a Supabase-style stack, a single `events` table (`user_id, event_name, properties jsonb, created_at`) plus a `track()` helper covers 80% of small-team needs; funnels are `WITH` queries; retention is a cohort self-join. Vendor tools (PostHog, Amplitude free tier, Plausible for web) buy you dashboards and session replay, not fundamentally different data. For an internal tool with <50 users, the SQL route is usually enough and keeps data where the app already lives.

### Privacy hygiene
Don't put PII in event properties; use IDs. Decide retention windows up front. For client-facing portals (agency/contractor), disclose analytics in terms of service.

---

## 8. Prioritizing UX debt: frequency × severity

### What UX debt is
NN/g: experience problems created by expedient or careless decisions shipped to hit deadlines — the UX twin of technical debt, compounding over time and costlier to fix retroactively. It shows up in UI polish, interaction design, copy, IA, accessibility, and cross-journey consistency (e.g., NN/g's Amazon example: a returns page showing "Returning 2 items" beside "Refund subtotal for 3 items" — an inconsistency that erodes trust beyond its surface size).

### Severity scales
**Nielsen's 0-4** (the default):
- 0 — not a problem
- 1 — cosmetic; fix only if spare time
- 2 — minor; low priority
- 3 — major; high priority
- 4 — usability catastrophe; imperative to fix before release

**Rubin's alternative** (capability-framed): 4 unusable / 3 severe / 2 moderate workaround / 1 irritant. MeasuringU's practical advice: **three buckets are enough**; expect rater disagreement even with clear definitions, so if possible average two independent raters, and rate severity *blind to frequency* (severity = impact when hit; frequency = how often it's hit — keep them separate, then combine).

### Frequency
users who encounter the problem ÷ users observed (or, from instrumentation: sessions hitting the error/abandon state ÷ sessions entering the flow). This is where 5-user tests and funnels meet: the test finds the problem, the funnel sizes it.

### The scoring sheet (NN/g-style, one spreadsheet)
Columns per issue: description of user impact • journey stage • **frequency** • **severity (0-4)** • source (user test, support ticket, teammate, analytics) • effort (S/M/L). Priority score = frequency × severity (weight by journey criticality if needed — a checkout bug outranks an equally-scored settings bug). Then plot **user value vs. effort** as a scatter: high-value/low-effort first; high-value/high-effort scheduled; low-value/high-effort declined explicitly (a written "no" prevents the item haunting the backlog).

Richer six-factor variant when stakes are higher: user impact, business impact, frequency, risk-if-unfixed, effort, cost of delay.

### Making fixes actually happen (the part most teams skip)
- **Standing allocation:** reserve capacity every sprint — 1-2 debt items minimum alongside feature work (NN/g). Debt handled "when we have time" is debt handled never.
- **Periodic purges:** quarterly debt sprint or a monthly "cheese day" (one day, everyone fixes small annoyances).
- **Review debt in planning, together** — so debt competes with features on merit, not by default losing.
- NN/g's framing worth quoting to any founder: *"Fixing something that doesn't work for users has the same effect as adding a new feature, in terms of what customers actually get to use."*

---

## 9. Dogfooding discipline

Dogfooding (using your own product internally) is the default research method for internal tools and small products — powerful and systematically biased.

### What it's good at / bad at
- **Good:** quality, polish, workflow friction, catching regressions fast, building team empathy and alignment.
- **Bad:** desirability, learnability, and reach. Insiders already know where everything is (can't detect learnability problems), run fast machines (Microsoft's classic lesson: engineers on top-spec hardware missed performance problems ordinary users hit daily), and are not a representative sample of outsiders. Dogfooding validates that the product *works*; it cannot validate that anyone *wants* it or can *learn* it.

### Discipline that separates useful dogfooding from vibes
1. **A frictionless report channel** — one Slack channel or in-app button; if reporting friction costs more than 20 seconds, people stop.
2. **Treat internal reports like customer reports:** tag by category, link each to a backlog item with an owner, and make cycle time visible. Feedback that visibly goes nowhere trains people to stop giving it.
3. **Onboard internal users like real users** — docs, no shoulder-tap setup help — or you'll never see the onboarding gaps.
4. **Dogfood on representative conditions:** the old laptop, the phone, the spotty Wi-Fi, the non-admin role. Role-switching matters most: the builder using only the admin view learns nothing about the contractor view.
5. **Pair it with outsiders:** modern best practice is dogfood for quality + interview real users for desirability, continuously (Section 6). For Mayday Studio specifically: Trevor using the app daily is dogfooding; watching a freelancer or the agency partner use their portal cold is the missing half. For Neptune Performance: staff using the booking/training system is dogfooding; watching a parent book a first session is the real test.

---

## 10. Benchmarks cheat sheet

| Metric | Average / threshold | Source |
|---|---|---|
| Task completion rate | ~78% average across products | MeasuringU |
| SEQ (post-task ease, 1-7) | ~5.5 average; <4.7 bad (≈58% completion), >5.9 good (≈86%+) | MeasuringU |
| SUS (0-100) | 68 = 50th %ile; 73+ ≈ top 30%; 80+ ≈ top 10%; <51 ≈ bottom 15% | MeasuringU / NN/g |
| Problems found per test user | ~31% (L in Nielsen-Landauer model) | NN/g |
| Users to find ~85% of problems | 5 | NN/g |
| Quantitative study minimum n | ~20 (card sorting ~15) | NN/g |
| SUS decision-grade n | 8-14 respondents | Brooke; Tullis & Stetson |
| Day-7 return rate, top quartile | ~7%+ (varies by category) | Amplitude |
| Activation → retention link | 69% of top 7-day-activation performers also top 3-month retention | Amplitude |
| Continuous discovery cadence | ≥1 customer touchpoint/week | Torres |
| Critical events to instrument first | 5-10 | Amplitude |
| Sprint UX-debt allocation | 1-2 items/sprint minimum | NN/g |

Treat cross-industry averages as sanity anchors, not targets — your own trend line (this quarter vs. last, on the same tasks) is always the more decision-relevant comparison.

---

## 11. The small-team measurement operating system (Carl's default prescription)

**Weekly (≈1 hour):** one continuous-discovery touchpoint — watch one real user do one real task, or one 30-min interview about a recent specific experience. Rotating owner; notes in a shared doc; 10-min debrief.

**Per release of anything user-facing:** 3-5 task, 5-user hallway test on the changed flow, SEQ per task. Fix severity-3+ before shipping wide.

**Always-on:** 5-10 instrumented critical events; one activation funnel; one retention curve; error/abandon events on the money flows. Review 15 minutes weekly — look for step-over-step drop-offs >30% and week-over-week deltas, not absolute values.

**Monthly:** UX-debt triage — new items into the frequency × severity sheet, re-plot value/effort, commit 1-2 items into the next cycle.

**Quarterly:** summative check — SUS to the whole user base (internal tool: every user; product: sample of 20-30), compare to last quarter, and re-run the Goals→Signals→Metrics sheet to retire dead metrics.

Total steady-state cost: roughly half a day per week for one person. That's the entire research function a company under ~20 people needs.

---

## 12. Common mistakes

- **Running one big study instead of many small ones.** Documenting 100% of problems once loses to fixing 85% of them three times.
- **Averaging metrics from 5 users.** n=5 is for finding problems, not for claiming "completion improved 12%." Small-n numbers wobble wildly; only SUS is semi-trustworthy small.
- **Treating SUS as a percentage or as diagnostic.** 68 is average, not "D+"; and a low score names no fix — go watch someone.
- **Mis-scoring SUS reversed items** (11-17% of practitioners do). Build the formula once, verify against a known example.
- **Asking hypothetical questions.** "Would you use X?" produces polite fiction. Ask about the last time they actually did the thing.
- **Leading task prompts.** Naming the button in the scenario tests reading, not the interface.
- **Rescuing participants mid-task**, then recording success.
- **Tracking everything.** Autocapture-everything with no tracking plan = data debt: duplicate events, drifting names, analyses nobody trusts.
- **Reverse-engineering goals from available metrics.** HEART done backwards. Goal sentence first, always.
- **Measuring Engagement on captive users.** Internal/required tools: engagement can't drop, so it can't inform. Measure Task Success and Happiness instead.
- **Dogfooding as the only research.** Insider bias hides learnability, performance-on-normal-hardware, and every non-builder role's pain.
- **Collecting feedback without a closing loop.** Reports with no owner, no backlog link, no visible outcome train users (internal or external) into silence.
- **Discovery as a phase.** Ten interviews at kickoff, zero after launch — the most common pattern and the most fatal.
- **Severity ratings contaminated by frequency** (or by who reported it). Rate impact-when-hit separately from how-often-hit; combine afterward.
- **UX debt with no standing capacity.** A prioritized list with zero sprint allocation is a graveyard with good metadata.
- **NPS on a 10-user internal tool.** Statistical theater; a hallway conversation carries more information.

---

## 13. Questions Carl should ask a client

**Diagnosing current state**
1. "When did someone on the team last *watch* a real user complete a real task, start to finish, without helping?" (If >1 month: no research function exists, whatever the dashboards say.)
2. "What's your task success rate on your single most important flow — and is that a measured number or a feeling?"
3. "If I asked three people on your team what the product's #1 usability problem is, would I get the same answer?" (Divergence = no shared evidence base.)
4. "Which 5-10 events are instrumented, and who looks at them weekly?" (Answers of 'everything' and 'nobody' usually travel together.)
5. "Show me your activation funnel. Where's the biggest drop-off, and what have you tried against it?"

**Prioritization & debt**
6. "Where does a UX complaint go when a user reports it — and can you show me one that got fixed and how long it took?"
7. "How do you decide between a new feature and fixing something broken? Is any sprint capacity reserved for debt?"
8. "Which known issue has the highest frequency × severity right now? If you can't rank them, what would ranking them cost you — an afternoon?"

**Bias & blind spots**
9. "Who uses this product that is *least* like your team — and when did you last observe that person?" (For internal tools: the contractor, the part-timer, the client. For a facility: the first-time parent, not the coach.)
10. "What do you know from watching users that your analytics can't see — and what do analytics show that no user has ever mentioned?" (Healthy teams have answers on both sides.)
11. "Are you measuring engagement on people who are required to use the tool?"

**Cadence & sustainability**
12. "What's the smallest research habit you could sustain weekly — one session? One funnel review? Let's pick one and put an owner and a calendar slot on it."
13. "If your SUS/completion numbers dropped 10 points next quarter, would anything in your process notice?"

---

## Sources

- Nielsen Norman Group — Why You Only Need to Test with 5 Users: https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/
- Nielsen Norman Group — How Many Test Users in a Usability Study?: https://www.nngroup.com/articles/how-many-test-users/
- Nielsen Norman Group — Beyond the NPS: Measuring Perceived Usability with the SUS, NASA-TLX, and SEQ: https://www.nngroup.com/articles/measuring-perceived-usability/
- Nielsen Norman Group — UX Debt: How to Identify, Prioritize, and Resolve: https://www.nngroup.com/articles/ux-debt/
- Nielsen Norman Group — Using Prioritization Matrices to Inform UX Decisions: https://www.nngroup.com/articles/prioritization-matrices/
- MeasuringU — 10 Things to Know About the System Usability Scale (SUS): https://measuringu.com/10-things-sus/
- MeasuringU — Rating the Severity of Usability Problems: https://measuringu.com/rating-severity/
- MeasuringU — Using Task Ease (SEQ) to Predict Completion Rates and Times: https://measuringu.com/seq-prediction/
- Kerry Rodden — The HEART Framework for UX Metrics: https://kerryrodden.com/heart/
- Kerry Rodden (GV Library) — How to Choose the Right UX Metrics for Your Product: https://library.gv.com/how-to-choose-the-right-ux-metrics-for-your-product-5f46359ab5be
- Google Research — Measuring the User Experience on a Large Scale (CHI 2010): https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/
- Amplitude — What Is Product Analytics? A Data-Backed Guide: https://amplitude.com/explore/analytics/product-analytics-guide
- User Interviews — How Teams Do Continuous Discovery Research Today: https://www.userinterviews.com/blog/continuous-discovery-research-report
- Teresa Torres (Product Talk) — Everyone Can Do Continuous Discovery: https://www.producttalk.org/getting-started-with-discovery/
- Koji — Product Dogfooding: A Complete Guide (And Where It Falls Short): https://www.koji.so/docs/product-dogfooding-guide
