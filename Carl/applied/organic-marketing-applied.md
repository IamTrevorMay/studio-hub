---
title: Organic Marketing Applied to Mayday + Neptune
domain: applied
source_domain: organic-marketing
tags:
  - mayday-media
  - neptune-performance
  - mayday-studio-app
  - youtube
  - short-form
  - newsletter
  - local-marketing
  - analytics
last_updated: 2026-07-12
---

# Organic Marketing Applied to Mayday + Neptune

This is Carl's translation of the 12 organic-marketing reference docs into a playbook for the actual
businesses: **Mayday Media** (More Mayday + clips + IG/TikTok/Twitch/Substack/Fourthwall + agency-sold
sponsorships), **Neptune Performance** (baseball facility in buildout), and the **Mayday Studio app**
(where the workflows should live). Where I assert a number, it comes from a reference doc; where I
assert a fact about your business, it comes from `context/mayday-context.md` — correct me there if
I'm wrong.

## TL;DR

1. **Rebalance the More Mayday production week toward ideation + packaging.** Small creators run
   95/5 production-to-packaging; top channels run ~70/30. Draft 8–20 title/thumbnail pairs and lock
   packaging *before* the Beat Sheet stage, not after the edit. This is the single highest-ROI change
   available and it costs zero dollars (see organic-marketing/01-youtube-growth-strategy.md).
2. **Turn PostShow into an editorial clipping machine, not a chronological one.** 5–7 payoff-hunted
   clips per episode, every clip re-hooked to land in 2.5 seconds, 3–5/week per platform sustained,
   TikTok → Shorts → Reels staggered, zero watermarks. Hybrid channels grow ~41% faster and Shorts
   now feed long-form recommendations directly (see organic-marketing/02-short-form-strategy.md).
3. **Neptune's marketing clock started when the lease was signed.** Google Business Profile live
   today, a capped founding-member presale 6–8 weeks before doors open, and a team/league partnership
   target list built now. One 12U travel team deal = 11–13 families spending $1–5k/yr each
   (see organic-marketing/10-local-marketing-facility.md).
4. **The facility is Mayday Media's next great YouTube format.** A physical lab + an ex-MLB pitcher
   is a "one of one" structural advantage no competitor can copy. Buildout-to-launch is a
   documentary arc; transformations and tiered challenges are native YouTube formats. Neptune content
   funds itself in reach before the doors open.
5. **Fix the Substack flywheel and treat the list as the #1 owned asset.** The sync is dead (per
   Known Issues), which means the most important owned-audience metric in the company is currently
   invisible. Email-on-upload creates the view burst that tells YouTube to push wider; the newsletter
   is also second sponsor inventory the agency should be selling (see organic-marketing/06-email-newsletter-growth.md).
6. **Reframe the IG "Do this more" stories goal.** Stories reach 1–8% of followers — they're a
   retention/CRM surface, not growth. Keep the daily habit, but the growth lever on IG is Reels
   engineered for sends-per-reach, tested via Trial Reels (see organic-marketing/03-instagram-organic.md).
7. **Institutionalize a 30–45 min weekly analytics review with a decision log**, one north-star
   metric per platform, built on the `platform_daily_metrics` data you already sync. Analytics
   without a written decision attached is entertainment (see organic-marketing/12-analytics-experimentation.md).
8. **Say no to everything else for now:** no community launch, no blog SEO, no X/LinkedIn effort
   tier, no category-creation branding exercise. All defensible plays, all later.

---

## Part 1 — Mayday Media

### 1.1 The core diagnosis frame

Every underperforming More Mayday video gets read through the diagnostic tree
(organic-marketing/01, §2.3): low impressions + normal CTR/retention = idea problem; healthy
impressions + low CTR = packaging problem; CTR fine + 30-second cliff = promise mismatch; steady
mid-video bleed = pacing. Benchmarks to hold: 4–6% CTR is platform average (read it **per traffic
surface** — browse 2–5%, suggested 7–12%, search 10%+), and a 10-point retention gain correlates
with ~25%+ more impressions. Never diagnose from a single number; always CTR × AVD as a pair
(organic-marketing/12, §3).

### 1.2 Packaging-first production (Now)

The pipeline in the app runs concept → production stages. Insert a hard gate: **no project card
moves past concept until packaging is locked.**

- Per video: 8–20 title/thumbnail pairs drafted, top 2–3 thumbnails sketched (≤3 elements, bright —
  60–70% of viewers are in dark mode — subject ~60% of frame, readable at 120px), cold feedback from
  someone who didn't pitch the idea, winner locked. Then the script is written *to deliver that exact
  promise in the first 30 seconds* (organic-marketing/01, §7.1; organic-marketing/09).
- Title rules: under ~65 characters, one idea, title and thumbnail never repeat each other —
  thumbnail shows the situation, title adds the stake or number.
- **Write a view prediction before publish.** Calibrating predictions is the actual skill; without
  them every miss feels random.
- Openings: first 5 seconds visually confirm the thumbnail, stakes by 0:30, no traditional intro,
  re-hooks planned near minutes 3 and 6. Target 70%+ retention at 0:30.
- Underperformers get a packaging refresh via Test & Compare (7–10 days) — officially penalty-free,
  and only worth running on videos likely to clear ~1,000 views in the window.

**App implementation (cheap, high-frequency):** add three fields to `projects` — `packaging_locked`
(boolean gate surfaced on the card), `predicted_views`, and `actual_views_7d` (auto-filled from
`platform_daily_metrics`). A "prediction vs. actual" column in Analytics turns the team into a
calibration engine within a quarter.

### 1.3 Ideation: outliers, not vibes (Now)

- One hour a week, minimum, of **outlier research**: videos running 5–50x their channel's baseline
  in and adjacent to the niche. Steal the *format mechanism*, never the topic — transplant challenge
  and tiered-comparison formats from fitness/golf/car channels into baseball ("$50 vs $5,000 bat,"
  "Pro pitcher rates viral pitching hacks," "10 minutes / 1 hour / 24 hours of mechanics work").
  The vidIQ outlier tooling is already wired into this environment — use it.
- **App implementation:** the Research system already runs `fetch-rss` + `generate-trends` daily.
  Add an outlier log — a lightweight table (`research_outliers`: url, channel, views, subs,
  multiplier, format_mechanism, our_angle) feeding the concept stage. The ideation matrix (4A:
  Actionable / Analytical / Aspirational / Anthropological × pillars) belongs in the same view
  (organic-marketing/04, §2).
- Galloway's 80/20 rule: ~80% of uploads serve the proven audience cluster; ~20% are deliberate
  experiments. When a format works, **run it until they stop you** — don't abandon it out of boredom.

### 1.4 Short-form: the clip machine (Now)

Short-form's direct revenue is a rounding error ($0.01–$0.10 Shorts RPM vs $8–20 long-form CPM).
Its jobs here are (a) funnel into More Mayday long-form, (b) inflate total-reach numbers in the
agency's sponsor decks, (c) later, local lead-gen for Neptune. Operate accordingly
(organic-marketing/02):

- **Per episode:** harvest 20–40 AI candidates, human-select 5–7 finals. Selection criteria:
  contrarian takes, complete micro-stories, emotional spikes, specific numbers. One clip = one idea.
  Never clip chronologically.
- **Every clip re-hooked:** strongest line first even if it means reordering, text overlay that works
  on mute, cut every 2–4 seconds, payoff at ~80–90% of runtime.
- **Cadence:** 3–5/week per platform, sustained. Burst-then-gap is the single most damaging pattern —
  a steady 3/week beats a heroic 7-then-zero.
- **Cross-post protocol:** TikTok first (fastest cold feedback), Shorts 2–4h later (search tail —
  Shorts compound for weeks while TikToks die in 72h), Reels last. No watermarks, ever — Reels
  detects and buries them.
- **Funnel architecture on every Short:** related-video link attached, pinned comment with the
  episode, verbal CTA after the payoff. Mix ~70% standalone-value / ~30% direct teasers posted within
  24–48h of the long-form upload to ride the recommendation bridge.
- **The audience-match test on every clip:** "would the person who loves our long-form watch this?"
  A viral off-audience Short is net-negative — it pollutes the viewer cluster YouTube builds around
  the channel.
- **Retention gates:** >80% held at 3 seconds, swipe-away under 25%; anything over 35% swipe-away is
  a hook failure regardless of content quality.

**App implementation:** the Clip Video automation already creates a task for David Korn on
`new_video`. Extend it into a checklist-bearing task (the pre-publish checklist from
organic-marketing/02, §8) and add a clips-per-episode counter to the weekly review. PostShow is the
natural home for the "harvest → select → re-hook" workflow.

### 1.5 Instagram: two separate games (Now/Next)

Instagram is unconnected reach (Reels/Explore) and connected depth (Stories/DMs) — different
content, different metrics (organic-marketing/03):

- **Keep the daily-story goal** (the "Do this more" widget is doing its job) but grade it as
  *retention*, not growth: story replies and DMs are the win condition, because replies permanently
  improve tray position with that viewer. Add one interactive element (poll/question) per day's
  stories.
- **Growth = Reels designed for sends-per-reach** — Mosseri has confirmed sends are the most
  weighted signal for non-follower distribution. Design question per Reel: "who would DM this to
  whom?" For baseball content the answer is usually "a parent to another parent" or "a player to a
  teammate" — that's a very designable share.
- **Use Trial Reels aggressively** (non-followers only, auto-share if it performs): perfect for
  testing Neptune training content against the Mayday entertainment audience before committing the
  grid, and for hook A/Bs. Schedulable since Feb 2026 — batch a week of trials in one sitting.
- Carousels are the save engine (highest ER of any format); add audio by default for free Reels-feed
  distribution. Post 3–5 Reels/week; images are filler.

### 1.6 Newsletter: fix the pipe, then pull the lever (Now → Next)

- **Now:** repair the dead Substack sync (flagged in memory as genuinely dead) — you cannot manage
  an asset you can't see. Judge by **click rate, never opens** (Apple MPP makes opens fiction;
  median click ~2.1%, media newsletters ~4%).
- **Now:** email the list within hours of every More Mayday upload. The email → view-burst →
  algorithm-push → new-subscriber loop is the cheapest distribution multiplier in the whole
  operation (organic-marketing/06, §1).
- **Next:** one lead magnet mentioned verbally in the first 60 seconds of videos (converts 1–3% of
  viewers, up to 6% with tight topic match). For the Mayday audience: something checklist/template
  shaped, not an ebook — template magnets convert ~2.5x better. A 3–5 email welcome sequence
  (magnet → origin story → best hits → question → soft offer); ~30% of subscribers churn in 90 days
  without one.
- **Next:** hand the agency a rate card for newsletter placements. Sponsorships beat paywalls as the
  dominant newsletter model (77% of new publications sell ads); $20–40 CPM on engaged opens, and
  "YouTube integration + newsletter placement" bundles raise every deal. Also: Fourthwall checkout
  opt-in → list. Free growth, zero effort.
- **Neptune-specific:** start a separate local list (parents/players) from day one of presale. An
  email that fills a lesson opening same-day is the cheapest bookings channel a facility can own.

### 1.7 Platform triage: what NOT to work (standing policy)

Per the triage framework (organic-marketing/11): YouTube is the Tier-1 effort platform. TikTok/IG/
Shorts are Tier-1-adjacent because they're fed by the clip machine at near-zero marginal cost.
Everything else:

- **Twitch:** conversion engine, not discovery — <1% organic discovery for small streams. Keep it as
  a superfan/community surface fed by clips; never plan growth through it.
- **X / LinkedIn:** Tier 2 syndication at most (<2 hrs/week total). X only becomes interesting as a
  founder personal-brand play (replies economy: a reply is worth ~27x a like), and only if Trevor
  personally wants to be there. Not a team assignment.
- **Blog/web SEO for Mayday:** skip. YouTube search + brand is the SEO play — YouTube presence has
  the strongest single correlation (~0.737) with AI-search visibility, which is where discovery is
  drifting (organic-marketing/05).
- Kill rule: quarterly review; two quarters with no movement on a named metric → demote the platform.

---

## Part 2 — Neptune Performance

Neptune is a **proximity + proof + relationships** business. The addressable market is a 15–20
minute drive radius, which means you can saturate it with zero ad spend — and it means national
Shorts virality is worth less than 3,000 views from local parents (organic-marketing/10, /02 §1).

### 2.1 Presale (Now — starts immediately, not at launch)

- **GBP live the day there's an address.** Primary category is the single most important field
  (~86% of profile views come from discovery searches) — check what winning local competitors use
  ("Baseball club" / "Sports complex" / "Batting cage center"). 20+ real photos at launch, buildout
  photos monthly (the buildout is content), NAP consistent everywhere, seed 5–10 Q&As. Local-pack
  movement takes 3–6 months, which is exactly why it starts now.
- **Founding-member offer:** capped (e.g., 100 slots), locked-in rate, billing starts at grand
  opening. 6–8 week presale window minimum. Best operators open at 40–100+ members. This belongs in
  the BD page's Marketing & Brand workstream as a milestone with a date, today.
- **Partnership target list built during buildout:** travel/club teams (one 12U team = 11–13
  families at $1–5k/yr each; the coach's endorsement carries the sale), rec leagues ($300–1,500
  division sponsorship = jersey logo + link + email mention + opening-day table), high-school
  coaches and ADs visited in person, plus a free coaches' clinic as the opener. Sell to the parent
  network, not the individual parent — the top enrollment drivers are the kid's interest, proximity,
  and "friends in the program," and a team deal delivers all three.

### 2.2 Reviews and referrals (from day one of operations)

- **Review engine:** ask every customer, systematically. Velocity beats totals — ~4+/week beats a
  big count; 47% of consumers won't use a business with under 20 reviews and 74% want reviews from
  the last 3 months. Respond to 80%+ of them. This is also the AI-search play: local "ask ChatGPT
  for a recommendation" behavior jumped 6% → 45% in a year and AI answers draw on review detail.
- **Referral program at steady state:** designed incentive + explicit ask + automated reminders (all
  three). Well-run gym referral programs convert ~41% and drive 30–50% of new memberships. Below
  ~1.0 referrals/member/year, the cheapest channel is idle.
- **Attribution from day one:** mandatory free-text "How did you hear about us?" on every intake and
  booking form (Supabase-backed, per house rules), plus promo codes per partnership. The facility
  north star is **attributed inquiries per month**, not impressions (organic-marketing/12, §2).

### 2.3 Positioning (Next)

Run the Dunford sequence, in order (organic-marketing/08): competitive alternative #1 is the status
quo — *a dad and a bucket of balls*, plus the existing hitting coach circuit. Neptune's provably
unique attributes: ex-MLB pitcher on site, data/tech-forward lab (the "Performance" in the name),
and a media engine no local competitor has. Who cares most: travel-ball families already spending
$3–5k+/yr who are buying *development, a pathway, and a community* — not price-shopping a $99
membership. Price accordingly. Big fish, small pond: niche-positioned facilities show ~23% lower
churn than generalists and 41% of members travel farther for a specialization — do **not** open as
a generic "sports training center." Own pitching/velocity development first; widen later.

### 2.4 Neptune × Mayday content engine (Next)

- **The buildout is a series.** Document it now: "Building a pro baseball lab" is a documentary arc
  with built-in stakes and a launch-date payoff, and it presells memberships while growing the
  channel.
- **Facility formats for the main channel:** transformations ("We rebuilt this 15-year-old's
  mechanics in 30 days"), tiered comparisons, "pro rates X," athlete before/afters. These are the
  "one of one" advantage — access + credibility + a building competitors can't clone
  (organic-marketing/01, §6.4). The Feb 2026 browse-cluster overhaul explicitly favors tight niches.
- **Channel architecture (Beaupré's rule — same audience, same channel):** national baseball-dev
  content lives on More Mayday, where Trevor's audience already skews baseball. Neptune gets its own
  **local Instagram + GBP + email list** (job: lead-gen, measured in inquiries per 1,000 *local*
  views), not its own YouTube channel at launch. Revisit only if analytics show the facility content
  attracting a genuinely different cluster.

### 2.5 Community (Later, deliberately)

A members' community is the natural Neptune moat — SPACES objective: **Success** (players getting
measurably better is what retains paying families) (organic-marketing/07). But ~83% of communities
die within a year and founder-led-everything is the #1 failure mode. Defer any formal community
launch until the facility has operating rhythm; start instead with one **ritual** (a weekly members'
session or leaderboard drop) and let identity accrete around it.

---

## Part 3 — The operating system (Mayday Studio app)

The app is where this stops being advice and becomes default behavior. Frequency-weighted build
order:

1. **Weekly review ritual (Now, zero code):** 30–45 minutes, same day weekly, fixed agenda —
   distribution → packaging → retention → audience → conversion — ending in 1–3 written decisions.
   Data source: the Analytics page + `platform_daily_metrics`. Add a `review_decisions` log so
   decisions are searchable. One north star per platform: YouTube = watch time from returning
   viewers; short-form = shares + non-follower reach; newsletter = click rate + cohort retention;
   Neptune = attributed inquiries (organic-marketing/12).
2. **Packaging gate + prediction fields on project cards (Now, small):** §1.2. Highest-frequency
   workflow in the company; smallest change with the largest compounding return.
3. **Clip checklist in the Clip Video automation + PostShow (Now, small):** §1.4.
4. **Outlier log in Research (Next, medium):** §1.3 — sits beside `research_trends`, feeds concepts.
5. **Cadence guardrail automation (Next, small):** the Automations engine can flag burst-then-gap —
   e.g., "fewer than 3 shorts published in the trailing 7 days" → task. Consistency is the metric
   the algorithms actually punish you on.
6. **Neptune CRM-lite (Next, medium):** intake forms with HDYHAU, review-ask automation (post-visit
   task or email), referral tracking, partnership pipeline — plausibly a BD-page extension or a
   small dedicated page. All Supabase, per the no-localStorage rule.
7. **Prediction-vs-actual and pillar tagging in Analytics (Later):** tag every project with a
   content pillar; read performance *by pillar and by format* quarterly, kill the bottom format,
   double the top one.

Note on data hygiene: the weekly review is only as good as the syncs. `sync-youtube` staleness for
More Mayday and the dead Substack/Fourthwall syncs (Known Issues / memory) are now *marketing*
problems, not just engineering chores — prioritize them like revenue bugs.

---

## Sequencing summary

**Now (next 30 days)**
- Packaging-first gate + 8–20 title/thumb pairs + view predictions on every More Mayday video
- Clip machine discipline: 5–7 editorial clips/episode, 3–5/wk/platform, funnel links on every Short
- Weekly analytics review with decision log; fix Substack sync; email-on-upload
- Neptune: GBP live, founding-member presale designed, partnership target list built, buildout
  documentation starts
- IG: keep daily stories (retention), start Trial Reels testing (growth)

**Next (this quarter)**
- Lead magnet + welcome sequence; newsletter on the agency rate card; Fourthwall checkout opt-in
- Outlier log + 4A ideation matrix in Research; define 3–5 content pillars and tag projects
- Neptune positioning workshop (Dunford, status quo as competitor #1); local IG + local list live;
  review engine + HDYHAU live at first customer
- One facility-format series shipped on More Mayday; cadence guardrail automation

**Later**
- Neptune members' community (Success-objective, ritual-first)
- Prediction-vs-actual + pillar analytics; format portfolio review cadence
- AI-search/topical-authority play (YouTube already does most of this work for you)
- Founder personal-brand X play — only if Trevor wants it personally

---

## What I'd need to know (facts that would change this advice)

1. **More Mayday's actual numbers:** views/video trend, CTR by traffic surface, retention curves,
   new/casual/regular viewer mix, upload cadence over the last 90 days. If retention is already
   elite, the priority flips from packaging to ideation ceiling.
2. **Where the audience lives:** geographic distribution of More Mayday viewers. If a meaningful
   slice is within driving distance of Neptune, the channel is a direct booking engine and the
   "national content / local capture" split gets rebuilt.
3. **Substack reality:** list size, click rate, growth rate. Under ~2k engaged, the newsletter is a
   flywheel component; over ~20k it's a sellable inventory line that changes the agency conversation.
4. **Sponsorship structure:** flat-fee vs. CPM, current deal sizes, whether reach or audience
   quality is what the agency actually sells. This decides how much short-form reach is *worth*.
5. **Neptune specifics:** launch target date, drive-radius demographics (youth baseball density,
   travel-team count), competitor set, planned price points and capacity model. The presale design
   depends entirely on these.
6. **Team capacity:** who owns thumbnails/packaging today, and how many hours/video. The 70/30
   rebalance is a people question before it's a process question.
7. **Twitch's real role:** hours streamed, concurrent viewers, revenue. If it's meaningful, the
   community sequencing moves earlier; if vestigial, it's a Tier-3 kill candidate.

---

*Reference docs drawn on: organic-marketing/01 (YouTube growth), 02 (short-form), 03 (Instagram),
04 (pillars & repurposing), 05 (SEO/AI search), 06 (email), 07 (community), 08 (positioning),
09 (hooks/copy), 10 (local facility), 11 (platform triage), 12 (analytics). All last_updated
2026-07-12 — flag for refresh mid-2027 or on any major platform algorithm change.*
