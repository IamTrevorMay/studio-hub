---
title: Reels Algorithm & Unconnected Reach (2025-2026)
domain: instagram
tags: [reels-algorithm, unconnected-reach, trial-reels, sends-per-reach, watch-time, views-metric, original-content, ranking-signals]
sources_reviewed: 14
last_updated: 2026-07-12
---

# Reels Algorithm & Unconnected Reach (2025-2026)

Tactical execution reference. Strategy-level framing (two-games mental model, format roles, posting-frequency dose-response, DM funnels) lives in ../../Carl/organic-marketing/03-instagram-organic.md — this doc goes one level deeper: exact mechanics, thresholds, benchmarks, and step-by-step plays.

## TL;DR

- **Ranking order for Reels as of 2026: watch time → sends → likes.** The Dec 2025 update *increased* the weight of sends relative to likes, and Instagram now distinguishes send types — a DM send to a close friend is worth more than a story reshare, external share, or link copy. Engineer every growth Reel around "who forwards this, and to whom?"
- **Sends-per-reach (SPR) benchmarks:** <1% is average, 2–5% is high-performing, 5%+ is viral-tier. Compute manually: Insights → Sends ÷ Reach. Track it per Reel; it is the best single predictor of unconnected distribution.
- **Retention gates by length (2026 benchmarks):** <15s Reels need 65–70%+ view-through; 15–30s need 55%+; 30–60s need 40–50%. The 0–3 second hold is the hard gate — lose them there and nothing else matters.
- **Trial Reels are the standard testing loop now:** non-followers only, invisible to followers/grid, metrics at ~24h, optional auto-share to everyone if views pop within 72h, up to 20/day, schedulable since Feb 2026. Instagram credits the feature with an 80% lift in non-follower Reels reach among users. Use them for every unproven hook/format; do NOT use them for product/announcement content (it dies with strangers).
- **Views replaced impressions and plays as THE metric (API cutover April 21, 2025).** A view = every play start incl. replays (video) or every screen appearance (photos/carousels). Mosseri's stated KPI trio: views, reach, sends. Re-baseline any pre-April-2025 comparisons — numbers inflated overnight by definition change.
- **Originality is now enforced, not suggested:** accounts that primarily repost un-transformed content are removed from recommendations entirely (Reels since 2024–2025; extended to photos/carousels April 30, 2026). Practitioner-reported threshold: ~10 reposts in 30 days kills recommendability. Speed changes and credit screenshots do NOT count as transformation; added voiceover/commentary/edit does.
- **Account-level topic consistency matters more since Dec 2025:** the system categorizes you off roughly your last 9–12 posts and throttles content that doesn't match your established topic profile. Trevor's baseball content and any entertainment-crossover content compete inside one topic profile per account — watch for dilution.

---

## 1. The ranking machine, precisely (as of 2026)

Instagram runs **separate ranking systems per surface**. For unconnected reach the surfaces that matter are the Reels tab, Explore, and recommended posts in Feed. Each Reel is scored per surface.

### Signal hierarchy for Reels (unconnected)

| Rank | Signal | What Instagram measures | Tactical lever |
|---|---|---|---|
| 1 | **Watch time** | Total seconds, % completed, completion rate, immediate rewatches, loop behavior | Hook in 0–3s; length-to-payoff ratio; loopable endings |
| 2 | **Sends** | DM sends (close-friend sends weighted highest), story reshares, external shares, link copies — in that order of value (as of Dec 2025) | Design "forwardable" content + contextual send-asks |
| 3 | **Likes per reach** | Ratio, not raw count. 50 likes on 1,000 reach beats 100 likes on 10,000 | Matters more for connected reach; don't optimize growth Reels for it |
| 4 | Early velocity | Engagement rate in the first hours; follows generated per view | Post when your senders are online; pin a comment that invites replies |
| 5 | Profile actions | Profile taps and follows directly off the Reel | End-card / caption that gives a reason to check the profile |

Third-party analyses claim sends are weighted "3–5× a like" for unconnected distribution — Instagram has never published a multiplier, treat that as directional, not gospel (practitioner-reported, as of 2026).

### Distribution sequence (how a Reel actually spreads)

1. **Seed batch**: shown to a small unconnected sample (plus a slice of engaged followers for non-trial posts) matched on topic/audio/interest signals.
2. **Gate 1 — 3-second hold**: if the sample scrolls before ~3s, distribution stops here. This is why average Reels die at a few hundred views.
3. **Gate 2 — retention vs. length benchmark**: view-through compared against similar-length Reels (see §4 table).
4. **Gate 3 — endorsement**: SPR + saves + follows-per-view decide whether it enters larger recommendation pools (Reels tab, Explore).
5. **Compounding window**: strong Reels get re-seeded in waves over days/weeks. Mosseri-attributed guidance: post your next piece within 1–2 days of a viral hit to ride the account-level momentum.

### Negative signals that halt distribution

- Skips within 3s, "Not interested" taps, hides (these are tracked per-user and per-content-cluster).
- Engagement bait: numeric solicitations ("tag 10 friends", "share with 5 people to unlock") are explicitly suppressed. Contextual asks ("send this to your catcher") are fine.
- Third-party watermarks (TikTok logo demonstrably downranks — as of 2026, unchanged for years).
- Recommendation-guideline trips (see §6).

### The "Your Algorithm" feature (Dec 10, 2025)

Users can now see the topic list Instagram has inferred for them and add/remove/re-weight interests for the Reels feed (English rollout completed Jan 2026). Consequences for creators:

- Your content must be **legibly about a topic** the viewer might have selected. Ambiguous, uncategorizable Reels get less distribution than before.
- Reinforces topic-clarity at the account level (§5): if Instagram can't put a Reel in a bucket, it can't match it to opted-in audiences.
- Practical move: say the niche keyword out loud and put it on-screen and in the caption in the first lines ("pitching grip", "velocity training", "MLB story") so classification is unambiguous.

---

## 2. Connected vs. unconnected reach — diagnostics, not theory

(Strategy framing: see ../../Carl/organic-marketing/03-instagram-organic.md §1.) Tactically:

### Reading the split per Reel

Insights → per-post → **Views: followers vs. non-followers %**. Interpretation grid:

| Non-follower % of views | Meaning | Action |
|---|---|---|
| <20% | Reel never left your circle — failed a retention or endorsement gate | Autopsy the first 3s; check SPR; check recommendability |
| 30–55% | Normal healthy distribution (platform avg ≈ 55% of all Reels plays are non-follower, as of 2026) | Iterate on the format |
| 40%+ (Retensis 2026 threshold) | Above-average algorithmic performance | Clone the hook/format immediately |
| 80%+ | Recommendation surfaces picked it up hard | Post follow-up within 24–48h; pin a profile-funnel comment |

### Key diagnostic rules

- **A reach drop is surface-specific until proven otherwise.** Pull follower vs. non-follower views before diagnosing. Follower views flat + non-follower views cratered = recommendability or topic-profile problem. Both down = frequency/content problem.
- **Connected reach runs on relationship signals** (DMs, story replies, profile visits) that a Reel cannot fix. Don't prescribe "better hooks" for a Stories-reach complaint.
- **Follower count is not a ranking input for unconnected reach** — both reach types run on the same engagement signals (confirmed repeatedly by Mosseri, 2024–2025). Small accounts can and do outrun big ones per-post; this is why Trial Reels exist.

---

## 3. Views as the primary metric (the April 2025 reset)

- **What happened**: Meta deprecated *impressions* (photos/carousels/stories) and *plays* (video) and unified everything under **Views**. Instagram Insights UI changed in late 2024; the **API cutover was April 21, 2025** — Metricool/Buffer/etc. columns changed meaning on that date.
- **Counting rules**: video = a view every time playback *starts*, including replays and regardless of duration watched. Photos/carousels/stories = a view every time the content appears on screen, including repeat appearances in the same session.
- **Consequences**:
  - Views are inflated vs. old plays (replays now count). Any YoY chart crossing April 2025 needs a footnote; do not let a client read the discontinuity as organic growth.
  - **Views ÷ Reach > 1 is now a real signal**: it approximates rewatch rate. 1.3–1.5+ views/reach on a short Reel usually means it's looping — a strong distribution predictor.
  - Mosseri's stated creator KPI set (2025): **views, reach, sends**. Watch time still ranks content but views are the currency you report in.
- **In Mayday's stack**: Metricool pulls post-cutover semantics; if comparing against internal `platform_daily_metrics` history, confirm which era each column comes from.

---

## 4. Watch time & retention — gates and benchmarks

### View-through-rate benchmarks by length (2026, Retensis/That Random Agency aggregates)

| Reel length | Average VTR | Strong VTR | Notes |
|---|---|---|---|
| <15s | 55–65% | 70%+ | Highest completion + loop potential; best for pure-reach plays |
| 15–30s | 45–55% | 55%+ | Sweet spot for most creator content; avg watch time clusters at 8–16s on ~30s Reels |
| 30–60s | 35–45% | 40–50% | Educational sweet spot; needs mid-roll re-hooks every ~10s |
| 60–90s | lower | watch-time-total can still win | Total seconds watched can beat a short Reel's % — story content lives here |
| >90s | — | — | Reduced distribution unless retention is exceptional (Dec 2025 guidance); 3-min max is recommendable as of 2025 |

### Length prescriptions by job (as of 2026)

- **7–15s**: highest completion + viral ceiling — trends, one-joke Reels, single-clip highlights.
- **20–35s**: educational/how-to optimum (one concept, one payoff).
- **30–60s**: story/analysis with re-hooks ("but here's the part nobody talks about" at ~40% mark).
- Under 90s remains the general ceiling for growth content.

### Hook engineering (the 0–3s gate)

1. **Frame 1 must contain motion or a face + on-screen text stating the payoff.** No logo cards, no slow zooms, no "wait for it."
2. **Front-load the claim, not the setup**: "This grip added 3 mph" beats "So a lot of people ask me about grips."
3. **Text hook ≠ spoken hook**: run both, slightly offset — text carries muted viewers (majority of feed viewing is muted).
4. **Cold-open mid-action** for highlight content: start at the release point / contact, then rewind for context.
5. **Loop construction**: end on a frame that visually matches the opening frame, or cut the final sentence so it flows into the first — replays count as views and rewatch is an explicit ranking input.

### Measuring it

Per-Reel Insights show a retention graph for videos (watch-through curve). Autopsy rule: a cliff at 0–2s = hook failure; a slow bleed = pacing; a cliff at a specific timestamp = cut that segment type from future edits.

---

## 5. Sends-per-reach: the engineering playbook

The single most-weighted endorsement signal for unconnected reach. Full mechanics:

### Measurement

1. Professional Dashboard → post Insights → Interactions → **Sends** (called "Shares" arrow icon in-app).
2. **SPR = Sends ÷ Reach.** Benchmarks (industry-reported, as of 2026): <1% average, 2–5% high-performing, 5%+ viral-tier. Example: 350 sends / 10,000 reach = 3.5%.
3. Log SPR per Reel alongside VTR. A Reel with mediocre likes but 3% SPR is a *winning format* — clone it.

### The four archetypes that get forwarded (with baseball translations)

| Archetype | Mechanic | Trevor-lane example |
|---|---|---|
| **Mini-infographic / cheatsheet** | Forwarded as a credible proof point in group chats | "The 4 pitch grips every 14U kid should learn (and the 1 to avoid)" — dense on-screen card |
| **Relatable insider humor** | Emotion compressed into one visual; sent with "this is so you" | Bullpen culture bits, travel-ball parent humor, "every catcher when..." — sent dad-to-dad, teammate-to-teammate |
| **Micro-tutorial / before-after** | Sent to the friend with the identical problem | 15s mechanical fix with a visible velocity/movement delta |
| **Utility carousel/Reel with labeled scenarios** | Multiple named use-cases = multiple recipients | "What to throw 0-2 / 2-0 / 3-1" situational chart |

### Hook–Body–Send-Ask pattern (per-post checklist)

- **Hook**: relatable problem or surprising stat in the first line + first frame.
- **Body**: functions as a mini-reference — specific enough that forwarding it does the recipient a favor.
- **Send-ask**: name the *recipient and situation*, never a number. ✅ "Send this to your pitching coach before the season." ❌ "Share with 5 friends" (engagement bait → suppression).
- **Caption**: niche keywords in the first 125 characters (search + classification), close with the contextual send cue.

### Format hierarchy for SPR (highest to lowest, as of 2026)

1. Screenshot/meme-style content (zero-friction forwarding)
2. Reels on trending audio (co-watch behavior)
3. Carousels with labeled scenarios
4. Infographic statics
5. Long-caption posts

### Success signals to watch beyond the number

Comments saying "sending this to X", screenshots of the post circulating, follow-up DMs referencing it. These confirm the send motive is working, not just the metric.

---

## 6. Trial Reels — complete mechanics + operating playbook

### Mechanics (official, Instagram/Meta, Dec 2024 launch — verified against creators.instagram.com)

- **Eligibility**: public professional/creator accounts; 1,000+ followers required (and required for scheduling). Rolled out to all eligible creators through 2025.
- **Distribution**: shown to **non-followers only**, through the same unconnected recommendation engine as the Reels tab/Explore.
- **Follower invisibility**: does not appear in followers' Feed or Reels tab, your profile Reels tab, or grid — *unless* shared to everyone later. Leak exceptions: a non-follower can DM it to your follower; it can surface on audio/location/effect pages.
- **Metrics**: available ~24h after posting — views, likes, comments, shares, plus comparison against your previous trials.
- **Graduation paths**: (a) manual "Share to everyone" at any time; (b) opt-in **auto-share** if Instagram judges it's performing well on views within the **first 72 hours** (toggleable per-Reel).
- **Caps & tooling**: up to **20 trial reels/day**; schedulable in advance since **Feb 2026** (batch a week of tests in one sitting).
- **Platform-reported outcomes** (Instagram, mid-2025): 40% of creators using trials posted more often; trials associated with an **80% increase in non-follower Reels reach**.

### What trials are FOR (and not for)

- ✅ Testing unproven hooks, formats, trend takes, new content pillars, riskier humor — without burning follower trust or cluttering the grid.
- ✅ Re-testing proven content: repost past winners as trials to squeeze fresh unconnected reach (documented tactic behind @chelsea_explains' reported 0→450K run; also Kapwing's 1.4M-view trial).
- ✅ A/B mechanics: same clip, two audios — one documented test found trending audio beat voiceover by 24% views on identical content.
- ❌ Product/announcement/CTA content: Kapwing's controlled test showed a product-focused trial got **802 views, 0 likes** while the identical regular Reel got 836 views with 11 likes and 6 comments — follower-context content dies with strangers.
- ❌ Engagement/conversion goals generally: trials reliably buy views, not engagement (trend trial: 2.3× views of the regular post but 0.7% ER vs 1.6%).

### Trevor/Mayday trial-reel workflow (weekly)

1. Batch-schedule 3–5 trials for the week (one variable per test: hook line, audio, length, or pillar).
2. At 24h, log views + SPR + likes-per-reach into the content tracker; compare against previous trials (Instagram shows this natively).
3. Graduate the top performer: share to everyone (or pre-set auto-share for trend content where speed matters).
4. Kill criteria: below your rolling trial median at 24h = archive the format variable, not just the post.
5. Monthly: re-trial your two best-ever Reels with a refreshed hook — proven content + new unconnected sample.

Caveat (as of 2026): views from trials skew toward broad audiences; a trial "winner" on views should still pass an SPR/follows-per-view check before you call the format a keeper.

---

## 7. Account-level signals

### Topic profile (tightened Dec 2025)

- Instagram categorizes your account off roughly the **last 9–12 posts**; content outside the established profile gets significantly less distribution, and inconsistent accounts are penalized more than before.
- For a multi-lane creator (baseball + entertainment crossover): keep one account's recent-post window ≥70% on-lane. Crossover experiments → Trial Reels first (trials still inform the profile less visibly than grid posts, and failures don't sit in the window).
- Say/write the niche keyword in the first seconds and caption so classification is deterministic (§1, "Your Algorithm").

### Recommendability (the real "shadowban")

- Check **Settings → Account Status → "Content you can't recommend"** before diagnosing anything mystical. (Strategy framing: see ../../Carl/organic-marketing/03-instagram-organic.md §1.)
- Trips: engagement bait, watermarks, unoriginal reposts (§8), misleading claims, borderline content, spam patterns. Recommendation strikes throttle *unconnected* reach only — followers still see everything, which is exactly the signature described in §2 diagnostics.

### Momentum & cadence

- Post-viral window: publish again within **1–2 days** of an outlier — the account gets a temporary distribution benefit.
- Reels cadence: 3–5 Reels/week is the consensus optimum for 2026 (dose-response detail: see ../../Carl/organic-marketing/03-instagram-organic.md). Spacing matters: hours apart minimum; same-hour clustering splits the seed audience.
- Account type (business/creator/personal) is ranking-neutral — as of 2026, unchanged.

### Authenticity signal (2026 direction)

Mosseri's Dec 31, 2025 year-end memo: Instagram will prioritize "raw, real human content" over AI-generated material through 2026. Pure-AI Reels underperform; AI-assisted (script, captions, edit) is fine. For an athlete-creator whose entire moat is being a real former MLB player, this is a tailwind — face-on-camera, unpolished-but-sharp content is being actively favored.

---

## 8. Original content vs. reposts — enforcement rules

Policy timeline: algorithmic downranking of reuploads (2022) → originality boost for Reels (2024) → aggregator de-recommendation for Reels (2025) → **extended to photos and carousels April 30, 2026**.

### The rules (as of mid-2026)

- Accounts that **primarily** share content they didn't create or "meaningfully transform" are **removed from recommendations entirely** — no Explore, no Reels tab for non-followers, no suggested posts. Followers still see the content.
- Practitioner-reported threshold: **~10 un-transformed reposts in a 30-day window** triggers exclusion (not officially published; treat as directional).
- Detection is visual fingerprinting; third-party reporting cites ~70% visual similarity as the flag line (unofficial).
- **Does NOT count as transformation**: speed changes, cropping, a screenshot crediting the original creator.
- **DOES count**: added voiceover, on-screen commentary/text that adds a take, creative edits, humor/social commentary — "making it unmistakably yours" (Mosseri's framing).
- Aftermath data (third-party, 2026): aggregators reported 60–80% reach drops; original creators 40–60% reach gains.

### Trevor-lane implications (tactical)

- **MLB game footage**: raw highlight reposts are both a copyright exposure AND now an algorithmic dead end. The compliant + algorithmically-favored version is the same move: Trevor on camera or in voiceover *reacting/analyzing over* the clip — that's "meaningful transformation" and plays to the athlete-credibility moat.
- **Cross-posting from TikTok/YouTube Shorts**: strip watermarks always; ideally re-export clean masters. Watermarked uploads are downranked independently of the repost policy.
- **Podcast clips**: clipping your own long-form is original content, not a repost — no penalty. Made-for-IG re-edits (9:16 reframe, native captions, IG-paced hook) outperform straight lifts.
- Use IG's native **repost/collab tools** when sharing others' content — attributed reposts via built-in tools are the sanctioned path and don't accrue toward the aggregator pattern the way feed re-uploads do.

---

## 9. 2025–2026 change log (date-stamped)

| Date | Change |
|---|---|
| Dec 2024 | Trial Reels launched (Mosseri: "depressurize" posting) |
| Jan 2025 | Mosseri confirms the three ranking metrics: watch time, likes/reach, sends/reach |
| Apr 21, 2025 | API cutover: Views replaces impressions + plays as unified metric |
| Mid-2025 | Trial Reels open to all public creators 1,000+ followers; IG reports 80% non-follower reach lift, 40% posting-frequency lift |
| 2025 | Reels up to 3 minutes eligible for non-follower recommendations |
| Jul 2025 | Public professional-account content indexed by Google (see Carl doc for SEO strategy) |
| Dec 10, 2025 | "Your Algorithm" for Reels — user-editable topic preferences; sends weight increased vs. likes; send-type differentiation (close-friend DM > story reshare > external share > link copy); topic-profile consistency tightened (last 9–12 posts) |
| Dec 31, 2025 | Mosseri year-end memo: prioritize "raw, real human content" over AI-generated through 2026 |
| Feb 2026 | Trial Reels scheduling added |
| Apr 30, 2026 | Originality/aggregator de-recommendation extended from Reels to photos + carousels |

---

## 10. Common mistakes

1. **Optimizing growth Reels for likes.** Likes/reach mostly moves *connected* distribution. The unconnected levers are watch time and sends. A "well-liked" Reel with 0.4% SPR will not travel.
2. **Reading the April 2025 views inflation as growth** (or the reverse as decline) in any chart that crosses the cutover.
3. **Numeric share bait** ("tag 3 teammates") — actively suppressed. Contextual send-asks are the compliant version of the same play.
4. **Trialing announcement/product content** and concluding "trials don't work." Trials only sample strangers; context-dependent content structurally fails there.
5. **Diagnosing a reach drop in aggregate.** Always split follower vs. non-follower views first; the two failure modes have opposite fixes.
6. **Posting crossover/off-topic content straight to grid** on a topic-tight account — it dilutes the 9–12-post profile. Trial it instead.
7. **Slow intros**: logo cards, "hey guys," context-before-claim. The 3s gate kills these before any other quality matters.
8. **Raw highlight reposts** (MLB or otherwise) without added voice/take — de-recommendation risk since Apr 2026, plus copyright exposure.
9. **Ignoring rewatch design.** Views/reach >1 is now measurable and rewarded; non-looping endings leave free distribution on the table.
10. **Panic-diagnosing platform-wide engagement decline as a shadowban** without checking Account Status (30-second check that resolves most "algorithm broke" complaints).
11. **Deleting or reposting an underperformer within hours.** Distribution comes in waves over days; the Nire Donahue trial case went from modest day-1 to 10.8M views after graduation to public.
12. **Cross-posting watermarked TikToks** — an independent, well-documented downrank.

---

## 11. Questions Ashley should ask

Before diagnosing or prescribing anything on IG reach:

1. "What's the follower vs. non-follower view split on the last 10 Reels?" (separates content problems from recommendability problems)
2. "What does Account Status show right now — anything under 'content you can't recommend'?"
3. "What's the SPR on your top 3 and bottom 3 recent Reels?" (finds the forwardable formats already working)
4. "Where does the retention curve die — 0–2s, mid-roll bleed, or a specific timestamp?"
5. "Of the last 12 grid posts, how many are on-lane baseball vs. crossover?" (topic-profile audit)
6. "Are any recent posts re-uploads or lightly-edited clips from other platforms — and did any carry watermarks?"
7. "Are we running Trial Reels weekly, and what's the graduation rate?" (if no trials: that's the first fix)
8. "Is this comparison crossing April 2025?" (views-metric discontinuity check before trusting any trend line)
9. "When was the last outlier, and did we post within 48 hours of it?"
10. "What would make someone send this to one specific person — who is that person, and what's the situation?" (the design question for every growth Reel)

---

## Sources

- Instagram for Creators — Trial Reels official announcement/mechanics: https://creators.instagram.com/blog/instagram-trial-reels
- Meta Newsroom — Test Content With Non-Followers Using Trial Reels (Dec 2024): https://about.fb.com/news/2024/12/trial-reels-try-content-non-followers-first-see-what-perfoms-best/
- Buffer — How the Instagram Algorithm Works (2026 guide): https://buffer.com/resources/instagram-algorithms/
- Hootsuite — Instagram algorithm tips for 2026: https://blog.hootsuite.com/instagram-algorithm/
- Influencer Marketing Hub — Instagram "Sends per Reach" Playbook: https://influencermarketinghub.com/instagram-sends-per-reach-playbook/
- Tubefilter — Instagram's penalty for unoriginal content aggregators (Apr 30, 2026): https://www.tubefilter.com/2026/04/30/instagram-removes-algorithm-recommendations-repost-content-aggregator/
- PetaPixel — New Instagram Policies Target Reposted Content (Apr 2026): https://petapixel.com/2026/04/30/new-instagram-policies-target-reposted-content/
- Kapwing — Trial Reels study (controlled trial-vs-regular test + 1.4M-view case): https://www.kapwing.com/resources/instagram-trial-reels-study-what-we-learned-after-a-trial-reel-hit-1-million-views/
- ALM Corp — December 2025 Instagram Algorithm update ("Your Algorithm," send weighting, topic profile): https://almcorp.com/blog/instagram-algorithm-update-december-2025/
- Retensis — Instagram Reels Statistics 2026 (retention/ER/reach benchmarks): https://retensis.com/blog/instagram-reels-statistics-2026
- Social Media Today — Instagram Updates Metrics to Focus Creators on Views: https://www.socialmediatoday.com/news/instagram-updates-metrics-to-focus-creators-on-views/723645/
- Kolsquare — Views are the new impressions (Meta metrics shift, API cutover): https://www.kolsquare.com/en/blog/views-are-the-new-impressions-what-metas-metrics-shift-means-for-influencer-marketing
- Metricool — Instagram Trial Reels guide (eligibility, mechanics): https://metricool.com/instagram-trial-reels/
- Nire Donahue — Trial Reels case study (9 trials → 2.3M impressions; 10.8M-view graduation): https://niredonahue.com/instagram-trial-reels-case-study/
