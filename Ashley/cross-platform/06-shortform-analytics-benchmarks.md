---
title: "Short-Form Analytics & Benchmarks Across Platforms"
domain: cross-platform
tags:
  - shortform-metrics
  - benchmarks
  - completion-rate
  - viewed-vs-swiped
  - sends-per-reach
  - view-quality
  - scorecard-design
  - diagnostics
sources_reviewed: 16
last_updated: 2026-07-12
---

# Short-Form Analytics & Benchmarks Across Platforms

Tactical reference for measuring TikTok, Instagram Reels, and YouTube Shorts correctly: what a "view" actually is on each platform, which metrics each recommender optimizes, benchmark bands by follower tier, per-platform diagnostic trees, and how to build one scorecard that compares them honestly. (Strategy level — north-star metric selection and the weekly review ritual: see ../../Carl/organic-marketing/12-analytics-experimentation.md. Repurposing/pillar strategy: see ../../Carl/organic-marketing/04-content-strategy-pillars-repurposing.md.)

## TL;DR

- **Raw view counts are no longer comparable across platforms — or even within YouTube.** Since March 31, 2025, a Shorts "view" fires the instant playback starts (replays included); TikTok has always counted ~1 second; Instagram unified "views" in 2024 to count on play-start including replays. Compare **engaged/retained attention**, never raw views. A rough discount: divide raw Shorts/Reels/TikTok views by ~2–3x to estimate real 3-second-plus watches.
- **One king metric per platform:** Shorts = *Viewed vs. Swiped Away* (target 70%+; under 60% = dead on arrival); TikTok = *completion rate* + rewatch % (70%+ full-watch on sub-15s, 50%+ on 30s+); Reels = *sends per reach* + *average watch time vs. length* (Mosseri named watch time, sends/reach, likes/reach as THE three signals, Jan 2025).
- **Benchmark bands to hold in memory (2025 data):** TikTok engagement-by-views ~4.0–4.4% for accounts under 100K followers; TikTok median views per post at 10–50K followers ≈ 3,200 (down 11% YoY — small-account reach is shrinking); Shorts at a 10–100K-sub channel typically land 1,000–10,000 views; Shorts like-to-view healthy band 3–6%; Paddy Galloway's 3.3B-view study: 50–60s average view duration correlated with ~4.1M avg views, and ~16.9 subs per 10,000 Shorts views is the growth yardstick.
- **Follows-per-view is the honest growth metric, not follower count.** Track new followers ÷ engaged views per post. Shorts baseline ~1.7 per 1,000 views (Galloway); anything above ~3/1,000 on a baseball-niche short means the content is qualifying the right audience.
- **Diagnose with the 2×2, per platform:** high feed-impressions + low viewed% = first-frame/hook problem; high viewed% + low completion = mid-video pacing; high completion + low shares/sends = no "sendable moment"; everything strong + no follows = content too generic for the profile promise.
- **Views per post on TikTok collapsed ~59% YoY for 1–5K-follower accounts while 100K–1M accounts grew 38.5% (Socialinsider, 2M videos).** Small accounts must win on completion + shares, not volume — the FYP now re-concentrates reach on proven accounts.
- **Scorecard rule: normalize everything per-reach or per-view.** Absolute counts reward the platform that counts loosest. The weekly scorecard should carry ~6 ratio metrics per platform, one column per platform, one row per metric family (hook, hold, amplify, convert).

---

## 1. What a "view" actually is — per platform (as of mid-2026)

This table is the foundation. Every cross-platform comparison Ashley makes must start from it.

| Platform | View fires when… | Replays counted? | Second-tier metric | Notes |
|---|---|---|---|---|
| **YouTube Shorts** | Playback *starts* — no minimum watch time (policy change effective **March 31, 2025**) | Yes, every replay = new view | **Engaged Views** — watcher stays past the first few seconds; used for YPP monetization eligibility and the honest analytics number | Pre-2025 historical view counts are NOT comparable to post-2025 counts. Studio still exposes Engaged Views; always use those for trend lines. |
| **TikTok** | ~1 second of playback (≈instant); ~3s threshold applied to 3-min+ videos to prevent scroll-inflation | Yes | Completion rate, avg watch time, "watched full video %", "watched more than once %" | No public engaged/casual split — the analytics tab is the only place quality lives. |
| **Instagram Reels** | Play starts (unified "Views" metric rolled out Aug 2024, replacing "Plays"); legacy behavior was a ~3s threshold | Yes | Watch time, avg watch time, reach (unique accounts), sends, saves | Reach ≠ views: reach is unique accounts, views include replays. Use **reach** as the denominator for all Reels ratios. |

**Practical conversions (heuristics, not physics):**
- 10,000 raw Shorts views ≈ 6,000–8,000 engaged views on healthy content (70–80% viewed rate) — but can be 3,000 on weak hooks.
- TikTok and Reels raw views run "hot" versus a 3-second standard by roughly 1.5–2x on scroll-heavy feeds.
- When a brand partner or sponsor asks for "views," report engaged views/reach with the platform definition footnoted — it protects credibility when numbers get audited.

**Why this matters commercially:** sponsors increasingly know the March 2025 Shorts change inflated counts. Quoting Engaged Views proactively (e.g., "1.2M views, 890K engaged") reads as sophistication and preempts the discount a smart media buyer will apply anyway.

---

## 2. The metrics that matter — per platform

### 2.1 YouTube Shorts

Priority order for reading a Short's performance (check in this sequence):

1. **Viewed vs. Swiped Away** (Studio → Shorts feed section). The scroll-stop rate. Bands (triangulated across Galloway's 3.3B-view study and practitioner consensus):
   - **70–90% viewed = viral-capable.** Best performers in the 3.3B-view dataset lived here.
   - 60–70% = serviceable; distribution continues but won't compound.
   - **<60% = distribution collapses fast** regardless of content quality after second 1.
   - Equivalent framing: swipe-away under 30% is strong; 30–40% average; 40%+ is a red flag. Shorts with sub-30% swipe-away got ~4x sustained distribution vs. 50%+ swipe-away.
2. **Average percentage viewed (retention).** 70%+ healthy; 76% was the average for Shorts exceeding 1M views (Shortimize). Above 100% = looping, a strong positive signal (Shorts auto-loop at the end). First-3-seconds retention should hold above ~80%; midpoint above ~60%.
3. **Average view duration in absolute seconds.** Galloway: the algorithm favors longer Shorts that hold — AVD of 50–60s correlated with ~4.1M avg views vs. ~1.8M at 40–50s and ~1.3M at 30–40s. Implication: a 55s Short at 75% retention beats a 20s Short at 90%. Don't pad — but don't reflexively cut to 15s either.
4. **Like-to-view ratio.** 3–6% healthy; >6% strong; <2% signals no emotional resonance. (Galloway found likes/comments/shares "not massively important" to distribution — treat engagement as a *diagnostic of resonance*, not a growth lever on Shorts.)
5. **Subscribers per 10,000 views.** Study average ≈ **16.9 subs/10K views** (~1.7 per 1,000). This is the number that says whether Shorts are building the channel or just renting attention.
6. **RPM context:** Shorts historically ~$0.06 per 1,000 views (Galloway-era data) — Shorts monetize attention terribly; their job in Trevor's system is discovery and funneling to long-form/podcast, not revenue. (as of 2026; Shorts RPMs have crept up but remain ~10–20x below long-form)

Where to look: YouTube Studio → Content → Shorts → Reach/Engagement tabs; "Viewed vs swiped away" lives under the Shorts feed traffic source detail.

### 2.2 TikTok

Priority order:

1. **Completion rate** ("watched full video" in TikTok analytics). Length-adjusted bands (Shortimize + practitioner consensus, 2025):
   - <15s videos: **80%+** completion is the bar.
   - 15–30s: **60%+**.
   - 30s+: **50%+**.
   - Overall portfolio target: ~70%. Platform context: videos holding viewers past the 40–60% completion mark earn sustained FYP exposure; 0–10s videos average 81% completion platform-wide (i.e., 80% on a 8s video is *average*, not good).
2. **Average watch time in seconds.** Platform average is ~8.4 seconds — brutal. Every second of AWT above 10s on a 30s+ video is a distribution asset.
3. **Rewatch rate** ("watched more than once"). TikTok explicitly surfaces this because the FYP weights it. Loops from a seamless ending are the cheapest completion-rate hack on the platform.
4. **Shares per view.** Shares grew 45% YoY platform-wide (2026 Socialinsider) — TikTok's recommender is increasingly send-driven like Instagram's. A share is worth an order of magnitude more than a like for reach.
5. **Engagement rate by views** (likes+comments+shares+saves ÷ views). Platform average 4.20% in 2025 (up from 3.85%). Use it as a sanity check, not a target.
6. **Traffic source split: FYP % vs. Following %.** Healthy growth accounts see 70%+ FYP. If Following% dominates, the content stopped qualifying for cold distribution.

### 2.3 Instagram Reels

Mosseri (January 2025) named the three ranking signals explicitly — build the Reels dashboard around exactly these:

1. **Average watch time / watch-through.** #1 ranking factor. Platform average watch time on a Reel is ~3 seconds (yes, three) — so a 12s average on a 30s Reel is elite. Instagram uses **dual weighting**: both % watched AND total seconds watched, so a 60s Reel at 35% retention (21s) can out-distribute a 15s Reel at 80% (12s). Skip rate in the first 3s: single digits to low teens ideal; 25%+ = hook failure. Reels with 3-second hold above 60% outperform sub-40% holds by 5–10x in reach.
2. **Sends per reach** (DM shares ÷ accounts reached). Mosseri has called sends the single most valuable signal for reaching NEW audiences; weighted roughly 3–5x a like. Send-value hierarchy: DM to close friend > Story reshare > external share > link copy. ~694K Reels are sent via DM every minute (Metricool 2025). No official benchmark exists; practitioner bands: **>1% sends/reach = strong, >2% = exceptional, <0.3% = the content has no social currency.**
3. **Likes per reach.** Matters more for ranking to *existing followers*; sends matter more for non-followers. Reels average engagement ~2.46–2.7% (Sprout/Torro 2025).

Supporting: **saves per reach** (signals reference value — carousels get 9x more saves than single images, and save-bait works on Reels too: drills, checklists, mechanics breakdowns), **non-follower reach %** (the discovery dial — for a growth account want 50%+ on Reels), and **follows per reach**. Profile-visit → follow conversion runs 10–30% on IG; monthly average ~13.5% (Flick) — if profile visits are high but follows are low, the *bio/grid*, not the Reel, is the broken step.

Context numbers (Metricool 2025→2026, 24.4M posts / 375K accounts): average Reel reach fell from ~14,900 (2024) to ~9,700 (2025) — a ~35% decline from saturation (+35% more Reels published YoY) — while watch time per Reel more than doubled and Reels engagement rate rose ~25%. Translation: fewer people see each Reel, but the ones who watch, watch harder. Reels also generate ~30% fewer views and ~14% fewer interactions than the same content on TikTok, on average. Set expectations accordingly: an identical clip "underperforming" on IG vs. TikTok by 30% is *at benchmark*, not failing.

---

## 3. Benchmark bands by follower tier (2025 data)

### TikTok — Socialinsider (2M videos, 214K profiles, Jan 2024–Dec 2025)

| Follower tier | Engagement rate (by views) | Median views/post | Views YoY | Likes/post | Shares/post | Posts/month (avg) |
|---|---|---|---|---|---|---|
| 1–5K | 4.40% | ~350 | **−59%** | 330 | 40 | 8 |
| 5–10K | 4.00% | ~945 | −40% | 595 | 60 | 12 |
| 10–50K | 3.90% | ~3,240 | −11% | 1,325 | 120 | 16 |
| 50–100K | 3.75% | ~9,900 | +14% | 2,675 | 200 | 18 |
| 100K–1M | 3.95% | ~34,900 | **+38.5%** | 7,900 | 477 | 23 |

Read on this table: TikTok reach re-concentrated toward large accounts in 2025 while posting frequency exploded (+40% avg). Small/mid accounts survive on completion + shares, not spray-and-pray volume. Follower growth rates also fell ~33% across all tiers — organic follower growth on TikTok is structurally slower now than the 2020–2023 era anecdotes Trevor may remember from peers.

### YouTube Shorts — by channel size (Humble&Brag 2026 + Galloway)

| Channel size | Typical views/Short (first ~48h) | Healthy retention | Sub conversion |
|---|---|---|---|
| <1K subs | 50–500 (high variance) | 70%+ avg % viewed | ~17/10K views is the cross-study average |
| 1–10K subs | 200–2,000 | 70%+; first-3s hold 80%+ | same |
| 10–100K subs | 1,000–10,000 | 70–90% = viral band | same |
| Viral outliers | 1M+ | 76% avg for 1M+ view Shorts | — |

### Instagram Reels — platform-wide anchors (2025)

- Average Reel reach: ~9,700 accounts (down 35% YoY); average watch time ~3s; Reels engagement ~2.46%; overall IG engagement 0.48% (2026 Socialinsider).
- Engagement by follower count follows the universal inverse curve: nano (<10K) accounts routinely 2–4x the engagement rate of 100K+ accounts.

### Niche adjustment — baseball / sports / athlete-creator

- Sports is a **top-decile engagement vertical** on TikTok: during 2025, #MLB post volume grew ~60%, and TikTok's own partnership data showed official-account content (64%), creator content (63%), and fan-generated content (60%) engaging at *nearly equal* rates — meaning an athlete-creator's clip competes head-to-head with league-produced content; production value is not the moat, proximity/authenticity is.
- 85% of sports fans use TikTok as a second screen during live events → in-season, post-game reaction shorts have a structural tailwind that offseason content doesn't. Benchmark in-season and offseason content separately.
- MLB's own playbook (asset folders delivered to players' phones before they leave the locker room) confirms the speed premium: reaction content within hours of the moment, not days.
- Working platform allocation in sports-creator deals skews ~45% TikTok / 30% YouTube / 25% IG (Influencers-Time 2026) — useful when pricing Trevor's short-form inventory for sponsors.
- Apply a niche modifier to the generic tables: expect **above-average engagement rate but average-or-below completion** on analysis-heavy baseball content (pitch-grip breakdowns get saved and shared but skipped by casuals). Judge teaching content on saves+sends; judge personality/reaction content on completion+follows.

---

## 4. Diagnosing underperformance — per-platform decision trees

Always pull the numbers BEFORE hypothesizing. Order of operations: distribution → hook → hold → payoff → conversion.

### 4.1 Shorts diagnostic

```
Short underperformed (vs. channel rolling 10-Short average)
├─ Feed impressions low? → Distribution never started.
│   Check: is it being shown at all (Shorts feed traffic <80%)?
│   Causes: topic outside channel's proven cluster; near-duplicate of a
│   recent flop; upload during a dead window. Fix: retitle/re-post is NOT
│   a thing on Shorts — feed the topic to a new Short with a new first second.
├─ Impressions OK, Viewed% <60%? → First-frame failure.
│   The frame shown at second 0 (not the thumbnail) lost the scroll.
│   Fix: motion + face + on-screen text stating the premise inside 1s;
│   cut any logo/intro frame; test starting mid-action.
├─ Viewed% ≥70%, avg % viewed <60%? → Mid-video pacing.
│   Find the cliff in the retention graph. Cliff at 15–30s = hook promised
│   something the video delayed. Fix: move payoff earlier, add a mid-video
│   re-hook ("but here's the part nobody talks about").
├─ Retention ≥70%, likes/view <2%? → Watched but unfelt.
│   Competent, forgettable. Fix: sharper POV, a claim someone could disagree
│   with, or a moment worth commenting on.
└─ All strong, subs/10K views <10? → Generic content on a specific channel.
    Viewers enjoyed it but see no reason to subscribe. Fix: make the Short
    an obvious sample of a series ("Part 3 of breaking down every pitch I
    threw in the bigs"), verbal channel-promise, pinned comment to next episode.
```

### 4.2 TikTok diagnostic

```
TikTok video underperformed
├─ Views <30% of trailing median? → FYP never picked it up.
│   Check first-hour completion on the small seed batch. TikTok tests on
│   ~200-600 viewers; if that cohort completed poorly, it dies quietly.
│   Fix: the first test is unforgiving — front-load the single most
│   arresting second of footage.
├─ Views OK, completion below length band (80/60/50)? → Length mismatch.
│   Cut until the weakest 20% is gone, or split into a 2-parter.
├─ Completion OK, shares/view low? → No sendable moment.
│   Ask: "who would someone send this to, and why?" If no answer, the video
│   was consumption-only. Fix: engineer one screenshot-able / send-able beat
│   (a stat, a hot take, a 'tag a pitcher who…' beat).
├─ Rewatch % near zero on a loopable format? → Ending telegraphs the exit.
│   Fix: seamless loop (last frame flows into first) or end mid-beat.
└─ FYP% collapsing across recent posts (<50%)? → Account-level signal decay.
    Usually: topic drift, or a run of low-completion posts trained the FYP
    to stop testing you. Fix: 2-week run of the account's historically
    best-completing format, no experiments.
```

### 4.3 Reels diagnostic

```
Reel underperformed
├─ Reach <50% of trailing median? → Check non-follower reach %.
│   If non-follower reach ~0: the Reel never left the follower graph —
│   usually weak sends/watch-time on the seed audience, or a
│   recommendation limit (check Account Status). Also check: did it use
│   3rd-party watermarks (TikTok logo)? IG demotes those.
├─ Reach OK, avg watch time <25% of length AND <3s absolute? → Hook.
│   Same first-frame surgery as Shorts. IG-specific: the cover frame
│   matters for grid/Explore; the first 3s matters for feed.
├─ Watch time OK, sends/reach <0.3%? → No social currency.
│   IG's recommender is send-first (Mosseri). Fix: relatability beats or
│   utility beats — the two send drivers. For Trevor: "send this to your
│   catcher" content, or takes that settle a group-chat argument.
├─ Sends OK, saves near zero on teaching content? → Packaging.
│   Save-worthy info presented too fast to reference later. Fix: end-card
│   summary, text overlay of the drill steps, or convert to carousel.
└─ Profile visits high, follows low (<10% conversion)? → Bio/grid problem,
    not a content problem. Fix the profile promise, pinned Reels, highlight
    structure. (Monthly IG average conversion: ~13.5%.)
```

### 4.4 Cross-platform triage (same clip, divergent results)

When one clip wins on TikTok and dies on Reels (or vice versa), check in order:
1. **Watermark** — cross-posted TikTok watermark suppresses Reels distribution.
2. **First-second frame** — feeds crop/preview differently; verify the hook survives each platform's rendering (safe zones: keep text out of the bottom ~25% and right edge).
3. **Length fit** — 55s is Shorts-optimal (Galloway) but past the completion cliff for TikTok casuals; consider a 30s TikTok cut and a 55s Shorts cut of the same moment.
4. **Audience baseline** — Reels ~30% fewer views than TikTok on identical content is *normal* (Metricool); don't diagnose a healthy gap.
5. **Niche seeding** — TikTok's FYP finds baseball fans fast via hashtag/audio graph; IG leans on the follower graph first. A cold topic can go on TikTok and stall on IG purely because of graph mechanics.

---

## 5. Cross-platform scorecard design

Design rules:

1. **Ratios only.** Any absolute number (views, followers) appears only in a context column, never as a KPI. Absolute counts reward whichever platform counts loosest (currently Shorts post-March-2025).
2. **Four metric families, one row each** — every platform maps its native metric into the family:

| Family | Question | Shorts metric | TikTok metric | Reels metric | Green band |
|---|---|---|---|---|---|
| **Hook** | Did we stop the scroll? | Viewed vs. swiped % | 3s retention / first-frame hold | 3s skip rate (inverted) | ≥70% / ≥70% / ≤15% skip |
| **Hold** | Did they stay? | Avg % viewed | Completion % (length-banded) | Avg watch time ÷ length | ≥70% / band / ≥35% |
| **Amplify** | Did they spread it? | Shares/view (secondary on Shorts) | Shares/view | Sends/reach | — / ≥0.8% / ≥1% |
| **Convert** | Did we keep them? | Subs per 10K views | Follows/view | Follows/reach + profile-visit conversion | ≥15 / ≥0.15% / ≥13% visit→follow |

3. **Score vs. own trailing median, not vs. platform averages.** Each cell shows: this-period value, trailing-10-post median, and a multiplier (value ÷ median). Multipliers >1.5x get a "study this" flag; <0.5x gets the diagnostic tree. (Outlier-multiplier method — strategy level: see ../../Carl/organic-marketing/12-analytics-experimentation.md.)
4. **Separate scorecards for content modes.** Personality/reaction clips and teaching/drill clips have structurally different Amplify/Convert profiles (teaching = saves+sends, personality = completion+follows). Blending them into one average hides both signals.
5. **In-season vs. offseason baselines** for baseball content — the second-screen tailwind (85% of sports fans on TikTok during live events) can inflate in-season numbers 2x+; a "decline" every November is seasonality, not decay.
6. **One funnel metric at the bottom:** short-form → long-form/podcast/Neptune. Track "views on pinned-comment link" (Shorts), link-in-bio taps attributed weekly, and — the only reliable one — the HDYHAU field on Neptune inquiries. Short-form's job in Trevor's stack is top-of-funnel; the scorecard must show whether the funnel actually flows or the Shorts audience is a separate, non-converting population.
7. **Cadence:** update weekly (30 min), decisions logged; monthly roll-up recalculates trailing medians and green bands. Never re-litigate metric definitions mid-quarter.

Anti-patterns in scorecard design: a single blended "engagement rate" across platforms (category error — each platform defines it differently: TikTok divides by views, IG by reach or followers depending on tool); tracking >8 metrics per platform (nothing gets acted on); letting the tool's default dashboard (Metricool included) substitute for the four-family view.

---

## 6. View-quality deep dive: what a view is *worth*, platform by platform

Beyond counting thresholds (§1), the *behavioral context* of a view differs:

- **TikTok view:** sound-on, full-screen, FYP-served to a cold audience by interest graph. Highest discovery value per view, lowest loyalty per view. TikTok followings are notoriously the least "portable" — a TikTok follow converts to off-platform action at the lowest rate of the three.
- **Shorts view:** served inside the YouTube app where the *channel* is a first-class object. A Shorts viewer is one tap from the long-form catalog — the only short-form view with a native path to 20-minute watch sessions. This is why subs/10K views is the metric that matters there: Shorts views are worth more to Trevor's ecosystem *if and only if* they convert to channel relationships. Note: Shorts subscribers historically watch long-form at lower rates than long-form-acquired subscribers — track "returning viewers from Shorts" in YouTube's audience tab rather than assuming transfer.
- **Reels view:** highest overlap with people who already know Trevor (follower-graph-first distribution) and the strongest DM/community context. A Reels view is the most "warm" view — best platform for moving an existing fan toward Substack/podcast/Neptune, weakest for pure cold discovery (and getting weaker: reach down 35% YoY).

Rule of thumb for valuing the same 100K views: TikTok = awareness, Shorts = channel growth option, Reels = relationship deepening. Price and program accordingly — and when a clip is only going to be cut once, choose the platform by which of those three jobs the moment serves.

Monetization per view (as of 2026): all three platforms pay poorly for short-form (Shorts ~$0.05–0.10 RPM historical; TikTok Creator Rewards slightly better for 1min+ qualified views; Reels bonuses inconsistent/invite-only). Short-form ROI for Trevor is 95% funnel value, 5% direct payout — never let a payout program distort format decisions (e.g., padding to 60s for TikTok Rewards eligibility at the cost of completion).

---

## 7. Common mistakes

1. **Comparing raw views across platforms** (or across the March 2025 Shorts boundary). Always footnote which counting regime a number comes from.
2. **Judging a Short by view count in the first 6 hours.** Shorts distribution is bursty and can re-ignite days or weeks later; TikTok occasionally resurrects months-old videos. Verdict window: 72h minimum for Shorts/TikTok, 48h for Reels.
3. **Using platform-average engagement rates as targets.** A 4.2% TikTok average blends dance accounts with B2B; Trevor's comparisons should be (a) his own trailing median and (b) named athlete-creator comps, nothing else.
4. **Optimizing completion by making everything 7 seconds.** 81% completion on a 8s video is platform-average and produces ~6s of watch time; the algorithms (all three, explicitly IG's dual weighting and Galloway's Shorts data) reward total seconds held. Length should follow the moment, then be defended with pacing.
5. **Reading "likes are down" as a crisis.** Likes are the weakest signal on all three platforms in 2025–26; sends/shares/saves/completion moved into the driver's seat. A post with half the likes and double the sends is a *better* post.
6. **Diagnosing a healthy TikTok→Reels gap as Reels failure.** −30% views on IG vs TikTok is the documented platform baseline.
7. **Ignoring the first-frame ≠ thumbnail distinction on Shorts.** Creators polish thumbnails that feed viewers never see; the frame at 0:00 is the actual packaging.
8. **Letting cross-posted watermarks ride.** IG demotes visibly-TikTok content; it's the most common silent Reels killer for repurposing pipelines.
9. **Counting follower growth instead of follows-per-view.** Follower growth is volume-confounded; follows-per-view isolates content quality. (TikTok follower growth rates fell ~33% YoY across ALL tiers — a slowdown is macro, not personal.)
10. **No content-mode segmentation.** Averaging drill-breakdown Reels with clubhouse-story Reels produces a scorecard where every number is mediocre and no decision is possible.
11. **Trusting third-party "benchmark" listicles without checking N and date.** Prefer Socialinsider (2M videos), Metricool (24M posts), Galloway (3.3B views) — and re-pull annually; every key number in this doc decayed 10–60% between 2024 and 2025.

---

## 8. Questions Ashley should ask

**When Trevor says a short "flopped":**
- Flopped against what — trailing 10-post median on that platform and content mode, or against a TikTok number on an IG post?
- What was the hook metric (viewed%, 3s hold, skip rate)? If unknown, pull it before any creative discussion.
- Was it in the 72-hour window, or is the verdict premature?
- Same clip on the other two platforms — did it diverge? (Run §4.4 triage.)

**When reviewing the weekly scorecard:**
- Which of the four families (hook/hold/amplify/convert) moved, and is it one post or a 3-week trend?
- Are we comparing in-season to offseason without the seasonal baseline?
- What's the follows-per-view trend on the growth-priority platform this quarter?
- Did any post clear 1.5x median on Amplify? What was the sendable beat, and is it repeatable as a format?

**When planning content from analytics:**
- Is this moment a TikTok job (cold awareness), a Shorts job (channel growth), or a Reels job (warming existing fans)? Should the cut differ per platform (30s vs 55s)?
- For teaching content: what's the save/send trigger? For personality content: what's the completion device?
- What is the funnel evidence this quarter that short-form viewers become long-form viewers, podcast listeners, or Neptune inquiries — and if there is none, what's the one bridge we add this week?

**When a sponsor/partner asks for numbers:**
- Are we quoting engaged views/reach with definitions, or raw counts that a media buyer will discount?
- Do we have the sports-vertical framing ready (TikTok sports engagement parity data, second-screen stat) to justify rates?

---

## Sources

- Shortimize — Compare Watch Time: TikTok vs Reels vs Shorts (2025): https://www.shortimize.com/blog/compare-watch-time-tiktok-vs-reels-vs-shorts
- Shortimize — How to Analyze YouTube Shorts Performance (2025): https://www.shortimize.com/blog/how-to-analyze-youtube-shorts-performance
- Socialinsider — 2026 TikTok Benchmarks (2M videos, 214,507 profiles): https://www.socialinsider.io/social-media-benchmarks/tiktok
- Socialinsider — Social Media Benchmarks 2026 (70M posts): https://www.socialinsider.io/social-media-benchmarks
- Metricool — 2026 Instagram Study (24.4M posts, 375K accounts): https://metricool.com/instagram-research-study/
- Metricool — 2026 Social Media Study press release (Reels reach decline): https://metricool.com/press-release-2026-social-media-study/
- Humble & Brag — YouTube Shorts Benchmarks 2026: https://humbleandbrag.com/blog/youtube-shorts-benchmarks
- RouteNote — How views are counted on Shorts, TikTok, Reels (March 2025 Shorts change): https://routenote.com/blog/how-are-views-counted-shorts-tiktok-reels/
- ReelRise — Viewed vs. Swiped Away guide: https://reelrise.app/guide/viewed-vs-swiped-away-the-only-youtube-shorts-metric-that-matters/
- Paddy Galloway — 3.3B-view YouTube Shorts study (via X thread + VideoGen summary): https://x.com/PaddyG96/status/1646898356419981315 / https://videogen.io/blog/decoding-the-youtube-shorts-algorithm-a-deep-dive-into-3-3-billion-views
- Torro — The 3 Most Important Instagram Metrics for Reach (Mosseri): https://torro.io/blog/3-most-important-instagram-metrics-for-reach
- Dataslayer — Instagram Algorithm 2026: 5 Ranking Signals Mosseri Confirmed: https://www.dataslayer.ai/blog/instagram-algorithm-2025-complete-guide-for-marketers
- Go-Viral — TikTok Algorithm 2026: Watch Time & Completion Rate: https://www.go-viral.app/blog/tiktok-algorithm-2026/
- Flick — Instagram conversion rate benchmarks (profile visit → follow): https://www.flick.social/learn/instagram-analytics-benchmarks/insights/conversion-rate/3-months
- TikTok Newsroom — TikTok and MLB expand multi-year global content partnership (sports engagement data): https://newsroom.tiktok.com/tiktok-and-mlb-expand-multi-year-global-content-partnership
- Influencers-Time — Sports Creator Partnerships: MLB, TikTok & Netflix Model (platform allocation): https://www.influencers-time.com/sports-creator-partnerships-mlb-tiktok-and-netflix-model/
