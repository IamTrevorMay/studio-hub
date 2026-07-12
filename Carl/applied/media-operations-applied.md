---
title: "Media Operations Applied to Mayday Media"
domain: applied
source_domain: media-operations
tags:
  - mayday-media
  - neptune-performance
  - mayday-studio-app
  - content-pipeline
  - sponsorship-economics
  - unit-economics
  - freelancer-bench
  - facility-economics
last_updated: 2026-07-12
---

# Media Operations Applied to Mayday Media

Carl here. This is the media-ops domain translated into what I'd actually tell you to do — Mayday Media,
Neptune Performance, and the Studio app, in that order of specificity. Every claim below traces to a
reference doc; where I'm guessing about your numbers, I say so and it goes in "What I'd need to know."

## TL;DR

1. **Adopt the operating thesis: More Mayday is the marketing department, not the business.** Sports/entertainment
   AdSense runs $4–10 CPM — near the bottom of the table — so the channel's job is to make Neptune's CAC ~zero
   and to sell sponsorships, the way Feastables spends ~0% on awareness vs. 15–25% for normal CPG
   (see media-operations/02-creator-economy-studio-models.md).
2. **Install a packaging-first greenlight gate in the Projects pipeline.** Title + thumbnail concept locked
   *before* production, logged Go/Kill/Hold, target ≥20% kill rate at the concept gate. Right now nothing dies;
   that means weak ideas are dying in the edit — the most expensive place (see media-operations/01-content-production-pipelines.md).
3. **Build the per-video P&L.** You already sync revenue in (`revenue_events`, platform metrics); nothing tracks
   cost out. Fully loaded cost per video within ±20% or you're not managing a content business
   (see media-operations/11-content-unit-economics-budgeting.md).
4. **Audit the ad agency against the 35–60% rule.** Good representation lifts gross earnings 35–60%; if the
   agency's lift doesn't clear its 10–20% commission net-positive, fire or renegotiate. Price every deal off
   `recent avg views × sponsor-category CPM × format multiplier` and sell usage rights as separate line items
   (see media-operations/09-sponsorship-brand-deal-economics.md).
5. **De-single-point-of-failure the freelance bench.** David Korn on clips is a bench of one; a bench of one is
   not a bench. 2–3 vetted names per publish-blocking skill, paid $50–150 test projects, performance ratings
   stored in the freelancer portal (see media-operations/08-freelancer-contractor-management.md).
6. **Price Neptune off the utilization floor, not off vibes.** Floor price = total monthly fixed cost ÷ realistically
   billable hours at ~70% utilization — then price above it. Experience venues run 3–6% operating margins;
   the media arm derisks *demand*, never *fixed costs* (see media-operations/11 and /02).
7. **Do the boring legal stack before Neptune opens doors:** trademark clearance + filing (Class 41 + 25, ~$350/class,
   12–18 months), one-page releases for every athlete/minor on camera, a written music-library-only policy, and
   verbal + on-screen FTC disclosure on every ad read (see media-operations/12-rights-licensing-legal.md).
8. **Fix measurement before adding streams.** Substack and Fourthwall syncs are dead; you cannot run the
   diversification ladder (ads → sponsors → membership → merch → …) with blind revenue lines
   (see media-operations/10-diversified-revenue-models.md).

---

## 1. The operating thesis (read this before anything else)

You are running the exact pattern the 2020–2026 winners ran: audience on a rented platform → rented
monetization (AdSense + sponsors) → **owned monetization** (Substack, Fourthwall, and now a physical
facility). The reference case math is stark: MrBeast's media division *lost* ~$80M in 2024 while Feastables
made $20M+ profit on ~$250M — content is customer acquisition, products are profit
(media-operations/02-creator-economy-studio-models.md).

Your version: **Neptune is your Feastables.** A baseball development lab sold by a former MLB pitcher with
a content engine attached is the strongest audience-product fit you have — daily-relevance category, genuine
founder association, and a customer (parents of serious youth players, adult players) who already trusts you.
The channel's sports-niche AdSense ($4–10 CPM, vs. $20–50 for finance) will never carry the company. Stop
optimizing AdSense; optimize (a) sponsorship yield and (b) the pipeline from viewer → Neptune lead.

Two failure modes from the reference docs to tattoo somewhere:

- **Never license the Mayday/Neptune name without quality-control, audit, and termination rights**
  (MrBeast Burger). If Neptune ever franchises or a partner runs programs under your brand, the reputational
  damage is non-delegable.
- **Never paywall what the audience already gets free** (Watcher). Substack premium and any Neptune digital
  product must be *additive* tiers, and existing supporters get grandfathered.

Benchmark for self-calibration: at your team size and revenue shape you're a Tier 1→2 studio (creator +
freelancers, crossing into "small studio"). The right comps are Colin & Samir (6 FTE, video + podcast +
newsletter, anchored by 1–2 recurring brand relationships) — not Beast Industries. Imitating spectacle
economics at 1/100th the revenue is suicide (media-operations/02, §6).

---

## 2. Mayday Media: pipeline and content ops

### 2.1 Gates in the Projects pipeline (Now)

Your stage-based project cards are already a kanban; what's missing is that stage transitions are free.
Add three real gates (media-operations/01-content-production-pipelines.md, §2):

- **Gate 1 — Concept (calendar-fixed, e.g. Monday):** one-liner + draft title + thumbnail description + why-now.
  Decision logged: Go / Kill / Hold. **Track kill rate; under ~20% means the gate is theater.** Cooper's
  Stage-Gate research says 30–50% of ideas *should* die here.
- **Gate 2 — Greenlight (before shoot):** locked title + thumbnail concept + beat sheet + shoot date + publish
  date + owner per deliverable. The MrBeast rule applies verbatim: if you can't package it, don't shoot it.
  Your Beat Sheet feature is the natural artifact for this gate — add title/thumbnail fields to it.
- **Gate 3 — Publish (checklist, not debate):** final cut, 2–3 thumbnail variants, metadata, sponsor-spec
  check, FTC disclosure check, repurposing plan scheduled.

One gatekeeper per gate (you, realistically, until §4's producer hire). "Recycle" allowed once; twice = kill.

### 2.2 WIP limits and the conveyor (Now)

Little's Law: cycle time = WIP ÷ throughput. If you finish ~1 long-form/week with 6 cards in flight, your
cycle time is 6 weeks and every card is stale by publish. Cap in-flight cards per stage (start with 2 in
edit, 3 in pre-pro) and run the TV conveyor: this week publishes, next week edits, week three shoots — in
parallel, never serially (media-operations/01, §1).

### 2.3 Repurposing as a stage, not an afterthought (Now)

Target: **one long-form pillar → 10+ assets** (3–5 clips, 2–3 text/IG posts, a newsletter section). Budget
2–4 hours per pillar. You already built the machinery — PostShow clipping tool + the Clip Video automation
that tasks David on every new More Mayday upload. Two upgrades: (a) make the repurposing package part of
Gate 3 so a video isn't "done" until the clips are scheduled, (b) route the newsletter section into Substack
every week — it's the cheapest asset in the package and it feeds the one channel you own outright.

### 2.4 Calendar discipline (Next)

Run three horizons in the Calendar page: 90-day themes (Neptune launch beats, baseball season arcs), 30-day
titles with owners, 7-day operational. Batch everything with setup cost — one shoot day should feed 2–4 weeks
(media-operations/06-editorial-calendars-content-ops.md). And write **kill criteria for every recurring
series before it launches**: "if avg views < 60% of channel median after 6 episodes, kill or reformat."
Zombie series eat small teams' calendars because nobody wants the in-the-moment argument.

### 2.5 Post-production hygiene (Next)

- **Picture lock is a gate**: rough cut review → one consolidated revision round → lock → finish. Your approval
  on the revision round *is* lock; re-cutting the intro after "final" costs 5–10x
  (media-operations/05-post-production-asset-management.md).
- **Two consolidated, timestamped revision rounds** as the contractual norm with every editor. If a video
  needs 3+, the brief is broken, not the editor.
- Naming convention enforced at ingest: `YYYYMMDD_project_descriptor_vNN`. Your Organize tool should refuse
  or flag nonconforming names — enforcement at ingest beats cleanup 10–50x.
- Editor sizing math: 30–60 min of edit time per finished minute (1–2 hrs/min stylized). Use it to sanity-check
  freelancer quotes and to know when volume justifies in-house (§4).

---

## 3. Sponsorship economics (the revenue engine to professionalize first)

Sponsorships are ~59–70% of creator revenue economy-wide, and they're your margin engine too. Three moves:

### 3.1 Price on the formula, not the agency's gut (Now)

`Rate = (avg views, last 10–15 uploads ÷ 1,000) × niche CPM × format multiplier` — then line-item usage
rights (media-operations/09, §2). Critical subtlety for you: price at the **sponsor's category CPM**, not
sports-content CPM. A betting app, a fintech, or a training-equipment brand buying your audience prices at
*their* LTV economics. Dedicated videos = 2.5–4× the integration rate; hold that multiple. Usage rights are
a separate product: organic reuse +25–50%/mo, paid whitelisting +50–100%/mo, perpetual +200–300% one-time,
exclusivity +20–50% for a *named-competitor*, 30–90-day window only.

### 3.2 Audit the agency (Now)

Norms: 10–20% commission, sometimes split lower on deals you sourced inbound. The test: **does the agency
lift gross earnings 35–60% such that you net more after commission than you'd earn direct?** Pull 12 months
of `revenue_events` and answer it with arithmetic. Also check the contract stack on every deal: 50% upfront,
payment tied to *delivery* not publication, kill fee (25–50% pre-production, 100% post-delivery), cure period,
time-boxed usage. If the agency's paper doesn't have these, supply your own template
(media-operations/09 + /12).

### 3.3 Run renewals as a pipeline (Next)

Lead → Qualified → Pitched → Negotiating → Contracted → In Production → Delivered → Paid → **Renewal**.
Repeat sponsors are the profit center. Your Deliverables page + agency portal already cover Contracted →
Delivered; the gap is the front (pipeline stages before contract) and the back (a renewal date + trigger on
every completed deal — an Automation that creates a "pitch renewal" task 30 days after final deliverable
would take an afternoon to build).

### 3.4 FTC compliance is an ops checklist item (Now)

Verbal AND on-screen disclosure, before the pitch, plain language. Penalties exceed $50K per violation and
both brand and creator are liable. Put it on the Gate 3 checklist and in the agency portal's deliverable
spec (media-operations/12, §5-equivalent).

---

## 4. Team, freelancers, and the org (media-operations/07 + /08)

- **The bench-depth rule: 2–3 vetted, recently-active names per publish-blocking skill.** Clips currently =
  David Korn, full stop. Run paid test projects ($50–150, real footage, real brief) for 2 backup clip editors
  and 1–2 long-form editors *before* you need them. Add a `performance_rating` + would-rehire flag to
  `freelancer_profiles` — you already have the portal; make it a talent database.
- **The next hire is operational, not creative.** The canonical order is editing → production/ops → sales.
  You've bought editing freelance; the "content market fit → operational support" trigger (Colin & Samir)
  says the next $ goes to a producer/ops generalist who owns calendar, briefs, sponsor logistics, and
  freelancer wrangling — because every additional creative hire otherwise adds coordination load back onto
  you. Split what/why (you: creative director) from how/when (producer). Cost anchor: video producer ~$83K
  FT, or fractional first.
- **Classification risk check:** an editor who works only for you, on your schedule, editing your core
  product is the textbook misclassification profile (DOL economic-realities + IRS control tests). If any
  freelancer is functionally full-time, either convert them or restructure the engagement. Back-pay +
  doubled damages is the downside.
- **Comp anchors for budgeting:** freelance editor $45–85/hr mid-level; $300–800 per long-form video
  mid-tier; retainers $1.5–3.5K/mo for ~4 long-form + cutdowns (expect a 20–25% discount vs. per-unit at
  4+ deliverables/mo — take the retainer once volume is steady). Budget true cost at ~1.4–1.65× sticker
  once revisions, rush, thumbnails, and repurposing land.
- **Onboarding via the portal is a genuine edge** — manual contractor onboarding averages 8 hours/head;
  your invite → documents → Drive → hours flow already systematizes it. Add the ratings and a per-skill
  bench view and you have what most 20-person shops lack.

---

## 5. Unit economics and measurement

### 5.1 The per-video P&L (Now — this is the highest-leverage analytics feature you can build)

```
Fully loaded cost/video = direct (freelance edit, music, thumbnail, travel)
                        + amortized gear/studio + allocated software/overhead
                        + your time at a real rate (never zero — 15–25 hrs × $150/hr is $2,250–3,750)
Contribution/video      = attributable revenue − variable cost
Break-even output       = monthly fixed base ÷ contribution per sponsored video
```

The worked example in media-operations/11 (§3.1) is your template: sponsored long-form contributing ~$4,700
vs. unsponsored contributing −$200 means unsponsored videos are *marketing spend* — capped and budgeted, not
"content." You cannot see this today because costs live nowhere. Minimum viable version: a `cost_cents` +
`hours_logged` field per project card, revenue joined from `revenue_events` + platform metrics, and a
per-format contribution report. Judge formats by **cost-per-outcome** (a $1,500 clip driving 300 Neptune
leads at $5/lead beats a $50K brand film at $250/lead by 50x), and measure revenue over a 12-month window
for evergreen formats, not 30 days.

### 5.2 Fix the dead syncs (Now)

Substack and Fourthwall syncs are genuinely dead (your own data-integrity notes). Attribution honesty
(media-operations/11, §2.3) is impossible with blind lines. Fix or manually backfill before making any
diversification decision — you'll otherwise conclude "merch doesn't work" from missing data, not from merch.

### 5.3 Diversification sequencing (Next → Later)

The ladder: ads → sponsors → membership → merch → course/digital product → licensing — **one new stream only
after the previous is systematized** (media-operations/10). Where you actually are: sponsors semi-systematized
(§3 fixes), Substack live but under-fed, Fourthwall live but unmeasured. So: feed Substack weekly from the
repurposing package, model free→paid at a median 0.6–3% (anyone modeling 10% is fantasizing), push annual
billing hard (annual retains ~92% over 12 months vs ~68% monthly). Run Fourthwall as **event-driven drops
tied to content and Neptune moments** (launch drop, season drop), not an always-on catalog; POD first,
graduate proven winners to bulk. A Neptune-branded course/digital program is the Later-stage high-margin
play (85–95% margin; cohort-based completes at 85–96% and prices 3–5× self-paced) — but only after the
facility itself is running.

---

## 6. Neptune Performance: facility economics with a media engine

This is where most creators lose money romantically. The numbers first (media-operations/11 §1.5, /02 §6):

- **Pricing floor:** `total monthly fixed cost ÷ realistically billable hours` at ~70% utilization — never
  price at the floor, price above it. Example shape: $15–19K/mo fixed (lease + coach payroll + equipment
  amortization) needs ~127 billed hours at $120/hr just to break even; at 70% utilization your effective
  cost per available hour is your real floor.
- **The 60% rule:** if salaried coach utilization drops below ~60% of available hours, operating leverage is
  dangerously high — one soft quarter (read: baseball off-season) puts you underwater. Model seasonality
  explicitly; sell off-season programs (strength blocks, remote video analysis) into the trough *before* it
  arrives.
- **The Dude Perfect caution:** experience venues run 3–6% operating margins and 6+ year paybacks. Your
  media arm makes Neptune's CAC ~zero — every video is an ad the audience chooses to watch — but it does
  not repeal facility economics. Model drive-time population, visit frequency, and payback period honestly
  before every capex line in the Facility workstream.
- **Membership over à la carte:** the physical membership is your layer-3 recurring revenue with far lower
  churn tolerance than digital. Three-tier ladder (a tier ladder roughly doubles revenue vs. single-tier at
  the same member count), annual/seasonal commitments pushed hard, and a "first win" in week one — the
  single biggest churn lever is early demonstrated progress (velo/exit-velo baseline session in week 1).
- **Coach hours are agency hours.** The whole agency model applies: capacity × utilization × effective rate
  (media-operations/03-agency-operations-resourcing.md). Track coach utilization weekly from day one — a
  lesson calendar is a utilization dashboard waiting to happen, and the Studio app is the obvious place for
  it (Later; see §7).

**Legal stack, before doors open (media-operations/12):**

1. **Trademark**: clearance search on "Neptune Performance" *now* (before signage, before merch), then file
   Class 41 (training services) + Class 25 (merch). ~$350/class, 12–18 months — the timeline alone says
   start this quarter. Put it as a Legal task in the BD page's Operations workstream.
2. **Releases**: one-page media release signed by every athlete before first recording — parent/guardian for
   minors, which will be most of them. Store forever (Supabase table + PDF, not a drawer).
3. **NIL vs. footage**: filming *your own* facility sessions is yours (with releases); game/league footage
   belongs to the league/broadcaster, and an athlete's identity used commercially needs their NIL permission.
   The content engine will want to blur this line constantly — write the rule once.
4. **Music policy**: facility content will be shot fast and loose — the "library tracks or in-house only"
   rule applies doubly, and check the subscription tier covers multiple channels (main + clips + Neptune)
   — the single-channel limit is the most common accidental breach.

**The synergy play, stated precisely:** Neptune content on More Mayday is not brand fluff — it's the
cost-per-outcome winner. Instrument it: promo codes / booking links per video, `cost per Neptune lead` per
format in the per-video P&L. If a training-content video generates leads at <$50 while sports AdSense pays
$7 CPM, the strategic weighting of the calendar changes — and you'll have the number, not the vibe.

---

## 7. Mayday Studio app: the ops roadmap this implies

Frequency-weighted, shippable-with-AI-assistance increments:

| Priority | Feature | Why (framework) |
|---|---|---|
| Now | Gate fields on project cards: locked title/thumbnail, Go/Kill/Hold log, kill-rate stat | Stage-Gate; packaging-first greenlight (doc 01) |
| Now | `cost_cents` + hours per project card → per-format contribution report | Per-video P&L (doc 11) |
| Now | Repair/backfill Substack + Fourthwall syncs | Attribution honesty (doc 11) |
| Now | Renewal automation: task 30 days after final sponsor deliverable | Renewal pipeline (doc 09) |
| Next | Freelancer performance ratings + per-skill bench view in Freelancers.js | Bench-as-asset (doc 08) |
| Next | WIP limits / stage caps + cycle-time stat on the project board | Little's Law (doc 01) |
| Next | Music-track log column per video; release-tracking table for on-camera guests/athletes | Claims defense in minutes (doc 12) |
| Next | Gate 3 publish checklist incl. FTC disclosure + repurposing package | Publish gate (docs 01, 12) |
| Later | Neptune module: lesson calendar, coach utilization %, membership tiers/churn | Facility = utilization business (docs 03, 11) |
| Later | Cost-per-outcome per format (Neptune leads per video via promo/booking links) | Cost-per-outcome ROI (doc 11) |

The productization option (selling the app to other creator teams) gets *more* credible with every one of
these — per-video P&L and a freelancer bench with ratings are exactly what Tier 1–2 studios lack — but it's
a Later conversation; a third business now would violate the one-new-stream-at-a-time rule you're applying
everywhere else.

---

## 8. Sequenced: Now / Next / Later

**Now (next 30 days)**
1. Concept + greenlight gates live on the Projects board; start logging kills.
2. Agency audit: 12 months of deals vs. the pricing formula; commission vs. lift math; contract-clause check.
3. Per-video cost capture (even a spreadsheet week one, then the app fields).
4. Fix Substack/Fourthwall syncs.
5. Neptune trademark clearance search + filing kicked off; release template drafted.
6. Two paid test projects to build clip-editor bench depth behind David.
7. FTC disclosure added to the publish checklist.

**Next (this quarter)**
1. Renewal pipeline + automation; rate card with usage-rights line items the agency must sell from.
2. Producer/ops hire decision (fractional first if cash says so).
3. Three-horizon calendar + kill criteria on every recurring series; batching shoot days.
4. Picture-lock + two-round revision policy in every editor brief; naming enforcement in Organize.
5. Neptune pricing model built from the utilization floor; seasonality/off-season program plan.
6. Substack fed weekly from the repurposing package; annual-plan push.

**Later (6–12 months)**
1. Neptune module in the app (lesson calendar, coach utilization, membership churn).
2. Cost-per-outcome instrumentation → calendar reweighted toward Neptune-lead formats.
3. First merch *drop* tied to a Neptune/content moment, measured properly.
4. Cohort-based Neptune digital program (only after the facility runs).
5. Revisit app productization with real internal proof.

---

## 9. What I'd need to know (answers change the advice)

1. **Revenue mix and totals** — last 12 months by stream (sponsors, AdSense, Substack, Fourthwall, other).
   If sponsors are >60%, diversification urgency rises; if any single sponsor is >30% of revenue, renewal
   risk becomes the #1 agenda item.
2. **More Mayday's recent-average views and audience geography** — the two inputs that set every sponsor
   rate. Also: what CPM is the agency actually clearing per deal?
3. **The agency deal terms** — commission %, exclusivity, who owns the brand relationships. The audit in §3.2
   can't run without this.
4. **Publish cadence and true team hours** — videos/month by format and who spends how many hours where.
   Sets WIP limits, break-even output, and whether the producer hire is overdue or premature.
5. **Neptune's fixed-cost stack and capacity** — lease, buildout capex, coach comp model, cage/lane count,
   drive-time population. Without these the pricing floor in §6 is a shape, not a number.
6. **Neptune's target customer** — youth (parents pay, minors on camera, release burden high) vs. adult/pro
   (higher rates, NIL upside)? Changes pricing, programming, and the content strategy feeding it.
7. **Substack + Fourthwall actuals** — list size, free→paid %, merch units/margin. Blind until the syncs are fixed.
8. **Whether app productization is a real ambition or a maybe** — it changes how much polish vs. speed the
   Now/Next app features deserve.
9. **Your imputed hourly rate and hours per video** — the most-lied-about number in creator businesses; the
   per-video P&L is fiction without it.

— Carl

*Sources: media-operations/01 through /12 (all present, all drawn on; heaviest: 01, 02, 03, 08, 09, 10, 11, 12).*
