---
title: "Facebook Video & Reels Algorithm (2025-2026)"
domain: facebook
tags:
  - facebook-reels
  - facebook-algorithm
  - unified-video-player
  - unconnected-distribution
  - watch-time
  - facebook-demographics
  - sports-content
  - crossposting
sources_reviewed: 16
last_updated: 2026-07-12
---

# Facebook Video & Reels Algorithm (2025-2026)

Tactical reference for Facebook video distribution as it works NOW. Everything here is dated because Facebook changed more between mid-2025 and mid-2026 than in the prior five years combined. Strategy-level short-form doctrine (hooks, retention targets, clip selection, cadence) lives in the Carl docs — this file covers the Facebook-specific machine.

## TL;DR

- **Every Facebook video IS a Reel now.** As of June 2025 the separate "Video" upload path is gone — all uploads publish as Reels with no length or format cap, in the full-screen Reels player. There is no "regular video vs. Reel" decision to make anymore; there is only "how do I win in the Reels surface."
- **Facebook is now a discovery platform, not a friends-feed.** Unconnected (AI-recommended) content went from ~20% of feed (Zuckerberg, 2023) to 40-50% by 2026. A page with 2,000 followers can reach 500K people; a page with 500K followers can reach 2,000. Follower count is the weakest it has ever been as a reach predictor.
- **Watch time is the master signal, and long Reels win it.** Per Meta (Oct 2025): Reels over 1 minute are only 25% of uploads from 10K+ creators but drive **over 50% of Facebook watch time**. US video watch time on FB grew 20%+ YoY. Facebook is the one short-form surface where 60-90s+ clips are structurally advantaged, not penalized.
- **Freshness got a hard boost (Oct 2025):** the algorithm now surfaces **50% more Reels published the same day**. Facebook content has a real day-one window now — post when your audience is on (US evenings for baseball fans), not whenever the queue fires.
- **Originality enforcement is severe and fingerprint-based (July 2025 → hardened March 2026).** Meta fingerprints every video's structure/content and knows who uploaded it first. Re-uploads, watermarked clips, and low-value-add reaction/stitch content get feed+Reels demotion, demonetization, and "non-recommendable" status. Original Reels' views/watch time roughly **doubled** H2 2025 vs H2 2024 because the junk got cleared out. Raw MLB highlight re-posts are a trap; Trevor's commentary layer is the shield.
- **Facebook is where the baseball-parent/coach demographic actually lives.** Facebook reaches 88% of Gen X and 88% of Boomers (vs. IG's 60%/39%). The 35-65 audience — parents paying for lessons, coaches, lifelong fans — over-indexes on FB harder than any other platform. For Neptune Performance local marketing, FB (feed + Groups) is arguably the single highest-value organic surface.
- **Money is on the table right now (as of 2026):** unified Facebook Content Monetization pays on Reels, long video, photos, and text; Facebook paid creators ~$3B in 2025 (+35% YoY); and **Creator Fast Track** guarantees $1K/mo (100K+ followers on IG/TikTok/YT) or $3K/mo (1M+) for three months plus boosted reach for established creators new to Facebook. Check Trevor's eligibility immediately.

---

## 1. The 2025-2026 timeline — what changed and when

Know these dates; they explain every "why did my reach change" question.

| Date | Change | Practical effect |
|---|---|---|
| **June 2025** | **Unified video player / everything-is-a-Reel.** All new FB video uploads publish as Reels; length and format restrictions removed; Video tab renamed Reels tab; one editing interface; audience settings aligned between Reels and posts | No more format choice. Long-form, vertical, horizontal — all compete in one ranked video pool. Performance metrics wobbled mid-2025 as ranking recalibrated |
| **July 14, 2025** | **Unoriginal-content crackdown.** Formal penalties for accounts repeatedly reusing others' material without meaningful enhancement | Reduced distribution account-wide, demonetization, "non-recommendable" flag. Watermarked TikTok/YT re-uploads explicitly targeted |
| **Aug 31, 2025** | **Reels Play bonus shut down**; replaced by unified Content Monetization (in-stream ads + ads on Reels + performance bonus in one program, one payout) | One program, all formats earn. Monthly earning caps on performance bonus later removed |
| **Oct 7, 2025** | **Reels algorithm update:** faster interest-learning, **+50% same-day Reels** in recommendations, "Not Interested" flag, upgraded Save (saves feed recommendations and "led to increased watch time globally"), Friend Bubbles (see friends' likes on Reels), AI search suggestions on Reels | Freshness matters again; saves became a first-class ranking signal; social proof (friends' likes) surfaces visibly |
| **Oct-Dec 2025** | Meta AI interactions begin informing content/ad personalization (notices Oct 7, live Dec 16, 2025) | User interest profiles get richer; niche targeting of recommendations gets sharper |
| **Jan 2026** | **User True Interest Survey (UTIS)** model for Reels: in-feed 1-5 "how well does this match your interests?" prompts train ranking beyond behavioral signals | Watch time alone no longer proves interest — "watched passively but rated low" content loses reach. Punishes rage-bait and hate-watching; rewards genuinely-wanted niche content |
| **March 2026** | **Originality enforcement hardened + rewarded.** Meta fingerprints each video (pattern-based structure/content ID) and tracks first uploader; original Reels views/watch time ~doubled H2'25 vs H2'24; 20M+ impersonation accounts removed in 2025; **Creator Fast Track** launched | First-uploader attribution is machine-enforced. Being the origin account for a clip matters; re-posters of your content lose, you win |
| **March 2026** | Meta unified the 9:16 safe zone across FB Stories, FB Reels, IG Stories, IG Reels | One vertical master asset works everywhere (specs in §7) |

---

## 2. How distribution actually works now

### The two audiences every Reel is ranked for

1. **Connected reach** — followers + friends-of-engagers. Still seeded first, but this is now the minority of potential reach.
2. **Unconnected reach ("AI-recommended")** — the recommendation engine placing your Reel in front of strangers whose interest profile matches. Zuckerberg put AI-recommended unconnected content at 20%+ of feed back in 2023; third-party analyses in 2026 put it at **40-50% of what users see**. This is where all meaningful growth comes from.

### The recommendation pipeline (Meta's own description)

- **Stage 1 — Retrieval:** systems narrow billions of items to thousands of candidates in hundredths of a second, matching content embeddings to user interest embeddings.
- **Stage 2 — Ranking:** models (tens of trillions of parameters) make pointwise and listwise predictions — "will this user watch/like/share/save this?" and "does this item improve this session's mix?" — balancing engagement with variety.
- **Content understanding:** Meta's models do visual recognition, object detection, text extraction (on-screen text IS read), audio recognition, topic classification, and similarity matching. They can distinguish "road cycling vs. mountain biking" — i.e., they can distinguish "pitching mechanics breakdown" from "generic MLB highlight." Say your niche words on camera and in on-screen text; the machine is listening.

### Signal hierarchy for Reels ranking (as of 2026, strongest first)

1. **Watch time** (total seconds delivered — this is why long Reels dominate)
2. **Completion / re-watch** — Oct 2025 update weighted repeat views more heavily
3. **Saves** — explicitly elevated in Oct 2025; saving trains the recommender and Meta says it drove global watch-time gains
4. **Shares** (including DM shares) — strongest social-propagation signal
5. **Comments** — quality conversation > volume; comment-flagging also feeds ranking
6. **Likes/reactions** — weakest positive signal
7. **Negative signals:** "Not Interested" flags, hides, fast skips, low UTIS ratings — these actively suppress
8. **Account-level modifiers:** originality history (fingerprint-based), topical consistency (coherent interest profile), engagement-bait history (page-level demotion), non-recommendable status

### Account-level topical consistency

Facebook builds an interest profile for the page. Per Social Media Examiner's 2026 analysis: core output should target the niche; broader-appeal content is fine if topically connected; occasional off-topic posts don't hurt if a coherent profile dominates. For Trevor: baseball/pitching/athlete-life is the coherent core; podcast entertainment-crossover clips are the acceptable adjacent layer; random memes are noise that blurs the profile.

### UTIS — the survey layer (Jan 2026)

Facebook now shows some viewers a 1-5 "how well did this match your interests?" prompt after Reels. This closes the loophole where high watch time from passive scrolling or hate-watching earned reach. Implication: content optimized to annoy or trick ("wait for it..." with no payoff) now gets caught even when retention looks fine. Content that a niche genuinely wants — a pitch-grip breakdown a coach would rate 5/5 — gets a signal boost behavioral data alone never gave it.

---

## 3. Watch-time weighting and video length on Facebook

This is the biggest strategic difference from TikTok/IG:

- **Meta's own numbers (Oct 2025):** Reels >1 minute = 25% of uploads from creators with 10K+ followers, but **>50% of all Facebook watch time**. US video time on FB up 20%+ YoY.
- Because ranking optimizes total watch time delivered, a 3-minute video watched 40% of the way (72s) beats a 20-second video watched to completion (20s) on the master signal. Facebook is the short-form surface most friendly to **60s-3min "mid-form"** — podcast segments, full at-bat stories, multi-pitch breakdowns.
- **Socialinsider 2025 comparison data:** FB Reels peak engagement and shares at **~90 seconds** (avg 21 shares, ~4,000 views per post at that length) vs. IG Reels peaking at 1-2 minutes (0.70% ER, 65 shares, 5,700 views). 90s is the FB sweet spot in large-N data.
- Third-party analyses (unverified vs. Meta) claim Reels with watch-through above ~70% get 2-3x wider distribution — directionally consistent with everything Meta says, treat the exact multiple as soft.
- **Practical length ladder for Trevor's FB (as of 2026):** 60-120s podcast/story clips as the workhorse; 2-4min breakdowns as watch-time plays; sub-30s only for pure-hook viral swings. This is nearly the inverse of TikTok guidance — do NOT ship identical cutdowns everywhere. (Hook/retention craft: see ../../Carl/organic-marketing/02-short-form-strategy.md)

---

## 4. How Facebook reach differs from Instagram (same company, different machine)

| Dimension | Facebook Reels | Instagram Reels |
|---|---|---|
| Graph | Historically friends/relationship graph, now aggressively interest-graph for video; Groups still relationship-driven | Relationship-weighted first distribution, then interest expansion |
| Unconnected share of feed | 40-50% (2026) | High but IG seeds followers first |
| Avg Reel engagement rate | **0.13%** (Socialinsider) | **up to 0.70%** at 1-min length (~5x FB) |
| Avg views per Reel (optimal length) | ~4,000 @ 90s | ~5,700 @ 60s |
| Shares | 21 avg @ 90s | 65 avg @ 2min |
| Optimal length | ~90s (mid-form advantaged) | 60-120s |
| Audience skew | Older, broader, more male 25-34 globally but strongest *relative* hold on 45+ | Younger, trendier |
| Freshness | +50% same-day boost (Oct 2025) | No equivalent stated boost |
| What FB is for | Cheap incremental reach to older/parent demo, Groups community, monetization on all formats | Brand/culture relevance, younger fans |

Interpretation: IG delivers deeper engagement per view; FB delivers **breadth into a demographic IG barely touches**, plus direct payouts. FB is a distribution-and-monetization surface, not a community-prestige surface.

### Crossposting IG → FB (the practical question)

- Meta's official crossposting toggle (share IG Reels to Facebook) is legitimate, gives incremental FB reach, and does NOT trigger originality penalties — Meta treats it as the same owner. It's the minimum-viable FB strategy.
- **But:** trueanthem and multiple 2025 analyses report Facebook prioritizes Reels **posted natively to FB** over crossposted ones, and crossposting conflates analytics (merged play/like counts make FB-specific performance unreadable).
- **Never** re-upload a file with a TikTok watermark — detected and deprioritized on both apps.
- Recommended ladder: (a) floor = turn on IG→FB crossposting today; (b) real play = native FB uploads of the 60-120s mid-form cuts with FB-specific captions (plainer language, more context, question to spark comments — FB commenters are chattier and older); (c) measure separately via the FB Professional Dashboard.

---

## 5. Who is actually on Facebook (demographic reality, 2026)

- ~3.07B MAU globally. Largest single cohort: men 25-34 (~18% of users). Age mix: 25-34 ≈ 30%, 35-44 ≈ 21%, 18-24 ≈ 18%, 45-54 ≈ 14%, 55-64 ≈ 9%, 65+ ≈ 8%. The 55+ share nearly doubled since 2015 (~9% → ~17%).
- **Platform reach by generation (US, 2026 syntheses of Pew/industry data):**
  - Gen Z: FB 77% (behind YT 91%, IG 86%, TikTok 79%) — present but not home
  - Millennials: FB 89% (only YT higher) — peak FB generation
  - Gen X: **FB 88%** — #1 platform for them (IG only 60%)
  - Boomers: **FB 88%** — #1 by a landslide (IG 39%, TikTok 20%)
- Pew (fielded Feb-Jun 2025): YouTube and Facebook remain the two most-used platforms among US adults, period.
- **Translation for Trevor:** the people who (a) watched him pitch live on TV for a decade, (b) coach youth baseball, and (c) are parents deciding where their kid trains — Millennials through Boomers — are all on Facebook at 88-89% penetration. This is the platform where "retired MLB pitcher" carries maximum name recognition per impression. It is also the ONLY major platform where Neptune's actual customers (paying parents, 35-55) are the default population rather than a minority.
- FB Reels consumption specifically skews younger *within* FB (the Reels surface pulls the 25-44 band), so Reels on FB ≈ reaching the parent/coach demo, not the retiree demo.

---

## 6. Sports and baseball content on Facebook

- 42% of social users follow sports/recreation topics (2025 State of Social). Sports is a top-tier interest vertical in Meta's recommendation taxonomy — the interest graph can find baseball fans precisely.
- **Facebook's role in the sports ecosystem (2025-2026):** leagues use TikTok/IG for youth acquisition and Facebook for the established fan base — longer discussion, community, nostalgia. MLB's own social strategy leans nostalgia content notably hard on FB because the audience lived those moments.
- **What performs for sports pages on FB:** highlights fused with storytelling/commentary, behind-the-scenes, player-perspective content, nostalgia ("remember when"), and anything that triggers comment debates (takes, rankings, "who's better" framings — FB's older users comment at high rates and comment threads compound reach).
- **The originality trap for baseball creators:** raw MLB footage re-posts are exactly what the July 2025/March 2026 crackdown targets — fingerprinted, first-uploader known (MLB), and "minor edits (borders, captions, speed changes)" explicitly don't count as original. **Meta's stated safe harbor:** third-party content qualifies as original when the creator adds "substantial creative value — fresh information, analysis, or substantial improvements."** Trevor talking over/breaking down a pitch sequence with genuine expert analysis is the textbook safe case; a bare highlight with a caption is the textbook penalty case. His player credibility isn't just brand equity here — it's algorithmic protection.
- **Neptune Performance local angle:** Facebook is unmatched for local-parent reach — local Groups (youth baseball, town sports, parent groups), event pages, and the 35-55 parent demo. A facility Reel that gets 3K local-parent views beats 300K out-of-state teen views (see Carl short-form doc §1, job 4). Post facility content natively to the Neptune page, seed into relevant local Groups where rules allow, and let parent comment threads do the distribution.
- **Live:** Facebook explicitly says it "remains a home for all types of video, short, long, and Live" (June 2025). FB Live to an older fan base (Q&As, bullpen sessions, watch-alongs) still earns strong notification-driven connected reach and Stars tipping — an underused lane for an athlete with name recognition.

---

## 7. Specs and formatting checklist (as of mid-2026)

- **Aspect/size:** 9:16, 1080×1920 for Reels. Horizontal/square upload works (everything's a Reel now) but vertical wins the surface.
- **Unified Meta 9:16 safe zone (March 2026, applies to FB+IG Reels and Stories):** keep critical elements out of the **top 14%**, **bottom 20-35%** (captions/CTA UI; conservative teams treat the full 35% as dead), and **6% on each side**. One master vertical asset now works across all four placements.
- **File:** MP4/MOV, H.264, ≤4GB (under 1GB processes more reliably), 30fps.
- **Length:** no cap since June 2025. Workhorse 60-120s; 90s is the data-backed FB sweet spot.
- **Captions:** always burn or auto-generate — older FB audience over-indexes on sound-off feed viewing.
- **On-screen text + spoken keywords:** Meta's models extract text and audio for topic classification — name the niche explicitly ("cutter grip," "velocity training," "MLB bullpen") in the first seconds.
- **Post-time:** freshness boost (Oct 2025) makes same-day timing matter; large-N studies (Buffer 1M+ posts, Sprout 2.7B engagements) put Tue-Wed as top posting days. For sports: evenings and game windows.
- **Benchmarks to grade against (2025-2026):** page organic reach rate avg **1.65%** of followers (2-4% = strong, <1% = suppressed — but unconnected reach makes follower-based reach rate less meaningful for Reels); FB avg engagement rate **0.15%**; FB Reels ER **~0.13-0.18%**; a Reel is over-performing if views exceed ~3-5x page follower count.

---

## 8. Monetization state (as of 2026)

- **Facebook Content Monetization** (unified program, GA after Reels Play bonus died Aug 31, 2025): one enrollment pays on Reels, long video (in-stream), photos, and text posts. Performance-bonus monthly caps removed — uncapped earnings.
- Facebook paid creators **~$3B in 2025** (+35% YoY, all-time high); ~60% of payouts went to Reels.
- **Creator Fast Track (March 2026):** for established creators new to (or returning to) Facebook — **$1,000/mo with 100K+ followers on IG/TikTok/YT, $3,000/mo with 1M+ on any one**, guaranteed 3 months, PLUS boosted reach on eligible Reels, plus immediate Content Monetization access. Apply via Meta's creator portal. **Action item: audit Trevor's IG/TikTok/YT counts against the 100K threshold and apply if eligible — this is free money plus a reach subsidy for exactly his situation (established creator, dormant FB).**
- Originality gates monetization: accounts posting primarily unoriginal material get demonetized. Also: **Rights Manager** — as the original creator, register content so re-uploaders' fingerprint matches route value/credit back to Trevor rather than penalizing him.
- Stars (live tips) and subscriptions stack on top. Affiliate catalog (Amazon; Shopify integration expected) lets creators attach commission links to Reels — relevant for training-gear content on the Trevor May Baseball side.

---

## 9. Playbook: standing up Facebook for Mayday (step-by-step)

1. **Week 0 — plumbing:** switch pages to professional mode; enroll in Content Monetization; apply to Creator Fast Track; register key content in Rights Manager; turn on IG→FB crossposting as the floor.
2. **Weeks 1-4 — native seeding:** 3-5 native FB Reels/week, 60-120s mid-form cuts (podcast segments, pitching breakdowns, story clips). FB-specific captions: plain language, one context sentence, one comment-provoking question. Post same-day-fresh in US evening windows.
3. **Signal design per post:** open with the niche named out loud + on-screen (topic classification), build to a save-worthy payload (a drill, a grip, a checklist — saves are elevated), and a share trigger ("send this to a pitcher who…").
4. **Weeks 4-8 — read the dashboard:** grade on watch time delivered and unconnected-reach %, not follower-relative reach. Kill formats under ~15s avg watch time; double down where 3s hook-hold >70% and saves appear.
5. **Neptune track (parallel):** separate page, locally-framed content (parents/results/facility), join and contribute to local baseball Groups, run FB Events for camps/assessments. Judge by inquiries per 1,000 local views.
6. **Monthly:** confirm no originality/engagement-bait flags in Professional Dashboard's policy section; unresolved flags cap the whole account.

---

## 10. Common mistakes (2025-2026 edition)

- **Treating FB as a dumping ground for TikTok exports** — watermarked re-uploads are detected, deprioritized, and count toward unoriginality strikes.
- **Shipping only sub-30s cutdowns** — leaves the >1min watch-time advantage (50%+ of FB watch time) on the table; FB is the mid-form platform.
- **Posting bare league highlights** — fingerprinted as unoriginal; only substantial added analysis/commentary is safe (Meta's stated standard, March 2026).
- **Engagement bait** ("LIKE if…", "tag 3 friends", vote-baiting) — page-level demotion that outlives the individual post.
- **Judging FB Reels by follower-relative reach or by IG-level ER** — 0.13-0.18% ER is normal on FB; the win condition is unconnected watch time and demographic fit, not ER parity with IG.
- **Ignoring the freshness window** — queued posts firing at 3am waste the Oct 2025 same-day boost.
- **Letting crossposting conflate analytics** — merged IG/FB counts hide whether FB is actually working; keep native uploads measurable.
- **Rage-bait/trick hooks** — UTIS (Jan 2026) now catches content people watch but rate poorly; the loophole is closed.
- **Blurring the page's interest profile** with off-niche filler — coherent topical identity is an account-level ranking input.
- **Skipping captions/safe zones** — older sound-off audience + the bottom-35% caption zone eating CTAs.

## 11. Questions Ashley should ask

- What are Trevor's current IG/TikTok/YT follower counts — does he clear the 100K Creator Fast Track threshold, and has anyone applied?
- Is anything being posted natively to Facebook today, or only crossposted from IG? What do FB-native analytics show (unconnected reach %, avg watch time)?
- Do the podcast/YT cuts have a 60-120s mid-form version, or only sub-30s TikTok exports?
- Are we using any MLB footage without a substantial commentary layer? Any originality or policy flags in the Professional Dashboard?
- Does Neptune have its own FB page yet, and who owns the local-Groups relationship-building?
- Which FB post in the last 90 days earned the most saves and shares — and what was its length, topic, and post time?
- Is content registered in Rights Manager so re-uploaders feed Trevor's attribution instead of hurting it?
- When a clip works on IG, is it re-cut natively for FB or just crossposted — and are the two measured separately?

## Sources

- Meta Newsroom — "Finding and Sharing Reels on Facebook Just Got Easier and More Fun" (Oct 7, 2025): https://about.fb.com/news/2025/10/finding-sharing-reels-facebook-just-got-easier-more-fun/
- Meta Newsroom — "Rewarding Original Creators on Facebook" (Mar 13, 2026): https://about.fb.com/news/2026/03/rewarding-original-creators-on-facebook/
- Meta Newsroom — "Creator Fast Track" (Mar 2026): https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/
- Meta AI Blog — "The AI behind unconnected content recommendations on Facebook and Instagram": https://ai.meta.com/blog/ai-unconnected-content-recommendations-facebook-instagram/
- TechCrunch — "Facebook updates its algorithm to give users more control over which videos they see" (Oct 7, 2025): https://techcrunch.com/2025/10/07/facebook-updates-its-algorithm-to-give-users-more-control-over-which-videos-they-see/
- ContentGrip — "Meta merges Facebook videos and Reels" (Jun 27, 2025): https://www.contentgrip.com/facebook-videos-now-reels-meta/
- Social Media Examiner — "Facebook's 2026 Rules for Reach & Relevance" (Tara Zirker): https://www.socialmediaexaminer.com/facebooks-2026-rules-for-reach-relevance/
- Socialinsider — "Facebook Reels vs. Instagram Reels: Performance Differences": https://www.socialinsider.io/blog/facebook-reels-vs-instagram-reels/
- Socialinsider — "2026 Organic Facebook Engagement Benchmarks": https://www.socialinsider.io/social-media-benchmarks/facebook
- Meta Business Help / Transparency Center — Engagement Bait guidelines: https://transparency.meta.com/features/approach-to-ranking/content-distribution-guidelines/engagement-bait/
- PPC Land — "Facebook introduces stronger measures against unoriginal content creators" (Jul 2025): https://ppc.land/facebook-introduces-stronger-measures-against-unoriginal-content-creators/
- Pew Research Center — Social Media Fact Sheet (fielded Feb-Jun 2025): https://www.pewresearch.org/internet/fact-sheet/social-media/
- Hootsuite — "30 Facebook demographics marketers need to know in 2026": https://blog.hootsuite.com/facebook-demographics/
- Backlinko — "Facebook User & Growth Statistics 2026": https://backlinko.com/facebook-users
- Billo — "Meta Ads Safe Zones: 2026 Unified Creative Updates": https://billo.app/blog/meta-ads-safe-zones/
- Marketing Brew — "How MLB is looking to capture younger audiences" (Mar 2026): https://www.marketingbrew.com/stories/2026/03/26/major-league-baseball-social-media-marketing
