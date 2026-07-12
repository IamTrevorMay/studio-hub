---
title: "Shorts Algorithm & Distribution Mechanics"
domain: youtube-shorts
tags:
  - shorts-algorithm
  - viewed-vs-swiped
  - engaged-views
  - shorts-to-longform-funnel
  - seed-audience
  - related-video-link
  - distribution-mechanics
sources_reviewed: 16
last_updated: 2026-07-12
---

# Shorts Algorithm & Distribution Mechanics

Tactical reference for how the YouTube Shorts feed actually distributes videos, how Shorts interact with channel authority and long-form recommendations, and what changed 2024–2026. Strategy-level framing (what short-form is *for*, cadence philosophy, cross-platform comparison strategy) lives in the Carl docs — this file is the execution layer. (strategy level: see ../../Carl/organic-marketing/02-short-form-strategy.md)

## TL;DR

- **One metric rules Shorts distribution: Viewed vs. Swiped Away** (YouTube Studio → Analytics → Shorts feed section). Benchmarks as of 2026: **70%+ viewed = viral territory, ~50% = average, ≤30% viewed = dead on arrival.** Shorts under 30% swipe-away get roughly 4x the sustained distribution of Shorts over 50% swipe-away. Fix the first frame before touching anything else.
- **Distribution is explore/exploit, not chronological.** Every Short gets a seed audience test (a few hundred to a few thousand viewers matched by interest). Strong seed response → progressively larger pools. Weak response → it stalls, but unlike TikTok it is *not* permanently dead — Shorts can resurface weeks or months later via search, topic relevance, or a new audience segment.
- **Raw "views" have been near-meaningless since March 31, 2025** — any play or replay of any duration counts. Use **Engaged Views** (Analytics Advanced Mode) for real performance, monetization tracking, and sponsor reporting. Expect raw views to run ~20–30% above engaged views.
- **Shorts and long-form run on separate recommendation systems, and Shorts do not drag down long-form.** YouTube's on-record position (Rene Ritchie): "We don't look at channel or creator for those sorts of things. We look at video and topic." The 18,000-channel AIR study (Mar 2025–Mar 2026) found mixed-format channels lead in fitness (+41%), business (+39%), and education (+37%) — but long-only wins in entertainment at scale. Trevor straddles both patterns: Trevor May Baseball fits the "mix wins" profile; More Mayday leans entertainment where Shorts should exist to funnel, not to carry.
- **Optimal upload mix: 25–40% Shorts by upload count** (~1–2 Shorts/wk against 3–5 long-form/mo at Mayday's scale). Above ~55% Shorts, long-form performance measurably thins. Abrupt strategy pivots (30+ percentage-point ratio swings) roughly *halved* median subscriber outcomes vs. stable strategies — change the mix gradually.
- **The Related Video link is the single highest-leverage funnel tool** — a persistent tappable link under the Short's title pointing to any of your videos/streams. Desktop-only, added *after* publish, requires advanced feature access. Realistic conversion: a 500K-view Short drives ~10–20K long-form views (2–4%); funnel-linked channels report 25–40% higher long-form discovery.
- **Since Oct 15, 2024, any vertical/square upload ≤3 minutes is a Short.** No exceptions, no toggle. Podcast clips at 2:45 vertical = Shorts monetization ($0.01–$0.10 RPM), not long-form RPM. Export anything meant to be long-form at 16:9.

---

## 1. What counts as a Short (specs, as of 2026)

| Spec | Rule |
|---|---|
| Length | ≤ 3 minutes (raised from 60s on **Oct 15, 2024**) |
| Aspect ratio | Square (1:1) or vertical (9:16 typical) |
| Classification | Automatic — length + aspect ratio, no opt-out |
| Grandfathering | Vertical videos ≤3 min uploaded *before* Oct 15, 2024 stay long-form |
| Escape hatch | Upload 16:9 (or wider) to keep a short video classified long-form |
| Resolution | 1080×1920 recommended; upload highest quality available |
| Music in 1–3 min Shorts | Most licensed tracks limited to 60–90s of use; a >1 min Short with **any active Content ID claim is blocked globally** — unplayable, unrecommended, unmonetized |

Practical consequences for Mayday:

- **Podcast clips**: a 2:30 vertical clip from "Mayday! with Trevor May" is a Short. That's usually the *intent* — but never assume a "mini-episode" will earn long-form RPM in vertical.
- **Music**: use library/royalty-free audio on any Short that might run over 60s. A trending-song clip that runs 1:05 can get globally blocked.
- **1–3 minute Shorts are held to the same completion math.** The algorithm still favors completion percentage; a 2:45 Short needs a reason to exist at that length (full story arc, full drill breakdown). Data across trackers still shows most winners at ~13–35s, with a secondary peak near 60s.

---

## 2. How the Shorts feed decides: explore → exploit

The Shorts feed is a **feed-native recommendation system** — Todd Sherman (YouTube's Shorts product lead) has stressed the defining difference from long-form: *"Shorts views mostly come from the feed itself, and the element of a conscious choice on the part of the viewer is missing."* No click decision means **no thumbnail/CTR layer**. The video must earn its distribution in-stream by not being skipped.

### Distribution phases (as of 2026)

1. **Seed test ("explore")** — the Short is shown to a small matched audience: typically a few hundred to a few thousand viewers with watch-history affinity for the topic, plus a slice of your subscribers/returning viewers. This is where channel-level signals matter most: topic consistency and past Shorts performance shape *who* the seed audience is.
2. **Evaluation** — YouTube reads swipe-away rate, completion %, replays, and engagement from the seed batch. The stay-or-swipe decision happens in roughly **the first 1–2 seconds** (some trackers cite ~400ms for the initial visual judgment).
3. **Expansion ("exploit")** — strong signals → progressively larger, less-targeted pools. Each expansion is re-evaluated; distribution continues until a batch underperforms.
4. **Long tail** — unlike TikTok's 48–72h death clock, a Short can be re-seeded weeks or months later if a topic trends, a search query matches, or a new audience segment responds. Upload timing is officially *not* a ranking factor ("There's no magic 'post at 5pm' rule" — YouTube), though posting when your seed audience is awake helps the first evaluation read cleanly.

### Ranking signal hierarchy (practitioner consensus, 2026)

1. **Viewed vs. swiped away** — the gatekeeper. Below ~50% viewed, nothing else matters.
2. **Completion rate / average % viewed** — top performers run 80–90% completion on sub-60s Shorts; below ~50% APV is a stall signal. Percentage watched beats absolute seconds.
3. **Replays/loops** — strong positive; seamless loops are a deliberate craft lever (end frame flows into start frame).
4. **Shares, then comments, then likes** — shares weighted highest among explicit engagement.
5. **Post-watch behavior** — did the viewer tap through to the channel, watch another video, subscribe, or stay on-platform longer? This is where Shorts quietly build channel value even without instant view counts.
6. **Metadata** (title, description, hashtags) — categorization aid only; behavioral signals dominate. Still worth doing: Shorts surface in **YouTube Search and browse**, a distribution lane TikTok barely has.

### What channel authority actually does (and doesn't)

- **Each Short is evaluated independently** — a big channel does not get an automatic reach multiplier, and one flop does not "poison" the next upload.
- Channel signals shape the **seed audience quality**: consistent topic → better-matched seeds → cleaner tests. Chaotic mixed-topic Shorts confuse seeding and produce noisy, weak tests.
- **Volume compounds indirectly**: channels with 200+ published Shorts show more consistent view growth — more samples, more refinement, better audience modeling, not a loyalty bonus.
- Subscribers matter more than on TikTok (they're in your seed pool) but far less than on long-form Browse. Shorts remain the closest thing YouTube has to a cold-start machine.

---

## 3. Viewed vs. Swiped Away: the master metric

Found in YouTube Studio → video Analytics → Reach/Shorts feed section (also channel-level).

### Benchmarks (as of 2026)

| Viewed % | Read |
|---|---|
| 80%+ | Elite — expect sustained multi-wave distribution |
| 70–79% | Viral territory |
| 60–69% | Good — solid distribution, iterate on hook |
| ~50% | Average — algorithm keeps testing but won't push hard |
| 40–49% | Hook problem — distribution throttles quickly |
| ≤30% | Dead on arrival; diagnose before posting the next one |

Shorts with swipe-away **under 30%** got roughly **4x the sustained distribution** of Shorts with swipe-away over 50%, regardless of initial view counts (tracker data, 2026).

### Diagnosis tree

- **High swipe in first 1–2s** → first-frame failure. Fixes: open on motion or a visually arresting frame (a pitch release, a radar-gun number, a facility reveal — not a logo, not "hey guys," not a title card); front-load the on-screen text hook; never start mid-setup.
- **Viewed % fine but completion sags mid-video** → hook promised something the video delivers too slowly. Fixes: cut dead air, deliver first payoff by ~30% mark, compress setup, raise pacing (cut every 1.5–3s of static framing).
- **High completion but no expansion** → engagement/topic-match problem. Fixes: add a comment-bait beat (a take people must respond to), check the Short actually matches a coherent topic cluster your channel is known for.
- **Strong Short, weak channel effect** → no funnel attached; see §6.

### The "views" trap (post-March 2025)

Since **March 31, 2025**, a "view" counts from the instant a Short starts playing or replaying — including scroll-pasts and loops. Raw view counts jumped ~20–30% overnight with zero change in real performance. YouTube confirmed the change **does not affect ranking, monetization, or YPP eligibility** — all of that runs on **Engaged Views** (the old definition: viewer meaningfully continues watching), visible in Analytics **Advanced Mode**.

Operational rules for Ashley:

- Benchmark and report on **engaged views**, never raw Shorts views, especially in sponsor decks and in Mayday Studio analytics (raw counts across the March 2025 boundary are not comparable).
- YPP Shorts path is still **1,000 subs + 10M valid public Shorts *engaged* views / 90 days**.
- Shorts revenue: pooled model, creator keeps **45%** of allocated pool share by engaged-view share; RPM ~$0.01–$0.10. Music in a monetized Short splits the pool allocation (1 track → ½, 2 tracks → ⅓). Treat Shorts ad revenue as zero in any forecast; the payoff is the funnel.
- As of **April 2026**, image posts appearing in the Shorts feed also add to channel-page view totals — another reason raw "channel views" is now a vanity aggregate.

---

## 4. Shorts vs. TikTok: mechanical differences that change execution

(strategy-level platform comparison: see ../../Carl/organic-marketing/02-short-form-strategy.md — below is only what changes *execution* on YouTube)

| Mechanism | TikTok | YouTube Shorts |
|---|---|---|
| Initial test | Cold batch of ~200–500 random-ish FYP users; follower count nearly irrelevant | Interest-matched seed (hundreds–thousands) *including* your subscribers/returning viewers; channel topic history shapes the seed |
| Scaling shape | Exponential within hours (500→5K→50K→500K+) | Wave-based, slower, re-evaluated per pool |
| Content lifespan | 48–72h for ~all views; ephemeral | Long tail — search + browse + re-seeding; views for months |
| Search surface | Weak/secondary | Strong — Shorts rank in YouTube Search; keyworded titles pay off |
| Trending audio | Real distribution boost (~15–30%) | **No equivalent audio boost** — don't build Shorts around a sound |
| Follower relationship | Interest graph; followers ≈ bystanders | Subscribers in seed pool; Shorts viewers become channel-level "returning viewers" |
| Decision metric | Completion + replays + shares | Viewed-vs-swiped gate first, then completion/replays/shares |
| Post-video action | Profile visit (rare) | Channel tap, related-video link, subscribe, long-form recommendation — a real funnel exists on-platform |

Execution deltas:

- **Volume matters less on Shorts than TikTok.** TikTok's ephemerality forces daily posting; Shorts' long tail means 3–5/week of *higher-floor* videos beats 7/week of filler. A library of evergreen baseball-instruction Shorts keeps paying (search: "how to throw a slider") in a way TikTok clips never do.
- **Title and first-line description are real levers on Shorts** (search + suggested), pointless on TikTok.
- **Don't port TikTok pacing conventions blindly**: Shorts viewers tolerate slightly longer builds *if* the first frame lands, because seeding is interest-matched rather than random.
- **Never upload watermarked TikTok exports** — detected and deprioritized.

---

## 5. Shorts ↔ long-form: myths vs. facts

### Myth: "Posting Shorts tanks your long-form reach / confuses the algorithm"

**Fact:** Shorts and long-form run on **separate recommendation systems** with separate evaluation. Todd Sherman has described them as different dynamics (chosen viewing vs. feed viewing); Rene Ritchie (YouTube creator liaison): *"We don't look at channel or creator for those sorts of things. We look at video and topic."* A low-APV Short does not lower your long-form videos' candidacy. YouTube's internal analyses (stated via Creator Insider) found channels adding Shorts grew *faster* than long-only channels on average.

### Myth: "Shorts subscribers are worthless"

**Half-true, mechanically explainable:** subscribers gained from Shorts are lower-intent *on average* — but viewers who cross from a creator's Shorts into their long-form show **~40% higher engagement than average** long-form viewers. The subscriber isn't the asset; the *crossing* is. Design Shorts to cause the crossing (§6) rather than to farm subs.

### Myth: "Shorts and long-form audiences never mix"

**Fact:** since YouTube's bridge-style updates (2023–2025), Shorts viewing history feeds same-channel long-form recommendations (Home, suggested) via topic + same-channel affinity + viewer-behavior signals. The mix is real but *lossy*: expect **2–4%** of a Short's engaged viewers to reach the linked long-form (10–20K long-form views from a 500K-view Short is the healthy realistic band).

### The hard data (AIR Media-Tech, 18,000 channels, Mar 2025–Mar 2026)

Methodology: English-language channels, ≥40 uploads incl. 10+ long-form, grouped Long-Only (<10% Shorts) / Mix (10–70%) / Transitional; median subscriber outcomes; 4 size tiers (100K–100M monthly views); 11 niches.

| Niche (relevant subset) | Winner | Gap |
|---|---|---|
| Fitness | Mix | +41% subs |
| Business | Mix | +39% |
| Education | Mix | +37% |
| Entertainment at scale (10–50M mo. views) | Long-Only | +90% |
| Gaming | Long-Only | +85% |
| Travel / DIY | Either | ~0% |

- **Optimal ratio: 25–40% Shorts by upload count.** Above ~55%, long-form thins.
- **Abrupt pivots (±30+ points in Shorts ratio) ≈ half the median subscriber outcome** of stable strategies. Migrate ratios over months, not weeks.
- Caveats: correlational, quality-uncontrolled, one-year snapshot.

**Mayday application:** Trevor May Baseball (education/fitness profile) is squarely in "mix wins" territory — Shorts should be a first-class format there. More Mayday (entertainment profile) matches the segment where long-only channels lead at scale — run Shorts there deliberately as *funnel devices* (clip → related-video link → episode), keep the ratio modest, and judge them on long-form traffic driven, not on Shorts view counts.

---

## 6. The funnel machinery: making Shorts feed long-form

### Related Video link (the load-bearing tool, launched 2024)

- Persistent tappable link shown **under the Short's title/handle** (renders as the linked video's title text on mobile) pointing to any of your own **public or unlisted** videos, Shorts, or live streams.
- **Requirements/quirks:** channel must have advanced feature access (phone/ID verification); can only be added **after publish**, and **only from desktop** YouTube Studio → Content → (Short) pencil icon → Related video → select target.
- **Operational rule:** make "add related video" a post-publish checklist item on every clip-type Short. An unlinked podcast clip is a wasted funnel.

### Full funnel stack per Short (in order of impact)

1. **Related Video link** → the full episode / matching long-form.
2. **Topic alignment** → the Short covers the *same topic* as a specific long-form video, so YouTube's automatic related-suggestion (topical similarity + same-channel affinity) also fires without the manual link.
3. **Verbal open loop** → "the full breakdown of this pitch grip is in the long video" — say it, don't just caption it. The Short should be a *complete* thought that implies a bigger one, not a cliffhanger amputation (cliffhangers spike swipe-away on rewatch and breed resentment comments).
4. **Pinned comment** with the long-form link.
5. **Playlist pairing** — put the Short and its parent long-form in the same playlist; playlist relationships are a recommendation signal.

### Benchmarks to hold the funnel to

- Long-form views driven per 1K engaged Shorts views: **20–40** is healthy (2–4%).
- Channels running the funnel systematically report **25–40% higher long-form discovery** (Analytics → Traffic sources → check "Shorts feed" appearing as a source on long-form).
- Watch **new vs. returning viewers** on long-form in the weeks after a Short pops — the bridge effect shows up there before it shows in subs.
- Mixed-format channels: ~**3x subscriber growth** and ~2.5x first-year watch time vs. single-format (directional, multiple 2025–26 studies).

---

## 7. Seeding playbook: the first 48 hours

The algorithm has no clock on total lifespan, but the *seed evaluation* concentrates in the first ~48 hours. Stack the deck:

1. **Post when the seed audience is active** — for Mayday's US baseball audience: mornings ET (commute scroll) and 7–10pm ET; in-season, 30–60 min before marquee games puts baseball content into warmed-up feeds. (Timing is not a ranking factor; it just cleans up the seed test.)
2. **Reply to every comment in the first hours** — comments beget comments; creator replies double the engagement events per viewer.
3. **Drive a small external spike** — Substack, IG story, X post linking the Short. Off-platform viewers who *watch through* strengthen the seed read. Do not buy or beg low-intent traffic; junk viewers who insta-swipe actively poison the test.
4. **Don't delete slow starters.** A flat first day means a weak seed match, not a verdict — Shorts resurface. Delete only genuine misfires (wrong audio, error), and prefer setting to private over deleting if it has comments.
5. **Never re-upload the identical file to "retry the algorithm"** — duplicate detection deprioritizes; if the concept deserves a retry, re-cut with a new first 2 seconds minimum.
6. **Batch-analyze weekly, not per-video:** sort the week's Shorts by viewed-vs-swiped and APV; extract the hook pattern of the top quartile; template it.

---

## 8. Timeline of changes that still matter (2024–2026)

| Date | Change | Operational consequence |
|---|---|---|
| Early 2024 | **Related Video link** rolls out on Shorts | Manual funnel from any Short to any own video |
| Oct 15, 2024 | **3-minute Shorts** — vertical/square ≤3 min auto-classified as Shorts | Podcast mini-clips = Shorts; export long-form at 16:9; >1 min + Content ID claim = globally blocked |
| Mar 31, 2025 | **View counting change** — any play/replay counts; old metric renamed **Engaged Views** (Advanced Mode) | Raw views +20–30% with no real change; report/benchmark on engaged views only; YPP + revenue still on engaged views |
| 2025 | Shorts↔long-form **bridge strengthened** — Shorts viewing feeds same-channel long-form recs | Topic-align Shorts to specific long-form videos; funnel measurable in Traffic sources |
| Dec 8, 2025 | 3-min Short classification extended to Official Artist Channels | (Music-side; minor for Mayday) |
| Apr 2026 | Image posts in Shorts feed count toward channel-page view totals | Channel-level "views" now an even softer vanity number |
| Ongoing 2026 | Feed weighting consolidates on **completion rate + swipe-away** as dominant inputs | Diagnosis tree in §3 is the whole game |

---

## 9. Checklists

### Pre-publish (every Short)

- [ ] First frame passes the mute-and-glance test: would *you* stop scrolling with sound off?
- [ ] Hook (visual + on-screen text) inside 1–2 seconds; no intro, no logo, no "wait for it"
- [ ] First payoff lands by the 30% mark
- [ ] Cut to the natural length of the idea (most winners 13–35s; 60s+ only if the arc earns it)
- [ ] Loop check: does the last frame flow back into the first?
- [ ] >60s? Confirm audio is library/royalty-free (Content ID block risk)
- [ ] Vertical 1080×1920; no third-party watermarks
- [ ] Title written for search (keyword-first, human-readable); 1–3 relevant hashtags max
- [ ] Topic matches a coherent cluster this channel is known for (protects seed quality)

### Post-publish

- [ ] **Add Related Video link** (desktop Studio → Content → pencil → Related video)
- [ ] Pinned comment with long-form link
- [ ] Add Short to the playlist containing its parent long-form
- [ ] Reply to comments in first 2–4 hours
- [ ] One off-platform push (story/post/newsletter) to warm viewers

### Weekly review

- [ ] Rank week's Shorts by **engaged views** and **viewed vs. swiped**
- [ ] Top quartile: write down the hook pattern; bottom quartile: first-frame autopsy
- [ ] Long-form Traffic sources: is "Shorts feed" / related-link traffic growing?
- [ ] Shorts share of total uploads still in the 25–40% band per channel?

---

## Common mistakes

1. **Judging Shorts by raw views post-March 2025.** Views count scroll-pasts now. A "100K-view" Short with 55K engaged views and 62% viewed-rate is the real story.
2. **No related-video link.** The single most-skipped step; it's desktop-only and post-publish, so it silently falls off the workflow. Checklist it.
3. **Opening with intro/logo/greeting.** The most interesting frame goes first; the 400ms–2s window decides the whole distribution run.
4. **Uploading vertical podcast segments >60s casually.** They become Shorts (3-min rule), earn Shorts RPM, and get globally blocked if music triggers Content ID over 1 minute.
5. **Chaotic topic mixing on one channel's Shorts.** Random-clip Shorts pull mismatched seed audiences, produce noisy tests, and attract zero-loyalty viewers who then *don't* click the long-form. Every Short should belong to a topic cluster the channel owns.
6. **Cliffhanger amputation clips.** Clips that cut before the payoff spike swipe-away and breed hostile comments. Complete thought → implied bigger thought → link.
7. **Porting TikTok cadence panic.** Deleting "flops" after 24h, reposting identical files, chasing trending audio (no boost on Shorts), or posting daily filler to "feed the algorithm" — none of it maps to Shorts' long-tail, per-video-evaluated system.
8. **Abrupt format pivots.** Swinging the Shorts ratio ±30 points fast correlated with ~half the growth of stable strategies. Ramp over months.
9. **Buying/soliciting junk early views.** Low-intent viewers who insta-swipe contaminate the seed evaluation — worse than no push at all.
10. **Reporting Shorts reach to sponsors without the engaged-views footnote.** Sophisticated buyers know about the counting change; unfootnoted raw numbers now read as either naive or slippery.

---

## Questions Ashley should ask

- "What's the **viewed-vs-swiped** on your last 10 Shorts per channel — and what does the top quartile's first 2 seconds have in common?"
- "Are we looking at **engaged views** or raw views right now?" (Any Shorts performance conversation starts here.)
- "Does this Short have its **related-video link** set? What long-form video is it topically married to?"
- "On the long-form side: is 'Shorts feed' showing up and growing in **Traffic sources**? What % of new long-form viewers crossed over from Shorts this month?"
- "What's the current **Shorts share of uploads** on More Mayday vs. Trevor May Baseball — and is each in the right band for its niche profile (entertainment-at-scale vs. education/fitness)?"
- "Is this clip a **complete thought** or an amputated cliffhanger?"
- "Was this exported vertical and over 60 seconds — and if so, is the audio Content ID-safe and does the length actually earn itself in completion?"
- "When this Short underperformed, was it the **first frame** (high early swipe), the **promise** (mid-video decay), or the **seed match** (fine retention, no expansion)?"
- "Are we treating a slow first 48 hours as a verdict, or leaving it alone to catch the long tail?"
- "If this Short does 500K engaged views, where do the **10–20K funnel views** land — and is that destination video ready to convert them?"

---

## Sources

- vidIQ — How Does the YouTube Shorts Algorithm Work in 2026? — https://vidiq.com/blog/post/youtube-shorts-algorithm/
- AIR Media-Tech — Do YouTube Shorts help your long-form videos? Data from 18,000 channels — https://air.io/en/audience-growth/do-youtube-shorts-help-your-long-form-videos-grow-data-from-18000-channels
- ReelRise — Viewed vs. Swiped Away: The Only YouTube Shorts Metric That Matters — https://reelrise.app/guide/viewed-vs-swiped-away-the-only-youtube-shorts-metric-that-matters/
- YouTube Help — Understand three-minute YouTube Shorts — https://support.google.com/youtube/answer/15424877
- YouTube Help — YouTube Shorts monetization policies — https://support.google.com/youtube/answer/12504220
- YouTube Help — Add a related video to your YouTube Shorts — https://support.google.com/youtube/answer/14075157
- Shortimize — How Does the YouTube Shorts Algorithm Work — https://www.shortimize.com/blog/how-does-youtube-shorts-algorithm-work
- PPC Land — YouTube changes how Shorts views are counted from March 31 — https://ppc.land/youtube-changes-how-shorts-views-are-counted-from-march-31/
- TechCrunch — YouTube is changing how YouTube Shorts views are counted — https://techcrunch.com/2025/03/26/youtube-is-changing-how-youtube-shorts-views-are-counted/
- Market Maker Mgmt — How Shorts and Long-Form Work Together Through Related Videos — https://marketmakermgmt.com/blog-list2/how-shorts-and-long-form-work-together
- TubeAnalytics — YouTube Shorts Analytics: Viewed vs Swiped Away + Benchmarks (2026) — https://www.tubeanalytics.net/blog/youtube-shorts-analytics-guide
- Metricool — YouTube Shorts Algorithm Explained + Tips to Grow in 2026 — https://metricool.com/youtube-shorts-algorithm/
- Panda Video — Shorts and Long-Form Videos on the Same Channel: Does It Hurt? (Sherman/Ritchie/Vollucci statements) — https://www.pandavideo.com/blog/shorts-and-long-form-videos-same-channel
- Gyre — YouTube Shorts view count update: impact and strategy for creators in 2026 — https://gyre.pro/blog/youtube-shorts-view-count-update-impact-strategy-what-to-do-next
- OpusClip — YouTube Shorts vs TikTok: Every Difference Creators Need to Know — https://www.opus.pro/blog/youtube-shorts-vs-tiktok
- Miraflow — How the YouTube Algorithm Decides Who Sees Your Shorts in 2026 — https://miraflow.ai/blog/how-youtube-algorithm-decides-who-sees-your-shorts-2026
