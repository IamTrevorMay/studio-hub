---
title: The Weekly Publishing Schedule & Trend-Ops System
domain: applied
tags:
  - weekly-schedule
  - posting-times
  - trend-ops
  - jump-adapt-skip
  - mlb-calendar
  - metricool
  - postshow
  - sprint-planning
  - more-mayday
  - trevor-may-baseball
last_updated: 2026-07-12
---

# The Weekly Publishing Schedule & Trend-Ops System

One integrated operating system for the actual accounts: what posts where, when (PT), who decides
on trends and how fast, how the MLB calendar bends everything, and which Mayday Studio surface
executes each piece. Grounded in the live channel audits (`../audit/`, data pulled 2026-07-12) and
first-party Supabase metrics. Sibling playbooks own the craft detail: packaging and retention in
../applied/youtube-longform-playbook.md, per-platform short-form specs in
../applied/short-form-playbook.md. This doc owns the **calendar and the decision system**.

## TL;DR

1. **Fix Trevor May Baseball's cadence before touching anything else.** TMB is 179K subs with a
   ~47K median video, but uploads slid to ~1.2/week with 8–19-day gaps — and June views fell 47%
   from May (1.58M → 836K). 44.6% of lifetime views come from browse/subscriber feed; irregularity
   directly starves that surface. One fixed flagship slot: **Tuesday 11am PT**, never skipped.
2. **Protect More Mayday's 3/week machine — it's the compounding asset.** MM is +300% subs YTD
   (4.2K → 16.6K), median 17.3K views on 16.6K subs (1.04 views/sub — browse/suggested is
   working), but long-form drifted from ~3/wk in May to ~2/wk in July, into deadline season.
   Wrong moment to slow down. Slots: **Sun 7am, Wed 12pm, Fri 12pm PT**.
3. **Route topics by proven multiplier, not habit.** News/prediction commentary averages 0.4–0.7x
   on TMB (18–33K) while insider/first-person formats do 2–5x (90–232K); on MM the opinion-rant
   listicle did **5.46x** (94K) while unnamed-subject titles did 0.21–0.34x. TMB = insider/
   challenge/evergreen; MM = the news grind + one high-stakes opinion listicle per week.
4. **Rebuild the MM Shorts mix.** 33 of the last 48 MM Shorts sit under 5K views (median ~3,100);
   the 10K+ tier is all star-player anomalies, Tyler Rogers mechanics, and CBA/insider takes.
   Kill the daily single-team check-in Short; same effort, 3–7x the ceiling.
5. **Anchor the clock to ET, execute from PT.** ~77% of the US audience is ET+CT and sports skews
   evening-east: the Comscore sports window (8–10pm ET = 5–7pm PT) runs ~5x morning engagement.
   Never schedule on PT-evening instinct — 8pm PT is 11pm ET.
   (see ../cross-platform/01-posting-time-master-matrix.md)
6. **Run the 15-minute trend scan at 8:15am PT daily**, right after the `generate-trends` cron
   (8am PT) drops the Claude brief in Research. Fixed circuit, log-don't-decide, then one batch
   Jump/Adapt/Skip pass. Default is Adapt with an authority/access/persona layer; two gate fails
   = Skip. (see ../cross-platform/02-trend-decision-framework.md)
7. **The trade deadline is July 31 — 19 days out — and "10 MLB Trades, GUARANTEED" already did
   2.32x (40K) at 175 views/hour.** Pre-build the deadline shells this week (reaction formats,
   title templates, thumbnail frames, a TMB "deadline from a player's seat" long-form). Reactive
   speed is preparation, not fast hands.
8. **Restore measurement on July 25.** vidIQ credits reset 2026-07-25 (currently 0/150, free
   plan); only TMB is authorized and the competitor list is empty. Sprint task with a due date:
   authorize More Mayday, seed 5–10 competitors, run the refresh runbooks in all four
   `../audit/` docs (~150 credits). Until then, CTR/retention decisions run on the Supabase
   warehouse + Studio hand-pulls only.

---

## 1. The accounts, as they actually are (2026-07-12)

YouTube numbers from the live audits (`../audit/trevor-may-baseball-channel-audit.md`,
`../audit/more-mayday-channel-audit.md`); other platforms from the app's Supabase warehouse
(`platform_daily_metrics` / `audience_snapshots`), same pull date.

| Account | Size | Trend | Key number | Read |
|---|---|---|---|---|
| **Trevor May Baseball** (YT) | 179K subs, 29.3M views | +16.4% subs YTD, but views 1.58M (May) → 836K (Jun) | Median long-form **~47K**; insider formats 90–232K, news pieces 18–33K | The engine. Outlier-driven: a hit lifts everything ~6 weeks, then decays. Cadence slipped to ~1.2/wk with 8–19-day gaps |
| **More Mayday** (YT) | 16.6K subs, 3.37M views | **+300% subs YTD** | Median long-form **17.3K** = 1.04 views/sub; Shorts median ~3.1K | Fastest-compounding asset; ~2.5 long-form/wk + 1.3 Shorts/day, never goes dark. Shorts are the weak leg |
| **@trevmay65** (IG) | 285.7K | −553/30d | 852K views/30d, ~2.8% like/view | Biggest audience, shrinking. Reach without conversion — its job is discovery + routing to YT |
| **IamTrevorMay** (TikTok) | 194.5K | −42/30d | 324K views/30d, 79 comments/30d | Flat and conversation-dead. Clip-funnel surface |
| **iamtrevormay** (Twitch) | 187.1K | sync reads 0 | — | Metrics pipe dead; live-only until told otherwise |
| **Facebook page** | 4.8K | 7d views = **0** (90d: 175K) | — | Sync died or posting stopped — diagnose week 1; it's the cheapest surface for Neptune's parent demo |
| **Threads** | 29.7K | +13/30d | — | Second-screen text, pairs with X on game nights |
| **Mayday! podcast** | — | dormant since 2026-03-14 | 68–81-min VODs did 2.1–5.3K at 0–28% retention on TMB | Out of the flagship feed (see §2 note) |
| **Substack** | 2,667 | sync stale since 3/5 | — | Weekly send, judged on clicks only |

Two structural facts from the audits that shape the whole schedule:

- **Traffic identity:** TMB = browse/subscriber channel (44.6% browse, 31.2% Shorts feed, search
  only 3.2%); MM = Shorts-first (49.7% Shorts, 34.9% browse). TMB lives and dies on cadence
  regularity; MM lives on volume + packaging.
- **Shorts convert ~zero subs on TMB** (best Shorts: 0–8 subs each vs 263–368 for long-form
  outliers) — Shorts are reach, not growth, until every one carries the Related Video link,
  pinned comment, and a long-form parent (see ../youtube-shorts/03-shorts-channel-strategy-funnel.md).

---

## 2. The master weekly schedule (all times PT; ET in parens)

Built from the sports-evening overlay, the two-lane rule (scheduled lane batched Sunday, reactive
lane live), and current team capacity (~2–3 people ≈ 25 touches/wk ceiling). Hold every slot 4–6
weeks and judge on medians; the derivation protocol is §3 of
../cross-platform/01-posting-time-master-matrix.md.

| Day | Time (PT) | What | Where | Why |
|---|---|---|---|---|
| **Sun** | 7:00am (10am ET) | **More Mayday long-form #1** | YouTube | Buffer's #1 long-form slot (Sun 10am ET); lean-back weekend viewing; clears the day before game windows |
| Sun | 9–11am | **Batch session**: build the whole week in Metricool (check per-account "Best times" heatmap first), stage the week's Shorts in Studio | Metricool + YT Studio | One session; the only unscheduled content all week is the reactive lane |
| Sun | 3pm (6pm ET) | MM Short (cut from Sunday's video, Related Video link set) | YT Shorts | Evening scroll; same-day long-form+Short is fine staggered AM/PM |
| **Mon** | 8:15am | Daily trend scan (15 min) + **weekly deep scan (+20 min Mondays)** | See §3 | Format-trend radar; Monday adds the 30-day Creative Center view + outlier sweep |
| Mon | 3–5pm (6–8pm ET) | TikTok #1 + Reel #1 — weekend-game reaction or the week's Adapt | TikTok, IG | Monday is a top TikTok day; second-screen evening window |
| **Tue** | 11:00am (2pm ET) | **Trevor May Baseball long-form — THE fixed flagship slot** | YouTube | 2–3h ahead of the 6–9pm ET viewing peak so indexing/notifications land first; dodges 7:05pm ET game starts. This slot never moves and never skips — June's 8–12-day gaps tracked a 47% view drop |
| Tue | 5pm (8pm ET) | IG feed post or carousel | IG | The Comscore 5x sports window, Tue–Thu strongest |
| **Wed** | 12:00pm (3pm ET) | **More Mayday long-form #2** | YouTube | Midweek browse slot, pre-evening-peak |
| Wed | 3pm (6pm ET) | TMB Short (clip of Tuesday's video, Related Video → parent) + TikTok #2 | YT Shorts, TikTok | The deliberate Short→parent pairing the audit says is missing ("Relievers are weirdos" 189K had a 112K parent and pointed nowhere) |
| **Thu** | 6am (9am ET) | Facebook **native** post (never the IG crosspost toggle) + Substack send | FB, Substack | FB 9am–12pm ET consensus window; newsletter judged on clicks |
| Thu | 5pm (8pm ET) | Reel #2 — best clip of the week, re-cut hook, native captions | IG | The 5x window again |
| **Fri** | 12:00pm (3pm ET) | **More Mayday long-form #3** (in-season; first slot to drop offseason) | YouTube | Keeps MM at the ~3/wk that built the +300% YTD run |
| Fri | 1pm (4pm ET) | **Hero Short of the week** (best clip, Tier-2 edit) | YT Shorts | Buffer's single best Shorts slot; Friday is Shorts' best day |
| Fri | 3–5pm | TikTok #3 | TikTok | Fri evening ET is a top TikTok window |
| **Sat** | 6am (9am ET) | TikTok #4 — weekend-morning scroll; pre-game angle on big slates | TikTok | Sports fans are weekend-active; Sat/Sun 1–4pm ET day games make mornings pre-game prime |
| **Game nights** | live | X + Threads second-screen takes; IG Story frames | X, Threads, IG | 45–80% of fans second-screen; credentialed instant reaction is the structural edge. Reaction only — no planned drops into game windows |
| **Daily** | 6am + across day | IG Stories: 3–7 slides, ≥1 question sticker, answer every reply | IG | Stories rank per-viewer; the "Do this more" widget enforces compliance — the managed metric is replies/day |
| **Daily** | 3pm (6pm ET) | MM Short — from the retargeted mix (see below) | YT Shorts | Holds MM's daily-Short identity (49.7% of its views are Shorts feed) |

**Weekly totals:** 4 long-form (3 MM + 1 TMB), 7–9 Shorts, 3–4 TikToks, 2 Reels, 1 carousel,
1 FB, 1 newsletter, daily Stories, game-night X/Threads ≈ 25 touches. That matches what the team
already ships — this is a reallocation, not a ramp.

**Topic routing (from the outlier tables, non-negotiable):**

- **TMB Tuesday slot rotation:** 3 of every 4 videos are insider-access ("Behind the scenes of
  MLB Travel" 5.0x / "according to players" 1.9x / "Brutal truths" 2.9x), first-person
  comeback/challenge ("I pitched for the FIRST time since MLB" 2.9x — serialize it), or a
  keyword-first evergreen explainer (search is 3.2% lifetime — untapped; queue in
  ../audit/keyword-search-gaps.md §6). The 4th can be a news take **only** with a first-person
  frame. Straight news commentary (0.4–0.7x, five of the last 30 videos) moves to MM.
- **MM weekly anchor:** one high-stakes opinion listicle per week — "N things I HATE / would
  change / GUARANTEED" is the channel's 5.46x format. Title rule enforced on every upload:
  **name a player/team OR a number OR a superlative** — the five worst MM videos (0.21–0.52x)
  all failed this, and the one text-free thumbnail was the second-worst video of the period.
  Spellcheck titles ("Fall of Famer," "cant," "think there be" all shipped).
- **MM Shorts mix (replaces the daily team check-in):** star-player anomalies (Cal Raleigh Short:
  21K), pitching-mechanics breakdowns (Tyler Rogers content drove 4 of the top Shorts), and
  CBA/lockout/insider explainers (14K, 8.3K). Team check-ins survive as one weekly "around the
  league" long-form (~1.0x format), not five sub-3K Shorts.
- **Podcast:** the Mayday! show stays out of both flagship feeds until relaunched deliberately
  (plan in ../applied/youtube-longform-playbook.md). Its best segments ship as 8–15-min topic
  cuts — that's exactly the material doing 80K standalone.

**Spacing rules:** ≥3–4h between same-platform posts; a repurposed clip publishes **TikTok →
Shorts → Reels staggered 2–24h**, each with a re-cut native first frame, never a watermark
(40–70% reach penalty) (see ../cross-platform/04-repurposing-pipeline.md). Missed slot = skip,
never double-post; self-competition splits the velocity signal.

**YouTube publish checklist (every upload):** private upload 12–24h early → title passes the
naming rule → thumbnail carries a 1–3-word text overlay → Test & Compare on (CTR is otherwise
invisible — impressions only enter the warehouse by CSV) → chapters ≥3 on anything 8min+ →
keyword in first description sentence → end screen with 2 elements, verbally sold (end screens
are 0.2% of TMB traffic — unused free distribution) → Shorts: Related Video link + pinned
comment + last-3s CTA → auto-dub ON (see ../youtube-longform/08-publishing-mechanics-metadata.md).

---

## 3. The daily trend scan — 15 minutes, 8:15am PT

The `generate-trends` cron fires at 8am PT and drops the Claude brief into the Research page.
The human scan starts there and adds what RSS can't see. One owner, rotated monthly, with
standing Jump authority (see §4). The scan **collects and logs**; decisions happen once, in batch.

| Min | Surface | What you're looking for |
|---|---|---|
| 0–2 | **Research page** (app) — daily trend brief + graded suggestions | Current-events angles mapping to a slot this week; anything graded high with a baseball angle |
| 2–5 | **IG Reels audio browser → Trending tab** + Professional Dashboard trending audio | Upward arrow + usage count: **100–1K uses = early, 1K–10K = the jump window, >30K = you're the punchline**. Bookmark candidates — the sound page's top executions are the spec sheet |
| 5–9 | **TikTok Creative Center** — Songs "Breakout" tab (7-day growth sort) + Hashtags filtered "New to Top 100," Industry: Sports | Breakout + still climbing = 3–5-day window. Check audience-insights age split against the 25–45 sports demo before logging |
| 9–12 | **YouTube Shorts Trends page** + **Studio → Research tab (content gaps)** | Rising sounds with room for a baseball version; content gaps = trend + search legs in one Short |
| 12–14 | **Outlier pass** — vidIQ Outliers via MCP once credits return (Jul 25): competitor set, last 7d, 3x+ multiplier. Until then: manual check of Jomboy, Foolish Baseball, Baseball Doesn't Exist, Eric Sim, Fuzzy + views-per-hour on 1–2-day-old uploads | A format repeating across 2–3 channels 2–5x Trevor's size = a format trend being born. One 20x fluke = ignore |
| 14–15 | **Log it** | One line per candidate into the Supabase trend log (§6): surface, usage count/velocity, stage guess, J/A/S call |

Ambient, not scheduled: baseball X (Pitching Ninja, Jomboy, team accounts), and "do the ___
trend" comments/DMs on Trevor's own posts — pre-validated demand. If a trend was first seen in
a weekly digest or on a morning show, it's stage 5: Skip-but-bank only.

**Monday deep scan (+20 min):** Creative Center 30-day hashtag trendlines, Studio content-gaps
review, breakout-channels pass, and the regret check — anything skipped last month that blew up
in-niche, and which gate call was wrong.

**TikTok→Reels lag is the standing arbitrage:** Reels trends run ~1–2 weeks behind TikTok. A
stage-2 TikTok spot is a free calendar note for the Reels window — never simulcast a trend piece.

---

## 4. Jump / Adapt / Skip — the 60-second gate, niche-tuned

Five gates per logged candidate, scored fast. **Two fails = Skip, no discussion.** Full scoring
rubric in ../cross-platform/02-trend-decision-framework.md §4.

1. **Niche fit** — the baseball/athlete-life/facility version is obvious in one sentence
   ("this audio over a bullpen montage"). Needing a paragraph = fail. Fit beats speed: 63% of
   marketers rank relevance #1; 33% of users find brand trend-chasing embarrassing.
2. **Audience overlap** — Creative Center audience insights vs the 25–45 sports demo. A trend
   skewing 13–17 non-sports = fail even at massive volume.
3. **Runway** — stage 2–3 tells: arrow + <10K uses, Breakout tab, format still mutating,
   mid-tier creators carrying it. Brands/news anchors participating = fail. Median trend
   lifespan is ~5 days; if it can't ship inside 24–48h, it's Adapt or Skip, never Jump.
4. **Effort** — ≤2 hours all-in with footage on hand, and it never displaces pillar content.
   Trend content caps at 10–20% of weekly short-form output.
5. **Risk — the Trevor gate, and it vetoes alone.** Nothing that embarrasses a retired MLB
   player, undermines Neptune's professional credibility, or touches politics, tragedy,
   gambling, or **another player's injury/failure** — peer respect is the access moat, and
   access formats are the 2–5x lane on both channels. Sponsored pieces: audio must carry the
   "Approved for business use" flag.

**Outputs:**

- **JUMP** — their template, baseball skin, shipped <48h, ≤2h. Rare on the established accounts;
  the future AWA/Neptune from-zero accounts are where Jumps pay most.
- **ADAPT (the Mayday default)** — keep the trend's container (audio sync points, cut pattern,
  caption format; signal it in second 1, land the twist by second 2–3, never explain it), swap
  the subject for owned material, and add one uncopyable layer: **authority** ("here's what's
  actually happening in that clip"), **access** (MLB footage, pro friends, facility), or
  **persona** (retired-pitcher comedy). No layer = it's a Jump wearing a costume — downgrade
  its budget accordingly. Adapts can ship at stage 3–4: the baseball audience has seen the
  trend but not the baseball version.
- **SKIP** — the default outcome. One logged line, zero FOMO.
- **SKIP-BUT-BANK** — dead trend, live structure: strip the skin, file the format, deploy as
  evergreen later.

**Moment trends** (viral play, trade, ejection, rule controversy) are the niche's best class:
24–72h window, speed beats polish, and *the authority take IS the adaptation* — nobody else in
the comments pitched in the big leagues. X inside 90 minutes; TikTok/Reels raw-phone cut inside
2–4h (see ../tiktok/06-sports-athlete-niche.md). Both channels' data agrees: MM's 94K outlier
and TMB's 2–5x tier are all takes/access, never recaps. Pursue formal MLB×TikTok creator-program
access — a retired player is the exact profile, and it converts gray-area clips into licensed
footage.

**Sequencing one Adapt:** TikTok day 1–2 → Reels day 3–5 (the lag window) → Shorts day 4–7 if
the sound shows on the Shorts Trends page. One adaptation, three windows, three native cuts.

---

## 5. Seasonal overlays — the MLB calendar is the content calendar

**Right now (Jul 12):** All-Star break, **trade deadline Jul 31**. This week's sprint carries
the pre-build tasks: HR Derby reaction shell, "what this trade actually means" title/thumbnail
templates, deadline-day live X plan, and the TMB "deadline winners/losers from a player's seat"
video staged for <24h turnaround. The evidence this pays: "10 MLB Trades that will happen,
GUARANTEED" — 40K, 2.32x, 175 views/hour, the second-biggest MM video of the season.

| Window | Schedule changes | Trend-ops changes |
|---|---|---|
| **In-season (Apr–Sep)** | Long-form never publishes into 5–8pm ET (competing with broadcasts). X/Stories/TikTok gain during games. Sat/Sun mornings = pre-game prime | Moment lane at full alert: reactive posts within 30–90 min beat any slot. Weekly shells for the known calendar (series of the week, milestone watches) |
| **Deadline + ASG (Jul)** | Deadline day: scan owner goes fully reactive (X + Stories running commentary); scheduled lane runs untouched from the Sunday batch. TMB deadline video within 24h | Shells pre-built by Jul 25 (sprint due date). MM Shorts go 2/day on deadline week — the news-cycle Shorts finally have real fuel |
| **Aug–Sep races** | TMB topics shift toward October previews — search volume moves 2–3 weeks ahead of the event. Callup season: the evergreen "what getting called up feels like" lane re-promotes | Contender-collapse / clinch moments = 24h authority-take windows |
| **October playoffs** | Highest second-screen density of the year: same-night X + Shorts/TikTok reactions; long-form recaps next morning 5–7am PT (8–10am ET). Consider +1 TMB/wk during LCS/WS. **AWA Expansion launches 2026-10-01 into this window** — its warm-up calendar must not cannibalize the deadline-tested reactive lane | Shells staged per round. Postseason moments are near-auto-Adapt for an ex-closer ("closing a playoff game: what the pressure does to you" is a queued keyword idea) — gate 5 still applies |
| **Nov–Feb offseason** | Audience reverts to generic patterns — **re-pull all heatmaps in November and March**. Hot-stove news spikes at random hours: speed beats slotting. **This is Neptune's high season**: training/velocity/arm-care content peaks when players train (keyword clusters A/D in ../audit/keyword-search-gaps.md) — the facility buildout + "how pros actually train" line carries winter, and MM can drop to 2 long-form/wk | Free-agency rumor cycles = moment trends. Format-R&D season: run the Skip-but-bank experiments while the reactive lane is quiet |
| **Feb–Mar spring training** | Ramp back to the full grid by mid-March; re-pull heatmaps after DST. Tryout-season parent searches spike (youth drills, "is my kid D1") | "Season preview" terms spike — Studio content-gaps panel is the ideation source |

**Cadence flexes with demand, floors don't:** TMB Tuesday never skips year-round; MM holds ≥2/wk
even in January. Baseball-content demand roughly doubles at deadline/playoffs and craters in
January — surge Shorts/TikTok volume at the peaks rather than holding flat.

---

## 6. Mapping onto Mayday Studio workflows

- **Sunday batch → Metricool.** Planner builds IG/FB/TikTok/Threads for the week; check the
  per-account **"Best times" heatmap before scheduling** (computed from each account's own
  follower activity, already synced via `sync-metricool`). YouTube schedules natively in Studio
  — plain scheduled publish; Premieres only for genuine events.
- **PostShow → the clip pipeline.** Every long-form recording gets a PostShow pass: expect ~1
  publishable clip per 5–7 min of talk-heavy source. Two gates before any edit: 3-second hook
  test + standalone test. Tier 1 (clean export + captions, ~10 min) for all; Tier 2 (re-cut
  hook, native first frame) for the week's 2–3 best. Measure clips as a **cohort per parent** —
  a twice-underperforming cohort is a topic signal, not an editing problem
  (see ../cross-platform/04-repurposing-pipeline.md).
- **Sprint planning.** Two standing lanes: **scheduled** (Sunday batch, edit queue, thumbnails)
  and **reactive** (explicitly reserved slack — a reactive lane that must displace sprint work
  dies in review). Calendar-driven pre-builds are sprint tasks with due dates: deadline shells
  due **Jul 25**; the **vidIQ refresh** (authorize MM, seed competitors, run all four
  `../audit/` runbooks, ~150 credits) also due Jul 25–26 when credits reset; October shells due
  Sep 15; the monthly **Studio impressions/CTR CSV upload** (the API can't fetch impressions —
  house rule) as a recurring task.
- **Research page.** The 8am PT trend brief is step 0 of the daily scan. Feed gap: add
  baseball-creator/industry RSS sources so the brief sees what the niche sees, not just news.
- **"Do this more" widget** = the compliance layer for daily IG Stories (tracks via
  `metricool-stories`). Widget goal = the daily minimum (≥3 slides + 1 sticker); the managed
  metric is replies.
- **The trend log lives in Supabase** (house rule: user data never lives in local notes). Small
  `research_trend_log` table: `date_spotted, name, link, class (audio|format|moment),
  origin_platform, velocity_read, niche_angle, decision (jump|adapt|skip|bank), shipped_at,
  verdict (win|rented_crowd|push|loss), notes`. Surface as a list on the Research page. The last
  two columns are what makes the system learn.
- **Postmortems ride the weekly analytics review.** Verdict every trend piece at 7 days against
  the channel's 30-day median non-follower reach (never raw views — view definitions differ per
  platform; see ../cross-platform/06-shortform-analytics-benchmarks.md): WIN ≥2x with
  follows-per-reach at norm; RENTED CROWD ≥2x reach, no follows; PUSH 0.8–2x; LOSS <0.8x.
  **Three same verdicts on a trend class = write a standing rule.** Kill criterion: two straight
  quarters of trend content losing to pillar content on follows- and shares-per-reach → cap
  drops to 5%.
- **Data-integrity chores this system depends on (week-1 tasks):** diagnose the FB pipe (7d
  views = 0 after a 175K/90d run — sync bug vs stopped posting), the Twitch pipe (reads 0), the
  Substack sync (stale since 3/5); keep watching the known `sync-youtube` More Mayday staleness.
  A schedule tuned on broken pipes is tuned on noise.

---

## 7. What I'd need to know (facts that would change this advice)

1. **CTR per video.** Impressions/CTR are 0 in `yt_video_daily` (CSV-only in this stack) and
   vidIQ is credit-blocked until Jul 25. The MM "click problem" diagnosis rests on
   retention-vs-views inference; one month of CTR data could reorder the packaging priorities.
2. **The actual audience heatmaps** — "When your viewers are on YouTube" per channel, TikTok
   Studio and IG most-active times. The §2 grid is the sports-overlay prior; the per-account
   heatmaps are the posterior. If MM's audience peaks mornings, its Shorts slots move.
3. **Geography/demo splits.** `yt_video_dim_age/gender/geography` are empty and vidIQ was
   blocked. The ET-anchor logic assumes the standard ~77% ET+CT skew; a West/international tilt
   on TikTok would shift its slots.
4. **A recent-window traffic-source mix.** The 44.6%-browse / 3.2%-search numbers are a lifetime
   snapshot (2026-05-25). If the recent mix differs materially, the cadence-vs-search priorities
   shift.
5. **Why FB collapsed** — deliberate stop vs sync bug. If deliberate, fine; but it should
   restart before Neptune marketing spins up (heaviest 25–54 parent demo).
6. **Who owns the daily scan, and do they truly have Jump authority?** The system depends on one
   empowered operator; a sign-off chain kills every 48h window.
7. **Twitch strategy status.** 187K followers, dead metrics pipe, no slot in this grid —
   live-only by design, or neglected? Changes whether simulcast gets a weekly slot.
8. **The AWA Expansion spec** (launch 2026-10-01) — a new show/channel launching into playoff
   season changes the October overlay materially (from-zero account = Jump-heavy trend posture,
   timing optimization irrelevant below ~1K followers).
9. **Whether MLB creator-program access has been pursued** — archival footage flips the
   moment-trend lane from phone-clips to broadcast-quality breakdowns.
10. **Editor capacity split.** The MM-Shorts retargeting and the TMB weekly flagship both draw on
    the same edit queue (David Korn + team). If capacity forces a choice, TMB Tuesday wins —
    it's the revenue channel; MM's Shorts mix can rotate slower.
11. **Newsletter send-time click data** — Thu 6am PT is a hypothesis; test against Sun morning
    on clicks (opens are Apple-MPP noise).

---

## Brain docs this playbook draws on

- ../audit/trevor-may-baseball-channel-audit.md — TMB numbers, outlier buckets, traffic sources, cadence gaps
- ../audit/more-mayday-channel-audit.md — MM medians, title/thumbnail patterns, Shorts tiers, cadence
- ../audit/keyword-search-gaps.md — seasonal keyword calendar, evergreen idea queue, vidIQ refresh plan
- ../audit/competitor-benchmark.md — competitor roster, vidIQ setup gaps (BLOCKED status noted)
- ../cross-platform/01-posting-time-master-matrix.md — slots, ET-anchor math, sports overlay, calibration
- ../cross-platform/02-trend-decision-framework.md — scan circuit, lifecycle stages, gate, postmortems
- ../cross-platform/03-format-spec-sheet.md — master specs, safe zones, caption/link asymmetries
- ../cross-platform/04-repurposing-pipeline.md — clip gates, effort tiers, publish order, watermark rule
- ../cross-platform/05-niche-connection-sports-athlete.md — 4-lane matrix, MLB-calendar programming
- ../cross-platform/06-shortform-analytics-benchmarks.md — view definitions, per-reach scorecards
- ../tiktok/03-posting-times-cadence.md, ../tiktok/04-trends-sounds-lifecycle.md, ../tiktok/06-sports-athlete-niche.md
- ../youtube-shorts/03-shorts-channel-strategy-funnel.md, ../youtube-shorts/04-shorts-cadence-publishing.md
- ../instagram/03-stories-tactical-systems.md, ../instagram/05-posting-times-trial-reels-grid.md
- ../facebook/02-pages-crossposting-formats.md
- ../youtube-longform/08-publishing-mechanics-metadata.md, ../youtube-longform/09-analytics-diagnostics.md
- Siblings: ../applied/youtube-longform-playbook.md, ../applied/short-form-playbook.md
- Live data: `../audit/` (2026-07-12) + Mayday Studio Supabase (`platform_daily_metrics`, `audience_snapshots`), queried 2026-07-12
