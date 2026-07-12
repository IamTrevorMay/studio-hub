---
title: "Trend Detection & the Jump/Adapt/Skip Decision"
domain: cross-platform
tags:
  - trend-detection
  - trending-audio
  - outlier-analysis
  - jump-adapt-skip
  - trend-lifecycle
  - trendjacking
  - postmortems
sources_reviewed: 14
last_updated: 2026-07-12
---

# Trend Detection & the Jump/Adapt/Skip Decision

## TL;DR

- **Trends die fast — plan around a 5-day median.** Publicis Groupe's multi-market TikTok study: nearly half of trends disappear within 5 days; only a small minority stay relevant past 2 weeks. Micro-trends can go zero-to-saturated in 48–72 hours. If you can't ship inside 24–48h, the answer is Adapt or Skip, never Jump.
- **Run a 15-minute daily scan with fixed surfaces**: TikTok Creative Center (Songs → Breakout tab, sort by 7-day growth), Instagram trending arrow + Trending tab + Professional Dashboard, YouTube outlier tools (vidIQ Outliers is wired into Mayday Studio via MCP), plus the baseball news cycle. Same order every day, log candidates, decide once.
- **Every candidate goes through the Jump/Adapt/Skip gate** — five scored questions (niche fit, runway, speed, effort, fallout). Jump = execute the trend as-is within 48h at ≤2h production. Adapt = translate the trend's *structure* into a baseball/athlete-creator vehicle (works even mid-lifecycle). Skip is the default; it needs no justification.
- **Fit beats speed.** 63% of marketers say brand relevance is the #1 factor for responding to a trend; 39% of brands that jumped too fast saw the content flop with zero engagement (Adobe, 2025). Sprout: 40% of users think brands on trends is cool, 33% find it embarrassing — the difference is whether the trend serves *your* subject matter.
- **Read the lifecycle from usage counts and who's participating.** Audio at 100–1K Reels = early; 1K–10K = proven but unsaturated (the jump window); >30K or brands/local news anchors doing it = you're the punchline. TikTok trends migrate to Reels ~1–2 weeks later — TikTok is your early-warning radar for Instagram.
- **Cap trend content at ~10–20% of output.** Trend jumps never displace pillar/format content (strategy level: see ../../Carl/organic-marketing/04-content-strategy-pillars-repurposing.md). Effort budget per pure jump: ≤2 hours end-to-end.
- **Postmortem every trend piece at 48h and 7d** — non-follower reach, shares/reach, follows/reach vs. channel baseline, plus which lifecycle stage you entered at. Quarterly, review the log for which trend *types* pay for Trevor's channels and prune the scan accordingly.

---

## 1. Why trend ops need a system (not vibes)

The math that forces a system, as of 2025–2026:

- **Median TikTok trend lifespan: ~5 days.** Nearly half of trends vanish within 5 days; only a fraction stay relevant beyond two weeks (Publicis Groupe, multi-market study of "millions of data points" across 7 markets incl. US and Japan). Longevity — not initial virality — is what determines cultural impact; trends that cross 3+ countries share emotional resonance and repeatable/remixable templates, not high launch velocity.
- **Micro-trends peak in 48–72 hours** (Later). Lifecycle: niche creator introduces → saves/shares trigger algorithm amplification → mid-size creators riff → a hashtag/phrase crystallizes → mainstream/brands notice, usually *after* peak.
- **Category lifespans differ** (directional, 2025 data): music/sound trends 3–6 weeks; fitness challenges 2–4 weeks; food ~2 weeks; fashion hashtags 1–2 weeks. Sound trends are the most forgiving format for a small team.
- **Speed is the signal on-platform too**: Socialinsider's study of 6M TikTok posts (72K accounts, Jan–Aug 2025) found most views land in days 1–5; if a video is going to take off you see it in the first 72 hours. This applies to trend *detection* as well — a trend's own early velocity predicts whether it will still be alive when you publish.

Consequence: an ad-hoc "saw it, felt like it" approach systematically enters trends at stage 4–5 (crystallized/mainstream) and publishes after death. The only fix is (a) daily scanning of *early* surfaces and (b) a decision gate with a hard speed requirement.

Ashley's job here is not to make Trevor a trend account. It's to catch the 2–4 trends per month where a baseball/athlete-creator angle exists, execute them cheaply, and skip everything else without FOMO.

---

## 2. The daily trend scan (15–20 min, fixed order)

Run once a day, same time (morning PT works — overnight US trends have 8–12h of velocity data). Output: 0–3 candidates logged into a running trend log, each with a same-day Jump/Adapt/Skip call.

### 2.1 Surfaces, in order

**A. TikTok Creative Center (~4 min)** — free, official TikTok data, no ad account needed (ads.tiktok.com/business/creativecenter). As of 2026:
1. Set region = US and industry filter first — trend rankings vary heavily by both.
2. **Trend Discovery → Songs**: sort by **7-day growth rate**, check the **Breakout** tab (rising, pre-saturation) before Popular (already peaked). Filter to organic/non-commercial sounds first — they're earlier in lifecycle. Note "Approved for business use" flag if the piece might ever be sponsored.
3. **Trending Hashtags**: filter "New to Top 100" — that flag is the early-mover signal. Click "See Analytics" on anything sports-adjacent: trendline shape (still climbing?), audience insights (age skew), regional popularity, related hashtags.
4. Data refreshes near-real-time; checking daily is enough.

**B. Instagram (~3 min)** — Reels trends lag TikTok by ~1–2 weeks, so anything spotted in (A) that fits gets a calendar note for the Reels window:
- Scroll Reels feed; watch for the **upward arrow** next to audio names — Instagram's own "actively growing" flag.
- **Trending tab** (music icon when creating a Reel → Trending): top ~50 songs, refreshed every few days.
- **Professional Dashboard → Tips and Resources → Trending audio** (US professional accounts): curated trending list incl. an Original audio tab.
- Follow **@creators** — posts a weekly trending-audio report.
- On any candidate sound, tap the audio name to see the **usage count** (see §3 thresholds). Bookmark-save promising sounds immediately; the save is free and the sound page shows you the top executions to study.

**C. YouTube (~5 min)** — trends here are *format/topic* trends, not audio trends, and they move slower (weeks, not days):
- **Outlier tools**: vidIQ Outliers is available directly inside Mayday Studio via MCP (`vidiq_outliers`, `vidiq_trending_videos`, `vidiq_breakout_channels`, and `vidiq_ig_outlier_reels_search` for Reels). Scan competitor set + adjacent niches (baseball creators, athlete-creators, sports entertainment) for videos running 3–10x channel average. vidIQ scores outliers in standard deviations above channel mean; ViewStats color-codes (blue 2–5x, purple 5–10x, red 10x+); 1of10 filters 6–100x. As of 2026 pricing: vidIQ from ~$7.50/mo, 1of10 and OutlierKit ~$29/mo, ViewStats Pro ~$50/mo — the MCP-connected vidIQ covers Trevor's need.
- Focus on channels **2–5x Trevor's size** — their outliers are replicable; MrBeast-tier outliers are not. Study 3x–10x multipliers; ignore 20x+ flukes (strategy level: see ../../Carl/organic-marketing/12-analytics-experimentation.md).
- **Views-per-hour on fresh competitor uploads** is the earliest YouTube trend tell — a 2-day-old video already at channel-average lifetime views means the topic/format has heat *now*.
- Google Trends (trends.google.com): only for topic-level confirmation ("torpedo bat", a rule change, a player name spiking) — 7-day view, compare against a known-volume baseline term.

**D. Baseball/sports news cycle (~3 min)** — Trevor's unfair advantage is that his niche's "trends" are often *news events* he can react to with insider authority faster than any tool can surface them:
- X/Twitter: MLB, team accounts, Jomboy Media, Foolish Baseball, Pitching Ninja — viral plays, ejections, mic'd-up moments, rule controversies.
- The `research_trends` output already generated daily inside Mayday Studio (Claude analysis of last 48h of RSS articles) — treat its "current events" list as a scan surface, not a decision.
- Known calendar heat: trade deadline, playoff races, HOF votes, spring training quirks, CWS, international signings. Pre-plan these (IKEA's playbook: their Bridgerton post was prepped weeks before the season dropped — predictable moments deserve prepared assets).

**E. Log it (~2 min).** Every candidate gets one line: date spotted, surface, usage count / velocity note, lifecycle stage guess, and the J/A/S call with one-line reason. No log entry = the postmortem system (§7) has nothing to learn from.

### 2.2 Weekly deep scan (30 min, once)

- TikTok Creative Center hashtag analytics on the sports/fitness industry filter — trendline shapes over 30 days.
- vidIQ outlier sweep across the full competitor list + `vidiq_similar_channels` expansion.
- Review which logged trends you skipped that later blew up in-niche (a "regret log") — it calibrates the gate.

---

## 3. Reading trend velocity and lifecycle

### 3.1 The five stages and their tells

| Stage | What it looks like | Your move |
|---|---|---|
| 1. Emergence | One niche creator's clip getting anomalous saves/shares; audio at <100 uses; not on any trending surface yet | Watch. Jumping here is a lottery ticket — fine only if effort ≈ zero |
| 2. Acceleration | Mid-size creators riffing; audio 100–1K uses; appears in Breakout tab / gets the IG arrow; 7-day growth steep | **Jump window opens.** Best risk/reward |
| 3. Crystallization | A named hashtag/phrase is the shorthand; audio 1K–10K uses; on Popular/Trending lists | Jump window closing — ship within 24–48h or convert to Adapt |
| 4. Saturation | Audio >10–30K uses; every niche has a version; brands arriving | **Adapt only** — a strong niche twist can still work; a straight copy reads as late |
| 5. Decay | Ironic/meta versions; "this trend is dead" comments; clown-emoji ratios; local news covers it | Skip. Exception: deliberate parody of the trend's death, which is its own (risky) format |

### 3.2 Hard signals to check on any candidate

- **Audio usage count** (IG: tap the sound; TikTok: sound page). Sweet spots per 2025–26 practitioner consensus: **100–1,000 uses = early**, **1,000–10,000 = proven traction, not saturated** (the highest-percentage entry), **>10K = late on Reels for a small account** (you'll rank below hundreds of versions).
- **Trendline shape** in Creative Center analytics: still-climbing beats peaked-and-flat, always. A hashtag that's "New to Top 100" beats one that's held rank for 3 weeks.
- **Who's participating**: creators only = alive; brands, franchises, and morning shows = stage 4+.
- **Cross-platform position**: exploding on TikTok, absent on Reels = you have a ~1–2 week Reels window. This is the single most reliable arbitrage in trend ops as of 2026.
- **Comment sentiment**: genuine tags/shares vs. "not this again" and clown-emoji ratios (Zoomsphere's tell: sentiment already negative = too late).
- **Emotion + remixability** (Publicis): trends built on a shared emotion with an easy-to-remix template (a transition, an audio cue, a caption structure) live longest and travel across niches — these justify more effort. Trends that are one specific joke die fastest.

### 3.3 Platform speed constants (as of 2026)

- TikTok video: most views in days 1–5; virality visible within 72h; total lifecycle ~20–30 days.
- Tweet half-life ~49 minutes; Instagram post ~19h; LinkedIn ~24h — reaction content on X must ship same-hour, on IG same-day.
- TikTok → Reels trend lag: ~1–2 weeks. Reels → YouTube Shorts lag exists but is noisier.
- 27% of social users say a brand joining a trend only works within **24–48 hours** of the trend emerging (Sprout).

---

## 4. The Jump/Adapt/Skip gate

Run this on every logged candidate, same day. Five questions, score 0–2 each (10 max). It merges the field's converging frameworks — Konnect's four filters (audience fit / brand permission / speed-vs-quality / shelf life), Zoomsphere's F³ (Fit / Feasibility / Fallout, threshold 7+), Later's participate/skip lists — into one gate tuned for Trevor.

**Q1 — Niche fit (0–2).** Can this trend carry baseball, athlete-life, or Trevor's personality *without stretching*? 2 = the baseball version is obvious in 10 seconds ("this trend but pitch grips" / "but bullpen culture" / "but retired-athlete life"). 1 = a workable angle exists with thought. 0 = we'd be a generic account doing a generic trend. Brand relevance is the top factor 63% of marketers use — and it's the difference between the 40% of users who find brand trend-content cool and the 33% who find it embarrassing.

**Q2 — Runway / shelf life (0–2).** Which lifecycle stage (§3.1)? 2 = stage 2. 1 = stage 3, or stage 4 with a strong Adapt angle. 0 = stage 5, or the trend will feel stale by our earliest publish slot ("will this feel relevant when it goes live?" — Konnect).

**Q3 — Speed-to-publish (0–2).** 2 = shootable today with phone + existing footage/facility access, publishable in <24h. 1 = <48h. 0 = needs the edit queue, a shoot day, or a collaborator's schedule. (39% of brands that jumped fast anyway saw the content flop — speed without the other four scores is how that happens.)

**Q4 — Effort budget (0–2).** 2 = ≤1 hour all-in. 1 = ≤2 hours. 0 = would displace pillar content or a scheduled format episode. Trend content is a garnish on the 70–80% evergreen base, never the meal (strategy level: see ../../Carl/organic-marketing/04-content-strategy-pillars-repurposing.md).

**Q5 — Fallout (0–2).** Worst realistic case? 2 = worst case is it's ignored. 1 = mild cringe risk. 0 = any contact with tragedy, politics, a marginalized community's in-group content, another player's misfortune (injuries are never trend material for a former player — peer respect is an asset), or unlicensed/commercial-restricted audio on anything sponsored. A 0 on Q5 is an automatic Skip regardless of total.

**Decision:**

| Score | Call | What it means |
|---|---|---|
| 8–10 (no zeros) | **JUMP** | Execute the trend in its native template, baseball-skinned, shipped <48h, ≤2h effort |
| 5–7, with Q1 ≥ 1 | **ADAPT** | Take the trend's *structure* and rebuild it as a Trevor-format piece on a normal timeline (see §5) — adaptation refreshes a mid/late-lifecycle trend because the niche angle is new even when the template isn't |
| ≤4, or any Q5 = 0 | **SKIP** | Default outcome. Log one line and move on. Selectivity is the strategy: audiences punish trend-chasing accounts with fatigue and desensitization |

Two operating rules on top of the gate:

- **The 90-minute drill** (Zoomsphere): for reactive/news moments, set a 90-minute clock from spot → context check → draft → gut-check → post-or-archive. If it's not out (or consciously scheduled) in 90 minutes on X / same-day on short-form, archive it. Deadlines kill the "maybe tomorrow" zombie drafts that ship at stage 5.
- **Pre-clear the predictable.** Trade deadline, Opening Day, playoffs, awards season: draft trend-shaped assets in advance the way IKEA pre-built its Bridgerton post. Reactive speed is mostly *preparation*, not fast hands.

---

## 5. Adaptation craft: making a trend serve the niche

Adaptation is the highest-value move in Trevor's position — an athlete-creator has proprietary raw material (MLB experience, facility access, insider fluency) that turns a commodity trend into content only he can make.

**The core operation: keep the template, swap the subject.**
A trend = a recognizable container (audio + cut pattern + caption format + a beat structure) + a generic subject. Adaptation preserves every recognizable container element and replaces only the subject with niche material. If you change the container, viewers don't register it as the trend (you lose the distribution tailwind); if you don't change the subject, you're a copy (you lose the reason to follow *you*).

**Execution rules:**
1. **Signal the trend in the first second** — the audio's first beat, the recognized framing, the caption format. The viewer's brain must go "oh, that trend" instantly.
2. **Land the niche twist by second 2–3.** The comedy/interest is the collision: familiar template × unexpected baseball-world content.
3. **Never explain the trend.** A setup line ("you know that trend where...") marks you as late and wastes the hook. If it needs explanation, the audience overlap failed Q1.
4. **Hit the trend's beat structure exactly.** Trending audio has known sync points; the top executions on the sound page are your spec sheet. Off-beat cuts read as low-effort.
5. **Add one only-Trevor element** per piece: MLB footage he appears in, a pitch-grip demo, Neptune facility setting, a "what the dugout actually says" insider reveal. This is what converts trend viewers into followers instead of drive-by views.

**Adaptation vectors for Trevor's three lanes:**
- **Baseball/sports:** trending audio over pitch breakdowns; "POV" formats recast in bullpen/clubhouse settings; ranking/tier-list trend templates applied to pitches, stadiums, baseball unwritten rules; transition trends using windup mechanics as the transition.
- **Athlete-creator lane:** "day in the life" and "expectation vs. reality" trend waves recast as retired-pro life; trends about jobs/coworkers recast as teammates/coaches; the Bryce Harper model — TikTok itself points MLB players to Harper's mix of behind-the-scenes baseball with outside passions (fashion, cooking, travel, family) as the template (2026 MLB×TikTok player program). Mascot-as-creator (Mets' Mr. Met, Phillie Phanatic run as full influencer characters with recurring bits and platform-native humor) shows how far a sports entity can push trend participation.
- **Entertainment crossover:** react/green-screen formats on viral plays; duet/stitch trends where Trevor's credential *is* the twist ("actual MLB pitcher rates this"). MLB's own playbook is instructive: platform-specific trend treatment (memes on TikTok, nostalgia on IG) drove +136% TikTok and +189% IG engagement during the 2024 World Series, and #MLB posts grew 60% in 2025 — baseball trend content has a rising tide as of 2026.

**Adaptation timeline advantage:** because the niche twist is novel even when the template isn't, an Adapt can ship at stage 3–4 and still perform — the audience it reaches (baseball fans) has mostly seen the trend but *not* the baseball version. This is why Adapt carries a lower speed requirement than Jump.

---

## 6. Effort budget and portfolio position

- **Volume cap:** trend-native content ≈ 10–20% of short-form output; 0% of long-form is required to be trend-driven (YouTube long-form "trends" are format/topic patterns handled through outlier analysis and idea selection, not trend-jumping).
- **Per-piece caps:** Jump ≤2h all-in (target ≤1h). Adapt = normal short-form budget, but it must earn its slot against pillar ideas on expected value, not novelty.
- **Never bump pillar content.** A trend piece is *additive* to the calendar or it doesn't happen. The compounding assets are formats and series (strategy level: see ../../Carl/organic-marketing/04-content-strategy-pillars-repurposing.md); trends are discovery spikes that feed them.
- **Batch the cheap ones:** when a sound is bookmarked at stage 2, note 2–3 executions; if the trend survives 3–4 more days (music trends run 3–6 weeks), shoot two versions in one session.
- **Repurpose the winners:** a trend piece that outperforms (§7) gets the standard cross-platform treatment — TikTok → Reels (respecting the 1–2 week lag actually *helps* here) → Shorts, re-hooked natively per platform.

---

## 7. Postmortem discipline

Without postmortems, trend ops devolve into superstition. Two checkpoints plus a quarterly review, all appended to the same trend log started in §2.1E.

**48-hour check (2 min/piece):** views vs. channel short-form median; non-follower reach %; early comment sentiment. On TikTok, 72h tells you essentially the final story (Socialinsider) — a piece flat at 48–72h is a miss; log it and move on (no deleting; deletions destroy the dataset).

**7-day scorecard (5 min/piece), fields:**
- Trend name + surface it was spotted on + lifecycle stage at entry (1–5)
- Call made (Jump/Adapt) + gate score + hours spent
- Views ÷ channel rolling median (outlier multiplier)
- Non-follower reach % vs. baseline
- Shares/reach and saves/reach vs. baseline (the north-star short-form signals — strategy level: see ../../Carl/organic-marketing/12-analytics-experimentation.md)
- Follows per reach vs. baseline — *the* number that says trend viewers converted
- One-line verdict: what the twist was, and would we run this trend *type* again

**Quarterly pattern review (30 min):**
- Which trend types pay for Trevor: audio-template trends vs. news-reaction vs. format trends? Which lane (baseball / athlete-life / crossover) converts followers best?
- Entry-stage analysis: what's our average entry stage, and do stage-2 entries actually outperform our stage-3s? (If not, the daily scan is fine and the gate is too loose — or vice versa.)
- Regret log: skipped trends that later worked in-niche → which gate question wrongly killed them?
- Prune: drop scan surfaces that produced zero winners in a quarter; the scan must stay ≤20 min.
- Update the gate weights if evidence demands it — the framework is a hypothesis, the log is the data.

**Kill criteria for the whole program:** if two consecutive quarters show trend content underperforming pillar content on follows-per-reach *and* shares-per-reach, cut the volume cap to ~5% and reallocate the scan time to outlier-driven ideation. Trend ops must pay rent.

---

## 8. Common mistakes

1. **Entering at stage 4–5 and publishing at stage 5–6.** The default failure mode for any team without a daily scan. If brands and news anchors are already doing it, you're the "how do you do, fellow kids" post.
2. **Copying without a twist.** A 1:1 trend copy gives viewers zero reason to follow and ranks below hundreds of identical versions. The twist *is* the strategy.
3. **Explaining the trend in the content.** Instant late-mover tell; burns the hook window.
4. **Tragedy/controversy trendjacking.** DiGiorno using #WhyIStayed (a domestic-violence hashtag) to sell pizza; Kenneth Cole tying promos to the Arab Spring. Assess the emotional weight of the source moment before entering — Q5 exists for this, and it vetoes everything.
5. **Forcing an off-brand trend.** The British Museum's "single women, act confused at the Roman Army exhibit" TikTok drew sexism accusations — a trend that requires the brand to pretend to be something it isn't (Later's #1 skip criterion). For Trevor specifically: anything mocking current players' failures or injuries torches the insider-access moat.
6. **Over-participation / trend fatigue.** Accounts that chase everything become predictable and get tuned out; even Duolingo — the genre's master — drew "cheap, unoriginal" backlash on its Feb 2025 dead-owl stunt. Selectivity is what keeps trend content working: show up where it fits, then leave before it's stale.
7. **Wrong audio licensing on commercial content.** Using non-"Approved for business use" sounds on anything sponsored (Neptune promo counts) risks takedowns/mutes. Check the flag in Creative Center/IG before a sponsored trend piece.
8. **Treating 20x+ outliers as strategy.** Study replicable 3–10x patterns from channels 2–5x your size; mega-viral flukes teach nothing repeatable.
9. **No pre-planning for predictable moments.** Trade deadline and Opening Day come every year; scrambling reactively for scheduled events means competing on speed you didn't need to compete on.
10. **Skipping the log/postmortem.** Without entry-stage + outcome data, the team re-litigates every trend from scratch and learns nothing. The log is the moat.
11. **Measuring trend pieces on raw views.** Trend distribution inflates views; follows-per-reach and shares-per-reach against baseline are the honest scoreboard.
12. **Ignoring the TikTok→Reels lag.** Publishing a trend on both platforms simultaneously wastes the 1–2 week Reels arbitrage window — stagger it.

---

## 9. Questions Ashley should ask

Before recommending a jump:
- "What lifecycle stage is this at *right now* — what's the audio usage count, and is the trendline still climbing in Creative Center?"
- "What's the baseball/athlete version in one sentence? If it takes longer than a sentence, it's a Skip."
- "Can this ship in the next 24–48 hours without touching the pillar calendar? Who shoots it, with what footage?"
- "What does this look like if it goes wrong — who could this offend, and does it touch any player's misfortune?"
- "Is this a Jump (their template, our skin) or an Adapt (our format, their structure)? Are we sure we're not paying Jump speed-costs for Adapt value?"

For the system:
- "When did we last check the trend log's regret list — what did we skip that we shouldn't have, and which gate question was wrong?"
- "What's our average entry stage this quarter, and are stage-2 entries actually outperforming?"
- "Which trend type has the best follows-per-reach for us — audio templates, news reactions, or format trends — and are we scanning hardest where we win?"
- "Which predictable baseball moments in the next 60 days should have pre-built trend-shaped assets today?"
- "Is trend content still ≤20% of output, and is it beating pillar content on shares- and follows-per-reach — or is it time to cut the cap?"
- "Has the sound we're planning for the Neptune promo been checked for commercial approval?"

---

## Sources

- Publicis Groupe TikTok trend lifespan study (via Marketing-Interactive) — https://www.marketing-interactive.com/only-a-fraction-of-tiktok-trends-last-beyond-two-weeks-publicis-groupe-finds
- Sprout Social, "The Guide to Effective Trendjacking" — https://sproutsocial.com/insights/trendjacking/
- Adobe Express, "How marketers are handling the pressure to chase trends" (2025 survey) — https://www.adobe.com/express/learn/blog/jumping-on-trends
- Later, "Micro-Trends on TikTok and Instagram: What Brands Can Learn" — https://later.com/blog/how-micro-trends-take-over-socials/
- Zoomsphere, "How Fast Is Too Fast When Following a Trend?" (F³ framework, 90-minute drill) — https://www.zoomsphere.com/blog/how-fast-is-too-fast-when-following-a-trend
- TikTok Ads Help Center, "How to use Trends" (official, updated July 2026) — https://ads.tiktok.com/help/article/how-to-use-trends
- Stackmatix, "TikTok Creative Center: How to Use It (Free 2026 Guide)" — https://www.stackmatix.com/blog/tiktok-creative-center-guide
- Buffer, "Trending Sounds on Instagram + How to Use Them" (2026) — https://buffer.com/resources/trending-audio-instagram/
- Turrboo, "How to Find Trending Audio on Instagram (Reels Guide 2026)" (usage-count sweet spots) — https://turrboo.com/blog/how-to-find-trending-audio-on-instagram
- Socialinsider, "How Long Does It Take for a TikTok to Get Views?" (6M-post study, 2025) — https://www.socialinsider.io/blog/tiktok-virality-insights/
- OutlierKit, "Best YouTube Outlier Finder Tools" (tool/pricing comparison, 2025–26) — https://outlierkit.com/blog/best-youtube-outlier-finder-tools
- vidIQ, "Outliers" feature documentation — https://support.vidiq.com/en/articles/9660010-outliers
- Sportico, "During Spring Training, These MLB Players Brushed Up on TikTok" (2026 MLB×TikTok program, Harper model) — https://www.sportico.com/business/tech/2026/mlb-tiktok-partnership-athletes-harper-julio-rodriguez-tips-1234885378/
- Marketing Brew, "How Major League Baseball is looking to capture younger audiences" (2026; mascot-as-creator, #MLB growth) — https://www.marketingbrew.com/stories/2026/03/26/major-league-baseball-social-media-marketing
- Konnect Agency, "Trendjacking" (four-filter evaluation) — https://www.konnectagency.com/trendjacking/
- Best Colorful Socks, "TikTok Product Trend Lifespan Statistics 2025" (category trend lifespans) — https://bestcolorfulsocks.com/blogs/news/tiktok-product-trend-lifespan-statistics
