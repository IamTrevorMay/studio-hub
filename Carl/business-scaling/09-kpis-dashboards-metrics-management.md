---
title: "KPIs, Scorecards & Metrics-Driven Management"
domain: business-scaling
tags:
  - kpis
  - scorecards
  - metrics
  - dashboards
  - weekly-business-review
  - leading-indicators
  - benchmarks
sources_reviewed: 17
last_updated: 2026-07-12
---

# KPIs, Scorecards & Metrics-Driven Management

## TL;DR

- **Only track what you can act on.** Amazon's core rule: the weekly review is about *controllable input metrics* (things a team can move this week), not output metrics (revenue, subs, retention). Outputs get reported; inputs get discussed. If a number moves and nobody knows what to do about it, it doesn't belong on the scorecard.
- **Small companies need 5–15 weekly measurables, each with one owner and a target.** That's the EOS Scorecard spec and it's the right size for any company under ~50 people. One owner per number — "shared ownership = no ownership."
- **Build a KPI tree before choosing metrics.** Decompose the top-line outcome (revenue, active members, watch time) into 3–5 drivers via explicit math, then keep going until you hit levers a specific person controls. ~10–25 nodes total. The leaves become the scorecard.
- **The weekly review cadence is the actual product; the dashboard is just the prop.** Same day, same hour, same format every week, red/yellow/green per metric, off-track items drop into an issues list, follow-ups logged. This is where "fingertip feel" for the business is built.
- **Vanity metric test:** if the number can only go up (cumulative views, total followers, lifetime downloads) or has no decision threshold attached, it's vanity. Convert it: add a denominator, a cohort, or a "if X then we do Y" trigger.
- **Expect Goodhart's Law.** Any metric that becomes a target gets gamed. Defenses: pair every growth metric with a quality guardrail, have someone independent audit the numbers, and be willing to retire metrics that stop predicting outcomes.
- **Key benchmark anchors:** fitness industry annual retention averages 66.4% (boutique target 75–80%, elite monthly churn <3%); YouTube overall CPM ≈ $3.50 with finance/education niches $10–50 and sponsorships paying 2–5x AdSense per view; newsletter open rates ~41% on beehiiv in 2025 (inflated by Apple MPP — trust clicks, not opens).

---

## 1. Foundations: The Four Metric Distinctions That Matter

Almost every metrics failure traces to confusing one of these four pairs.

### 1.1 Leading vs. lagging

- **Lagging indicator**: measures an outcome after it happened. Revenue, churn, subscriber count, injuries, profit. Confirms whether you hit the goal; zero predictive power. You can't manage *to* a lagging indicator — by the time it moves, the causes are weeks old.
- **Leading indicator**: measures an activity or intermediate state that *predicts* the lagging outcome. Sales calls made, videos published, trial sessions booked, first-30-day attendance frequency.
- The two are relative, not absolute: one team's output is another team's input. "Qualified leads" is a lagging output for marketing and a leading input for sales.
- **How to find leading indicators: work backward.** Take each lagging KPI, ask "what did we do (or fail to do) 4–12 weeks before this number moved?", list candidates, then check correlation over time. Leadership must agree on which metrics are leading vs. lagging — otherwise KPI reviews degrade into debates about whether a number matters instead of decisions about what to do.

### 1.2 Input vs. output (Amazon's sharper version)

Amazon uses "**controllable input metrics**" deliberately — a leading indicator is only worth reviewing if it's also *controllable*. Weather is leading for a gym's foot traffic; it's not controllable, so it's context, not a KPI.

- **Controllable input**: directly actionable this week. "Add 500 new products to the category." "Run 20 newsletter ads this month." "Make 30 outreach touches to travel-ball coaches."
- **Output**: what you ultimately care about — revenue, DAU, free cash flow, member count. In Amazon's WBR you are literally *not allowed to discuss output metrics except in a reporting sense*. All the discussion budget goes to inputs.
- **Context metrics**: neither input nor output (e.g., mobile vs. desktop traffic mix). Included for awareness only.
- Function-level examples of good inputs (from Colin Bryar / Holistics): sales = responses from ICP-matching prospects; marketing = % of posts with an embedded capture form; engineering = commit-to-deploy time; support = % tickets resolved within 3 days.
- Bezos's flywheel (the 2001 napkin, inspired by Collins' *Good to Great*) is exactly this: a set of controllable inputs (selection, cost structure → lower prices, delivery speed) driving one output (growth).

### 1.3 Actionable vs. vanity

A **vanity metric** is any number that makes you feel good but doesn't inform a decision. Classic tells (KPI Tree / John Cutler):

- It can only go up (cumulative registrations, lifetime views, total downloads).
- It has no denominator, no target, no comparison to prior periods.
- Nobody can say what they'd do differently if it dropped 20%.
- It's psychologically soothing — vanity metrics persist precisely because they're easy to collect and always trend up.

Actionable equivalents fluctuate and embarrass you sometimes: conversion rate, cohort retention, weekly actives, revenue per member. "50,000 transactions this month" is noise unless you know the target, the error rate, and the trend.

### 1.4 Metric vs. target (and Goodhart)

**Goodhart's Law: when a measure becomes a target, it ceases to be a good measure.** Real examples: agents bonused on handle time rush calls; NPS bonuses breed survey-begging; analysts rewarded on cycle time game timestamps; a chef judged on meals served ignores whether anyone comes back. Defenses (Amazon's actual safeguards):

1. Every metric has an owner accountable for explaining it — including distinguishing normal variation from anomalies.
2. Finance (or anyone independent of the team being measured) audits the numbers.
3. Pair metrics: every growth/speed metric gets a quality guardrail (average order value ↑ paired with return rate; upload cadence paired with avg % viewed).
4. Retire input metrics when they stop moving the output — the weekly review is the checkpoint that catches this.

---

## 2. The Metric Hierarchy: North Star → OMTM → KPI Tree → Scorecard

These four concepts fit together as one system; most companies use them interchangeably and get mush.

### 2.1 North Star Metric (NSM)

- One company-wide metric expressing the core value delivered to customers *and* correlated with long-term business growth. Examples: Spotify = time listening; Airbnb = nights booked.
- It changes only when the business model changes. It aligns everyone but is too slow/high-level to run the week with.
- Good NSM test: does moving it require delivering real customer value (not just spend)? Facebook's "7 friends in 10 days" era metric worked because it captured value, not activity theater.
- **For a creator media business**, a sane NSM is something like *weekly hours watched by returning viewers* or *engaged audience across owned channels* — not subscriber count (vanity: can only go up, includes dead accounts). **For a training facility**, *weekly active members training 2+ times* beats raw membership count for the same reason.

### 2.2 One Metric That Matters (OMTM — Croll & Yoskovitz, *Lean Analytics*)

- Team-level and time-boxed: the single metric a team obsesses over for the current phase, typically **2–4 months** (some say up to 6), then it rotates.
- NSM is the fixed star; OMTM is the current leg of the journey. Example: NSM = weekly active teams; onboarding squad's OMTM = activation rate; engagement squad's OMTM = messages per team.
- Lean Analytics ties OMTM to business stage: empathy stage → qualitative/problem-validation signals; stickiness → engagement/retention; virality → referral coefficients; revenue → unit economics; scale → channel economics. Don't obsess over revenue metrics before you have retention.
- Carl's use: when a client is drowning in dashboards, force the question "for the next 90 days, which single number, if it doubled, changes this business?" Everything else becomes a guardrail or context.

### 2.3 KPI trees / driver trees

The bridge between the NSM and the weekly scorecard. See §4.

### 2.4 The weekly scorecard

The 5–15 leaf-level numbers with owners and targets, reviewed on cadence. See §3 and §6.

---

## 3. The Named Operating Frameworks

### 3.1 Amazon's Weekly Business Review (WBR) — the gold standard

From *Working Backwards* (Bryar & Carr) and Cedric Chin's Commoncog deep-dive. The most complete metrics-management system in existence; scale it down, don't skip its logic.

**Cadence & structure:**
- Every Wednesday morning, 60 minutes (90 in peak season), full exec team, runs even if the CEO is absent.
- Metrics generated Sunday night → owners review Monday → departmental WBRs Tuesday → company WBR Wednesday 9am. (Small-company version: metrics Friday night, dept check Monday, company review Tuesday.)
- Facilitator (Finance) opens with prior-week follow-ups, then metrics are walked **in fixed sequence, no skipping** — even metrics showing routine variation get ~2 seconds ("nothing to see"). Skipping kills fingertip-feel for normal ranges.
- Exception-driven discussion only. Strategy debates prohibited — taken offline.
- Amazon reviews **400–500 metrics in 60 minutes**. A 47-metric small-business deck runs in under 15 minutes. Speed comes from format discipline, not shallow review.

**The three questions the WBR answers, in order:**
1. What did customers experience last week? (customer metrics come *first* in the deck)
2. How did the business perform last week?
3. Are we on track to hit plan?

**Deck format — three chart types only:**
- **6-12 graph** (the workhorse): left panel = trailing 6 weeks; right panel = trailing 12 months. Six weeks (not four) because monthly boundaries hide patterns. Prior-year line faded in the background; target markers from the annual plan; numbers printed on the lines; identical fonts/colors every week. Consistency is what builds pattern recognition.
- **6-12 table**: when 6+ related metrics must be seen together.
- **Plain table**: comparative context (e.g., our price vs. Walmart/Target on top-10 items, because customers compare weekly and it's "unacceptable that customers experience something weekly that leadership doesn't").

**How metrics get onto the deck (four sources):**
1. Existing operator knowledge ("measure what you already know drives outcomes").
2. Positive anomalies — investigate spikes, replicate, then track the replicable input.
3. Decomposition — when an owner explains an output as a sum of sub-metrics, add the sub-metrics.
4. Post-incident — after every crisis ask "what could we have tracked to see this coming?" (the credit-card pre-auth story).

**Variation discipline (statistical process control):** owners must distinguish **routine variation** (normal range — say nothing) from **exceptional variation** (investigate root cause *before* the meeting). "I don't know yet, investigating" is an acceptable answer; a guess pulled from thin air is not. Don't chase blips on processes that aren't yet under control.

**The three questions execs ask constantly:** Is this metric worth discussing (or is it an output)? Is this the *right* input (multiple proxies exist)? How exactly is it measured (instrumentation determines the number you get)?

**Metrics lifecycle (DMAIC — Define, Measure, Analyze, Improve, Control):** define the metric precisely → instrument it → learn its normal behavior and root causes → only then act on it → then keep it under control. The documented WBR failure at a large software group came from teams jumping to "Improve" (chasing blips, sniping in meetings) without having done Define/Measure/Analyze. Other failure ingredients there: bloated attendee list, metric sprawl, no ground rules, people chiming in to curry favor. Fixes: senior leader sets tone weekly, attendance limited to owners + stakeholders, irrelevant metrics deleted, balance high standards with psychological safety around mistakes.

**Honest cost:** Chin reports months to start, months to do well, months to see results — and says total leadership buy-in is a hard requirement. The hard part is never the software (Amazon ran it on Excel and printed paper for years); it's the weekly discipline of testing your causal model of the business against reality.

### 3.2 EOS Scorecard (Wickman, *Traction*)

The right-sized version for a <50-person company.

- **5–15 weekly numbers** — fewer misses signals, more drowns the team.
- Each measurable = clear definition + **one owner** + **weekly goal**. No target, no meaning. Shared ownership = no ownership.
- Bias toward **activity-based leading indicators** (sales calls, leads generated, invoices out on time, complaints resolved, conversions, staff turnover) over financial laggers.
- Reviewed in the weekly **Level 10 meeting**: each number marked on-track/off-track in seconds; off-track items *drop to the Issues List* and get solved in the IDS (Identify-Discuss-Solve) segment — not litigated inline. This is the same "report fast, discuss exceptions" move as Amazon's.
- Classic EOS practice (from *Traction* itself): view 13 trailing weeks so trends are visible, and aim for "everyone has a number" — every seat on the accountability chart eventually owns at least one measurable.
- Common mistakes per EOS practitioners: too many numbers, lagging-heavy scorecards, fuzzy ownership, vanity numbers, and skipping weeks (the cadence is the mechanism — one skipped week costs a month of signal).

### 3.3 4DX — The 4 Disciplines of Execution (McChesney, Covey, Huling)

Best framing for *goal-driven* metrics (vs. WBR's *steady-state ops* metrics). The four disciplines:

1. **Focus on the Wildly Important**: 1–2 WIGs max, phrased "from X to Y by when."
2. **Act on the Lead Measures**: identify the 2–3 behaviors that are (a) predictive of the WIG and (b) influenceable by the team. This is the same controllable-input idea.
3. **Keep a Compelling Scoreboard**: a *players'* scoreboard, not a coach's — simple enough that anyone can tell in **5 seconds or less** whether the team is winning. Shows both lead and lag measures.
4. **Cadence of Accountability**: weekly WIG session — report on last week's commitments, update the scoreboard, make 1–2 specific commitments for next week.

Carl's synthesis: WBR/EOS Scorecard = the *whole business dashboard* (all engines nominal?); 4DX = the *campaign overlay* for the one or two things you're trying to change this quarter (e.g., "Neptune launch: from 0 to 60 founding members by opening day" with lead measures = facility tours given/week and assessment sessions booked/week).

---

## 4. KPI Trees: How to Build One

A KPI tree (metric tree / driver tree) is a hierarchical decomposition of a top-level metric into its drivers, **connected by explicit math** (sum, product, ratio) at each level, ending in leaves that individual owners control.

### Build steps

1. **Root = North Star or top financial outcome** (revenue, active members, engaged watch hours).
2. **Decompose with math that matches how *your* business actually works** — not a textbook formula. Revenue = Customers × ARPU; Customers = New + Retained − Churned; New = Traffic × Conversion. If your revenue is really 4 distinct streams, the first split is by stream.
3. **Keep splitting until you hit operational levers** a single team/person controls this week.
4. **Add behavioral hypotheses at the leaves** (Mixpanel's layer 3): "members who attend 4+ times in month 1 retain," "viewers who watch 3 videos in week 1 subscribe." These are the causal bets you'll test.
5. **Assign one owner per branch.** Every team should own exactly one branch.
6. **Size check: one root, 3–5 branches, 3–5 leaves per branch — ~10–25 metrics total.** A first draft takes a few hours; a good org-wide tree takes a few workshops.
7. **Review quarterly** — trees rot as the business changes; the math should keep balancing against actuals (if the leaves don't roughly reconstruct the root, your model of the business is wrong, which is itself the finding).

The payoff: when a lagging number slips, you trace *down* the tree to the exact driver instead of arguing in the abstract. The tree also arbitrates metric disputes — a proposed KPI that can't be placed on the tree is probably vanity.

### Example: creator-led media company tree (Mayday-shaped)

```
Total revenue
├── AdSense revenue = Views × RPM
│   ├── Views = Uploads × avg views/upload  (inputs: publish cadence, CTR, avg % viewed)
│   └── RPM  (inputs: niche mix, mid-roll placement, long-form vs Shorts mix)
├── Sponsorship revenue = Deals × avg deal size
│   ├── Deals = Outbound pitches + inbound × close rate  (inputs: pitches/week, media kit updates)
│   └── Avg deal size  (inputs: engaged-view proof, bundle packaging across YT+newsletter)
├── Newsletter revenue = Subs × (paid conversion × price + sponsor slots × slot rate)
│   └── Subs growth = new (inputs: capture placements, cross-promo) − unsubs
└── Merch revenue = Store sessions × conversion × AOV  (inputs: launches/quarter, video integrations)
```

Leading leaf-level scorecard candidates: uploads published vs. plan, thumbnail/title CTR, avg % viewed, sponsor pitches sent, newsletter capture rate, merch drops shipped on schedule.

### Example: training facility tree (Neptune-shaped)

```
Monthly recurring revenue
├── Active members × ARPM (avg revenue per member)
│   ├── Active members = New joins + retained − churned
│   │   ├── New joins = Leads × tour rate × close rate  (inputs: coach outreach touches, referral asks, trial sessions run)
│   │   └── Churn  (inputs: first-30-day visit frequency, structured onboarding completion, failed-payment recovery)
│   └── ARPM  (inputs: package mix, add-ons: assessments, camps, remote programming)
└── Non-recurring: camps/clinics revenue = events × attendance × price
```

Leading leaf-level scorecard candidates: trial sessions booked/week, tours given, new-member week-1 visits, at-risk members contacted, failed payments recovered.

---

## 5. Dashboard Design for Ops Reviews

### 5.1 Stephen Few's rules (*Information Dashboard Design*)

- Definition: "a visual display of the most important information needed to achieve one or more objectives, consolidated on a **single screen** so it can be monitored at a glance." The whole value is simultaneity — seeing everything at once. No scrolling, no tab-switching for the core view.
- Three dashboard types; don't mix their jobs:
  - **Operational** — real-time/near-real-time, frontline monitoring, alert-oriented.
  - **Strategic** — executive, high-level KPIs, longer time frames, mostly static.
  - **Analytical** — exploration with filters/drill-downs, for analysts, not for meetings.
  - The weekly ops review wants a *strategic-operational hybrid*: fixed layout, weekly grain, trend-first.

### 5.2 What actually works for a weekly review deck

- **Fixed format beats interactive.** Amazon's WBR deck is static by design — "waiting for dashboards to load or switching tabs is unacceptable," and identical formatting week over week is what builds pattern recognition. A live-connected spreadsheet or a printed/PDF deck outperforms a clicky BI tool for this specific job.
- **Show trend + comparison on every number**: the 6-12 layout (6 trailing weeks + 12 trailing months + prior-year ghost line + target markers) is the best single template ever published for this. Never show a lone number without last week, target, and trend.
- **Red / Yellow / Green status per metric** (missing / close / exceeding target), assigned before the meeting by the owner.
- **Order the deck along the causal chain**: customer-experience metrics → inputs → outputs → financials. Not alphabetically, not by department seniority.
- **Live data connection, not manual paste** (Row Zero's #1 small-company pitfall): stale hand-copied numbers destroy trust and eat prep time; connect the sheet to the source of truth.
- 5-second test on every page (4DX): can a newcomer tell if we're winning?

### 5.3 Tooling ladder for a small company

Spreadsheet with 5–15 rows and 13 trailing-week columns (EOS style) → spreadsheet auto-fed from the database with 6-12 charts → in-app dashboard once formats are proven stable. Build software last; Amazon ran the world's best metrics meeting on Excel and paper. (Relevant to Mayday Studio: the app already aggregates platform metrics — the missing pieces are usually a fixed weekly deck view, targets, owners, and RAG status, not more charts.)

---

## 6. Running the Weekly Ops Review — Playbook

**Agenda (60 min max; 20–30 min for a small team):**
1. **Follow-ups first** (5 min): last week's action items — done or not, no stories.
2. **Scorecard walk** (10–20 min): every metric in fixed order, owner states status. Green/routine = 2 seconds. Red/yellow = owner gives the *pre-investigated* root cause and either a fix or "still investigating." No skipping greens entirely (fingertip feel), no strategy debates inline.
3. **Issues/exceptions** (bulk of remaining time): items dropped from the walk get prioritized and solved or assigned (EOS: IDS — identify root cause, discuss once, solve with an action + owner + date).
4. **Log commitments** for next week.

**Roles:** a facilitator who owns agenda + deck + follow-up log (not necessarily the CEO); one owner per metric who reviews their number *before* the meeting; leadership asks questions and holds standards.

**Ground rules that keep it alive:** same time weekly, runs even when the founder is out; attendance limited to owners + genuine stakeholders; senior person sets tone (high standards *and* safety to report bad numbers — if reds get punished, you'll get watermelon metrics: green outside, red inside); delete metrics that no longer earn their slot; "I don't know yet" allowed, fabricated explanations not.

**Standing one up from zero (Row Zero + Commoncog synthesis):**
- Week 1–2: draft the KPI tree; pick 5–10 leaf metrics; assign owners; set targets from history or plan.
- Week 3–4: build the sheet with live data; run the first two reviews accepting that they'll be messy (they will be).
- Month 2–3: tune — kill dead metrics, add decomposition metrics as owners explain their numbers, calibrate what routine variation looks like.
- Expect months before it feels natural; the compounding payoff is a shared, tested causal model of the business.

---

## 7. Departmental Scorecards (small-company templates)

Rule per department: 3–6 numbers, majority leading, one owner each, weekly grain.

**Content/Media (channel team):** uploads published vs. plan; CTR on new uploads; avg % viewed / avg view duration; subs net adds (context); sponsor deliverables shipped on time; newsletter sends + verified clicks.

**Sales/Sponsorship:** pitches sent; discovery calls held; proposals out; close rate (lagging guardrail); pipeline value (context).

**Facility ops (training business):** trial sessions booked; tours given; new-member first-week visits; sessions delivered vs. capacity (utilization); at-risk member outreach touches; failed-payment recovery rate.

**Finance/Admin (either business):** cash balance (context — the one output everyone sees weekly); invoices issued on time; AR > 30 days; payroll/contractor payments on schedule.

**Marketing:** qualified leads or email captures; capture rate on top content; cost per lead (if paid); referral asks made.

---

## 8. Vanity Metrics, Goodhart & Metric Hygiene

### Cutler's 10-point healthy-metric test (Amplitude)
A metric is *not* vanity when: (1) the team understands the rationale behind it; (2) related metrics give it context; (3) an explicit hypothesis links it to outcomes; (4) its calculation is transparent and decomposable; (5) it survives regular scrutiny; (6) the team has a working theory of what its changes indicate; (7) it drives specific, reviewable decisions; (8) it has action thresholds and *can meaningfully decline*; (9) it supports period-over-period comparison; (10) it's used to communicate challenges, not just wins.

### Conversion moves (vanity → actionable)
- Replace vague measures with specific behavioral proxies (not "engagement," but "time to first project shared" / "week-1 visits").
- Add a denominator and a cohort: total subscribers → % of last-90-day subscribers who watched this week.
- Add guardrail pairs: AOV ↑ paired with return rate; handle time ↓ paired with resolution rate; upload count paired with avg % viewed.
- Attach a decision trigger: "if trial-to-member conversion < 40% for 3 weeks, we rework onboarding."
- Frame exploratory metrics as exploratory — don't present unproven correlations as causal.

### Media-specific vanity traps
Subscriber/follower counts (cumulative, includes dead accounts), raw view totals without retention, impressions, email open rates post-Apple-MPP (auto-loaded images inflate opens — beehiiv's own 41% figure carries this caveat; the industry has shifted to **verified clicks, replies, and post-email actions**). Trust: returning-viewer watch time, CTR × avg % viewed, click-through on newsletters, revenue per 1,000 engaged views.

### Fitness-specific vanity traps
Total memberships sold (ignores churn), social followers, class schedule breadth. Trust: active members training 2+/week, first-90-day attendance, LEG (length of engagement — microgym benchmark ≈ 7.8 months per Two-Brain), ARPM.

---

## 9. Benchmarks

Use benchmarks to set initial targets and sanity-check the tree — then switch to competing against your own trailing 13 weeks.

### 9.1 Creator media business

**YouTube monetization (2025–26, Lenostube / niche guides):**
- Platform-wide average CPM ≈ **$3.50**; RPM is what the creator keeps after YouTube's ~45% ad cut and non-monetized views.
- CPM by niche: finance **$15–50** (some guides to $65), tech **$5–30**, education **$10–25**, health/fitness **$7–20**, gaming **$4–15**, entertainment **$2–8**, music ~**$1.36**.
- CPM by geography: Australia ~$36, US ~$33, Canada ~$29; India ~$0.83. Audience geography mix drives RPM more than most creators realize.
- **Shorts**: RPM ≈ **$0.01–$0.06** — two orders of magnitude below long-form. Shorts are an audience-acquisition input, not a revenue line; never let Shorts views inflate the revenue forecast.
- **Sponsorships pay 2–5× equivalent AdSense per view** (sponsored RPM ~$8–30). Rough per-video rates: $100–500 at 10–50K subs, $500–2,000 at 50–100K, $2,000–10,000+ above 100K — but engaged views and niche matter more than sub count in negotiation.

**Newsletter (beehiiv 2025 State of Newsletters; 15.7B sends analyzed):**
- Average open rate rose to **41.2%** (2025) from 38.0% (2024) — partly Apple MPP inflation; treat opens as directional only.
- CTR declining year over year platform-wide; verified clicks/replies are the metrics to manage.
- Paid subscriptions were beehiiv's fastest-growing revenue channel (+138% YoY to $19M across the platform in 2025), driven by niche expertise — supports a paid tier only where content is genuinely specialized.

### 9.2 Fitness / training facility

(HFA 2025 report via Nutripy; Regulr; boutique studio KPI guides.)
- **Industry annual retention: 66.4%** (175 companies, 17,000+ facilities, 2024 data) — down ~5 pts from 71.4% a decade ago.
- Boutique/community studios: **70–80% annual retention** achievable; budget gyms 55–60%; mid-range 58–65%.
- **Monthly churn grades: <5% acceptable, 3–4% strong, <3% elite.** (Note the compounding trap: 3% monthly ≈ 30% annual, not 36%.)
- **First 90 days decide everything:** over half of new members stop attending within 3 months; members with <4 visits in month 1 have ~80% cancellation odds; structured 90-day onboarding lifts 6-month retention from ~60% to **87%**.
- Attendance frequency → annual retention: 3+/week ≈ 85–90%; 2/week ≈ 65–75%; 1/week ≈ 40–50%. *Visit frequency is the single best leading indicator for a training business.*
- Staff contact (2+ touches/month) cuts cancellations ~33% at boutiques; group/cohort formats extend tenure ~22% vs. solo access (Les Mills).
- **Involuntary churn = 30–40% of cancellations** — failed payments. Dunning/retry flow is the cheapest retention lever that exists.
- Win-back programs recover 15–25% of cancellations within 60 days.
- Revenue: boutique ARPM target **>$250/month** (premium/coaching-heavy models — a baseball development lab fits this profile); microgym LEG benchmark ~7.8 months.

---

## 10. Common Mistakes

1. **Scorecard full of lagging outputs** — the review becomes a weather report. Majority of slots must be controllable inputs.
2. **Too many metrics** — past ~15 weekly numbers at small scale, review quality collapses. Amazon handles 400+ only via extreme format discipline; you don't have that yet.
3. **No owner or shared owners** — a number nobody must explain is a number nobody watches.
4. **No targets** — status can't be red/green without a line to compare against.
5. **Skipping the cadence** — a scorecard reviewed "when we get to it" is dead. The meeting is the mechanism.
6. **Chasing routine variation** — reacting to every wiggle before you know the metric's normal range (skipped DMAIC Define/Measure/Analyze). Causes thrash and metric fatigue.
7. **Discussing strategy inside the metric walk** — kills the meeting's speed and everyone's willingness to attend. Exceptions drop to an issues list.
8. **Vanity numbers in the board pack** — cumulative anything, follower counts, raw opens post-MPP.
9. **Trusting found correlations as causal** — the WBR standard: run an experiment to verify an input actually moves the output before betting the quarter on it.
10. **Punishing red** — leads to watermelon reporting and gamed inputs (Goodhart). Reward fast surfacing of bad numbers.
11. **Building the dashboard before defining the metrics** — tooling-first efforts produce pretty, unused screens. Spreadsheet first; software when the format has been stable for a quarter.
12. **Manual data paste** — stale numbers destroy trust in one bad meeting. Automate the feed early.
13. **Same metric, drifting definition** — "active member," "view," "lead" must have one written definition; instrumentation determines the number you get.
14. **Never retiring metrics** — inputs that stopped predicting outputs are clutter; Amazon deletes them (e.g., recruiting metrics left the top WBR once the hiring crisis passed).

---

## 11. Questions Carl Should Ask

**Diagnosing the current state:**
- "What numbers do you look at every week, on what day, with whom?" (No fixed answer = no metrics system, regardless of how many dashboards exist.)
- "For each number: who owns it, what's the target, and what happened last time it went red?" (Tests ownership, targets, and whether metrics drive decisions.)
- "Which of your metrics could you make go up this week by doing something? Which only report what already happened?" (Input/output sort.)
- "If revenue dropped 15% next month, which metric would have warned you 6 weeks earlier?" (Leading-indicator coverage.)
- "Show me a metric you stopped tracking and why." (Never retired one = the list is sediment, not a system.)

**Stress-testing individual metrics:**
- "What decision does this number inform? At what threshold do you act?"
- "Can this number go down? When did it last go down, and what did you do?"
- "How exactly is it measured — and who could game it if their bonus depended on it?"
- "What quality guardrail pairs with this growth metric?"

**For the media business specifically:**
- "What % of revenue is AdSense vs. sponsorship vs. newsletter vs. merch — and does your scorecard have at least one leading input per stream?"
- "Are Shorts views in the same bucket as long-form views anywhere in your reporting?" (They shouldn't be — ~100x RPM difference.)
- "What's your returning-viewer metric? Subscriber count doesn't count."

**For the training facility specifically:**
- "What's your new-member first-30-day visit count, and who calls the ones below 4 visits?" (The single highest-leverage retention question.)
- "What's your monthly churn split between cancellations and failed payments?" (30–40% of churn is usually recoverable dunning.)
- "Do you know your LEG (average member tenure in months)? What's it worth in dollars to extend it one month?"

**Cadence & culture:**
- "When someone reports a red number, what happens to them?" (Checks for watermelon-metric incentives.)
- "Does the review happen when the founder is traveling?" (Institution vs. founder habit.)
- "Could a new hire look at your scoreboard and know in 5 seconds whether you're winning?"

---

## Sources

- Cedric Chin, "The Amazon Weekly Business Review," Commoncog — https://commoncog.com/the-amazon-weekly-business-review/
- Holistics, "Obsess Over Controllable Input Metrics" (on Bryar & Carr's *Working Backwards*) — https://www.holistics.io/blog/obsess-over-controllable-input-metrics/
- Working Backwards LLC, "Input Metrics for Business Growth" — https://workingbackwards.com/concepts/input-metrics/
- Row Zero, "How to Run a Weekly Business Review — Insights from Amazon WBRs" — https://rowzero.com/blog/weekly-business-review
- Mixpanel, "KPI Trees 101: Complete Guide" — https://mixpanel.com/blog/kpi-trees/
- KPI Tree, "How to Build a Metric Tree" and "Vanity Metrics vs Actionable Metrics" — https://kpitree.co/guides
- John Cutler / Amplitude, "What Are Vanity Metrics and How to Stop Using Them" — https://amplitude.com/blog/vanity-metrics
- Amplitude, "Leading vs. Lagging Indicators (With Real-World Examples)" — https://amplitude.com/blog/leading-lagging-indicators
- Klipfolio, "Leading vs. Lagging Indicators: A Guide for Your Business" — https://www.klipfolio.com/blog/leading-and-lagging-indicators
- Business Action, "The EOS Scorecard Explained" — https://www.businessaction.com/the-eos-scorecard-explained-a-simple-weekly-system-to-keep-business-on-track/
- ScaleUpExec, "EOS Scorecard Guide: What to Track and How to Build It" — https://scaleupexec.com/what-goes-in-an-eos-scorecard/
- FranklinCovey, "The 4 Disciplines of Execution" (incl. Discipline 3: Compelling Scoreboard) — https://www.franklincovey.com/courses/the-4-disciplines/
- Userpilot, "What is One Metric That Matters (OMTM)?" (Croll & Yoskovitz, *Lean Analytics*) — https://userpilot.com/blog/one-metric-matters-omtm/
- Chartio, "Stephen Few's *Information Dashboard Design*: Strategic vs Operational Dashboards" — https://chartio.com/blog/startups-blur-the-line-strategic-versus-operational-dashboards/
- Nutripy, "Gym Retention Rate Benchmarks 2026" (HFA 2025 / IHRSA data) — https://nutripy.io/blog/gym-retention-rate-benchmarks-2026
- Regulr, "Fitness Studio Member Retention: Key Stats" — https://regulr.ai/blog/fitness-member-retention-stats
- Lenostube, "YouTube CPM & RPM Rates: Averages by Niche and Country" — https://www.lenostube.com/en/youtube-cpm-rpm-rates/
- InfluenceFlow, "YouTube Sponsorship Rates 2025 Guide" — https://influenceflow.io/resources/youtube-sponsorship-rates-2025-a-creators-guide-to-fair-pricing/
- beehiiv, "2025 State of Email Newsletters" — https://www.beehiiv.com/blog/2025-state-of-email-newsletters-by-beehiiv
