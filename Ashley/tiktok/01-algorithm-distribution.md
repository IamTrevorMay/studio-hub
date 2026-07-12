---
title: "TikTok Algorithm & Distribution Mechanics (2025-2026)"
domain: tiktok
tags:
  - tiktok-algorithm
  - fyp-distribution
  - batch-testing
  - completion-rate
  - tiktok-seo
  - shadowban
  - account-authority
  - rewatch-loops
sources_reviewed: 14
last_updated: 2026-07-12
---

# TikTok Algorithm & Distribution Mechanics (2025-2026)

Tactical execution reference. Strategy-level platform comparison, clip-selection editorial craft, and cross-platform cadence live in the Carl doc — this file goes deeper on TikTok's actual machinery. (strategy level: see ../../Carl/organic-marketing/02-short-form-strategy.md)

## TL;DR

- **The viral bar rose.** Practitioner consensus (as of 2026): the completion rate needed to escape the initial test batch climbed from ~50% (2024) to ~70%. A 60s video now needs ~42s average watch time to expand. Front-loaded videos that trail off die at the batch stage; value must be continuous through the runtime.
- **Followers now gate the first test.** The late-2025 "follower-first" shift means the initial test pool is weighted toward your existing followers. If your followers don't complete/share/save, the video may never reach non-followers. Implication: a stale or mismatched follower base actively hurts new-video reach — audience quality is now a distribution asset.
- **Rewatches are the strongest single positive signal.** Target 20-30% rewatch rate on short clips. Engineer loops: end-frame connects to open-frame, second-pass rewards (hidden detail, reveal that lands differently on replay). Loop videos run 15-30% higher completion and 2-4x rewatch vs. non-looping peers.
- **Views per post are down ~31% platform-wide YoY** (Metricool, 2.3M posts, Jan-Feb 2025 vs Jan-Feb 2026) while video supply rose 72%. Falling average views on @IamTrevorMay is partly platform-wide saturation, not necessarily a content problem — benchmark against the decline, not against 2024 numbers.
- **Search is the second distribution surface and it's underworked.** 49% of US consumers use TikTok search; hashtag-driven traffic +114% YoY. Keywords in caption first-50-chars, spoken audio, and on-screen text are all indexed. Creator Search Insights (in-app) shows content-gap keywords — free demand data almost nobody in baseball uses.
- **Shadowbans are real but mislabeled.** TikTok's term is "ineligible for the For You feed." Signature: FYP traffic source drops to near zero in analytics while profile/following views persist; views down 70-90% within hours. Typical recovery 7-14 days after removing the offending content and posting clean.
- **Follower count is officially NOT a ranking input** (TikTok's own docs) — but account-level signals (niche consistency, posting consistency, past guideline strikes) shape which test batches you get and how confident the system is in categorizing you. Niche-consistent accounts see materially higher reach than topic-hoppers.
- **US algorithm is being retrained (2026).** The Oracle/Silver Lake/MGX joint venture (closed Jan 2026) is retraining the US recommendation model on US-only data through mid-2026. Expect distribution turbulence; fundamentals (watch time, completion, shares) unchanged. Don't over-diagnose weird weeks during this window.

---

## 1. The distribution pipeline — how a video actually travels

### The phase model (as of 2026)

Every upload runs the same gauntlet regardless of account size. TikTok officially confirms staged testing; the specifics below are practitioner-reconstructed and labeled by confidence.

**Phase 0 — Ingestion & classification (minutes).**
- TikTok's systems read: caption text, hashtags, the sound, on-screen text (OCR), and the auto-transcript of spoken audio. AI vision also classifies visual content.
- This determines *who gets the test batch*. Bad metadata = wrong test audience = false-negative failure. A great baseball video captioned "😂😂 lol" gets tested on the wrong people and dies.
- Videos stuck on "Processing" or "Under Review" for extended periods have been flagged for moderation review — a leading indicator of suppression.

**Phase 1 — Initial test batch (~first hours).**
- Batch size: commonly reported as **200-500 impressions**, selected by metadata match + (since late 2025) weighted toward your **existing followers** (confidence: medium — widely reported across practitioner sources, not officially confirmed).
- Measured: 3-second hold, completion rate, rewatches, shares, saves, comments, "Not Interested" taps, swipe-away speed.
- Fail state: if most of the batch swipes in the first ~3 seconds, distribution stops — the "200-view jail." **TikTok does not retry failed videos.** One shot per post.
- Strong first-60-minute engagement flags the video for expansion.

**Phase 2 — Audience expansion.**
- The system finds non-followers resembling the users who completed/engaged in Phase 1, in successively larger interest-cluster pools. Each pool must re-clear the bar — "that next boost depends on how the *new* audience reacts, not just the raw numbers" (Buffer).
- This is why videos plateau at specific tiers (2K, 20K, 200K): each plateau is a batch that didn't clear.

**Phase 3 — Viral snowball / Phase 4 — Plateau.**
- Snowballing continues until a cohort under-responds or the relevant audience exhausts. Metricool: **96% of a video's total reach arrives within the first 10 days** — TikTok content is effectively dead after ~10 days unless resurrected by search or a trend match (older clips can resurface when a trend re-aligns with their metadata).

### The 2025-2026 follower-first change (important)

- Late 2025: multiple independent practitioner sources report the Phase 1 pool shifted from mostly-cold-audience to **mostly-followers**. Follower completion/share/save behavior now decides whether non-followers ever see the video.
- Tactical consequences:
  1. **Follower quality matters again.** Giveaway-acquired, bought, or off-niche followers (e.g., followers from one random viral non-baseball moment) poison the test batch.
  2. **Post when your followers are active.** Timing mattered less under pure cold-testing; it matters more now. Metricool: 6-9pm local, peak 8pm.
  3. **Serve the base, reach the strangers.** Videos that only make sense to cold audiences ("who is this guy?" explainer energy) can now underperform vs. videos your existing followers finish. Balance both in one video: hook works cold, payoff rewards the regulars.
  4. Confidence caveat (as of 2026): this is the most significant claimed change and the least officially documented. Treat as operating assumption, verify against @IamTrevorMay's own "Followers vs FYP" traffic-source analytics.

---

## 2. Ranking signals — what's confirmed vs. estimated

### Officially confirmed by TikTok (newsroom / transparency docs)

- Ranking = prediction score of how likely *you* are to enjoy a video, computed from: **user interactions** (likes, shares, comments, accounts followed, content you create, videos finished), **video information** (captions, sounds, hashtags), **device/account settings** (language, country, device — explicitly low weight).
- Signal strength is differential: **"whether a user finishes watching a longer video from beginning to end"** is explicitly called a strong indicator, vs. weak indicators like creator/viewer being in the same country.
- **"Neither follower count nor whether the account has had previous high-performing videos are direct factors."** (Official, verbatim claim.)
- Diversity rules: the feed deliberately avoids back-to-back videos from the same creator or same sound, and intentionally injects some content outside your interest profile. This means even perfect content has a distribution ceiling per-user-session.

### Practitioner-estimated weights (as of 2026 — directional, not official)

| Signal | Est. weight | Notes |
|---|---|---|
| Watch time + completion rate | ~40-50% of the model | The dominant factor. ~70% completion = viral-push bar (2026) |
| Rewatch/replay rate | Very high | Immediate replays are the strongest single positive event; 20-30% rewatch = strong |
| Shares (esp. to DM) | Very high | Reported to outweigh likes since a 2025 update; platform shares/post +45% YoY 2025 |
| Saves/favorites | Very high | Treated as a strong relevance indicator, above likes |
| Comments | High, quality-weighted | One substantive comment reportedly > many emoji comments; reply threads count extra |
| Follows-from-video | High | Direct "this creator, more of this" vote |
| Likes | Moderate, declining | Shallow-interaction weight reduced in 2025 update |
| Metadata/transcript relevance | Medium, rising | Feeds both FYP matching and search; on-screen text ≈ spoken keywords > caption-only |
| Negative signals (swipe <3s, "Not Interested," report) | Strongly negative | Early swipes in the test batch are the #1 killer |

### Thresholds & benchmarks worth memorizing (as of 2026)

- **3-second hold**: if viewers drop in the first 3s, nothing else matters. (Carl-level target: >80% hold at 3s.)
- **Completion**: ~70% average to clear batches (up from ~50% in 2024). For 60s video ≈ 42s avg watch time.
- **Rewatch**: 20-30% on sub-30s clips = expansion-grade.
- **First hour**: expansion flagging happens here; near-zero engagement in 60 min ≈ buried.
- **Length sweet spots** (practitioner-reported): 11-18s for max viral probability; 15-30s for engagement/shares; 45-120s works when chapter-structured and loopable; 60s+ required for monetization programs. Rule stays: cut to the idea's natural length — completion % beats length.
- **Hashtags**: 3-5 targeted. ≥1 hashtag = ~5% more views, ~9% more interactions (Metricool). Stuffing 20+ is dead.
- **Questions in captions**: +26% comments (Metricool).
- **Posting frequency** (Buffer, 11M+ videos): vs. baseline, 2-5 posts/week = +17% views/post; 6-10/week = +29%; 11+/week = +34%. Views per post *rise* with volume — TikTok does not punish frequency; it rewards it. (Sustainability is the real constraint; see Carl for cadence strategy.)
- **Engagement rate norms**: median ~4.5% (Buffer 2025); sports/fitness creators skew far higher (reported up to ~18% for the niche). Comments per post fell 24% platform-wide in 2025 — declining comment counts ≠ declining account health.

---

## 3. Watch-loop and rewatch engineering

Rewatches are the cheapest big signal to engineer deliberately.

**Loop construction patterns:**
1. **Seamless loop** — final frame matches opening frame visually or narratively; autoplay restarts before the viewer decides to leave, generating an *involuntary* rewatch event that counts.
2. **Second-pass reward** — a detail only visible/meaningful on replay: background event, early line that reads differently after the ending, freeze-frame text that's too fast to read once. Comments like "had to watch twice" are the tell (and themselves fuel comment signal).
3. **Cut the resolution beat** — end on the payoff frame itself, not a second of "so yeah…" afterward. Dead air at the end kills both completion and the loop.
4. **Open-question loop** — pose a question in the first line whose answer only fully lands at the end; the join back to the start feels like confirmation.
5. **Answer-first scripting** (for explainer/analysis content — Trevor's pitching breakdowns): one-line answer up top, then the proof. Viewers replay the answer moment; this also optimizes for TikTok search/assistant quotation.

**Baseball-native loop examples:**
- Pitch breakdown where the final slow-mo release frame = the opening frame.
- "What's wrong with this delivery?" → reveal at end → viewer rewatches the opening to see it.
- Story clips from the podcast: cut so the punchline's setup context is only fully clear on second watch.

**Series mechanics:** Part 1/2/3 structures get algorithmic help — TikTok actively recommends episode 2 to people who watched episode 1. Pin a comment pointing to the next part within the first hour.

---

## 4. Follower reach vs. FYP reach, and account authority

### Where views actually come from

- **FYP = ~72.7% of all video views** platform-wide (Metricool 2026). Following feed, search, profile, and sound/hashtag pages split the rest.
- Check per-video **Traffic Source** in analytics religiously. Reading it:
  - High FYP % = the machine is distributing you. Healthy.
  - High "Personal Profile" % = people are visiting you deliberately (good brand signal) but the machine isn't pushing — or you're suppressed.
  - Rising "Search" % = evergreen/SEO value; these videos keep earning past the 10-day death window.
  - Following-heavy with no FYP = failed the batch or ineligible for FYP.

### Account authority (real, but indirect)

TikTok denies follower count and past hits are inputs, and that's credible — but account-level effects are observable through other doors:
- **Niche consistency**: when the classifier can reliably predict "this account = baseball training / MLB stories," new videos get better-matched test batches. Reported effect size: niche-consistent accounts see up to ~45% higher reach than multi-topic accounts (practitioner estimate, 2026). Topic-hopping makes the system "uncertain and conservative."
- **Posting consistency**: dormant accounts test worse on return; most accounts need 30-60 days of consistent posting before signals compound. Burst-then-gap is the damaging pattern (strategy level: see ../../Carl/organic-marketing/02-short-form-strategy.md).
- **Strike history**: guideline violations and repeated FYP-ineligible posts degrade account-level trust and future distribution.
- **Practical rule for Trevor**: @IamTrevorMay should hold to 2-3 recognizable repeatable formats (e.g., pitch breakdowns, MLB story clips, player reactions) so the classifier files it cleanly. Neptune facility content targeting local parents is a *different classifier target* — it belongs on its own account, not mixed in. Athlete-crossover lifestyle content is the gray zone: fine occasionally, but it should never become the plurality of posts.

---

## 5. Search-feed distribution (TikTok SEO)

The second life of a TikTok. As of 2026: 49% of US consumers (65% of Gen Z) use TikTok as a search tool; 84% of TikTok searches are exploratory ("how to throw a slider" not "Trevor May slider").

**What's indexed:** captions, hashtags, **spoken words** (auto-transcript), **on-screen text** (OCR), and AI-recognized visual elements. On-screen text and spoken keywords are weighted at least as heavily as caption keywords — *say the keyword out loud in the first sentence and put it on screen.*

**Search ranking inputs:** video-level engagement (saves, completion, shares) on that video for that query — no "domain authority." A small account can own a search term with one well-optimized, well-retained video.

**The workflow (weekly, 15 minutes):**
1. Open **Creator Search Insights** (in-app: search "Creator Search Insights" or via Creator tools). Filter by category → Sports.
2. Pull: frequently-searched topics, **"content gap"** keywords (demand exceeds supply — the highest-ROI targets), and "searched by your followers."
3. For each target keyword: say it in the first 2 seconds, overlay it as on-screen text, front-load it in the **first 50 characters of the caption**, add 2-3 exact-match niche hashtags. Write the caption as a natural sentence answering the query (keyword-stuffing is penalized). Captions can run to 4,000 chars — use the space for context/keywords below the fold.
4. Check the **Search Value / search analytics** metric per video (added to Creator Analytics in 2026) to see which posts earn search traffic, then make more like those.

**Baseball search targets that fit Trevor's authority:** "how to throw a [pitch]," "pitching mechanics fix," "why do pitchers [x]," "MLB [player/moment] explained," "youth pitcher velocity," and — for Neptune — "[city] baseball training," "pitching lessons near me"-style local intent. Content-gap coverage here compounds: search views accrue for months, unlike FYP's 10-day window.

---

## 6. Shadowbans and suppression — the actual mechanics

TikTok never uses the word. The official mechanism is **"ineligible for the For You feed"** — content that violates guidelines *or lacks distinctiveness* gets its distribution signals zeroed without any notice to the creator.

**Diagnostic checklist (run in order):**
1. Open analytics → recent videos → **Traffic Source**. FYP share collapsed to ~0% while profile/following views persist = the signature.
2. Views down 70-90% within hours across *multiple* consecutive posts (one flop is a flop; three simultaneous flops with dead FYP is suppression).
3. From a second account (logged out or a friend's): search your username and your recent hashtags — do your posts appear?
4. New uploads stuck on "Processing"/"Under Review" abnormally long.
5. Rule out the boring explanation first: platform-wide views are down ~31% YoY and comments down 24% — a slow bleed over weeks is saturation, not a ban. Suppression is a cliff, not a slope.

**Common causes, ranked by frequency in creator reports:** borderline/repurposed unoriginal content (incl. visible watermarks and mass-reposted clips), banned or spammy hashtags, copyright audio flags, bought engagement or bot-pattern behavior (mass-follow/unfollow, engagement pods), spam-frequency posting of near-duplicates, guideline hits (even AI moderation false positives), suspicious mass-deletion of videos.

**Recovery protocol (typical duration 3-14 days; severe cases weeks+):**
1. Delete or privatize the specific flagged/violating posts (check inbox for policy notices; appeal false positives — appeals do succeed).
2. Do NOT: mass-delete the back catalog, re-upload the same video repeatedly, hop to a new account (device/network fingerprints follow), or buy engagement to "restart."
3. Keep posting clean, clearly original content at normal cadence — the system needs fresh positive evidence.
4. Business accounts can contact TikTok support; personal accounts largely wait it out.
5. For sports content specifically: **MLB game footage is a copyright landmine.** Highlight-clip suppression is a much likelier cause of dead reach for a baseball account than any guideline issue. Commentary-over-footage with transformative framing, or original camera angles (Neptune facility footage, Trevor on camera), is structurally safer.

---

## 7. What changed in 2025-2026 (date-stamped)

- **Jan 2026 — US ownership transition closed.** TikTok USDS Joint Venture LLC: Oracle/Silver Lake/MGX consortium ~80%, ByteDance 19.9%. Same app for users; algorithm copy secured in Oracle's US cloud and **being retrained on US-only user data through mid-2026**. Observable effects so far: distribution fluctuation, no evidence of engineered bias (per analysts, Feb 2026), US DAU back to ~95% of pre-transition. *Advisory posture: attribute unexplained 1-2 week reach anomalies in 2026 partly to retraining noise before overhauling content.*
- **Late 2025 — follower-first testing** (Section 1). Biggest claimed structural change; verify per-account.
- **2025 update — engagement reweighting**: shares/saves elevated above likes; comment quality over quantity; production quality (lighting/audio) reportedly added as a minor factor.
- **2026 — completion bar ~70%** (from ~50% in 2024).
- **2026 — AI-content down-ranking**: obviously AI-generated video actively deprioritized in favor of on-camera humans. Advantage: Trevor's face/voice-driven content is exactly what's being favored.
- **2026 — saturation math**: +72% videos published, -31% views per video, -29% reach (Metricool, 2.3M posts). Also +140% image/carousel supply — but video still gets 5x the views and 6x the interactions of images; carousels are a complement, not a pivot.
- **2026 — search surface maturing**: Creator Search Insights adoption, "Search Value" metric in analytics, hashtag-driven traffic +114% YoY.
- **Ongoing — content diversity injection & STEM feed default-on**: per-session ceilings on any one creator/sound; some reach is deliberately given to out-of-profile content.

---

## 8. Playbooks

### Pre-publish checklist (per video)
- [ ] Hook lands inside 2 seconds (question / transformation / visual jolt / stated benefit) — no logos, no "wait for it," no mid-setup starts
- [ ] Target keyword: spoken in first line + on-screen text + first 50 chars of caption
- [ ] 3-5 exact-niche hashtags (no #fyp, no #viral)
- [ ] Caption includes a genuine question (+26% comments)
- [ ] Loop or second-pass reward engineered; ends on the payoff frame
- [ ] Length = natural length of the idea; nothing after the payoff
- [ ] Captions/subtitles on (≈30% watch muted)
- [ ] No watermarks from other platforms; TikTok-native master file
- [ ] Posting into 6-9pm local window (or your account's follower-active window per analytics)

### First-hour protocol (after posting)
1. Pin a comment within 10 minutes: seed a debate question or point to Part 2 / link.
2. Reply substantively to every early comment — reply threads are quality-weighted engagement.
3. Do not edit the caption or delete/repost in hour one; it can reset/kill the test.
4. Note 60-minute view count and engagement — this is your expansion-flag window.

### Diagnosing a dead video (in order)
1. **Sub-300 views, flat**: failed Phase 1. Check 3s retention in analytics — if <60-70% hold at 3s, it's the hook. If hold was fine, check metadata (was it tested on the wrong audience?).
2. **Stalled at a tier (e.g., 2-5K)**: cleared batch 1, failed an expansion cohort. Usually mid-video retention sag or a payoff that satisfies followers but not cold viewers.
3. **Multiple videos dead simultaneously + FYP traffic ≈ 0**: run Section 6 suppression checklist.
4. **Slow decline across weeks**: platform saturation and/or niche fatigue — compare to the -31% YoY baseline before panicking; refresh formats rather than assuming punishment.
5. Never delete flops (no benefit, and mass deletion is itself a risk signal). Let them sit; they don't drag future videos (officially confirmed: past performance isn't an input).

### Weekly operating rhythm (account level)
- 15 min: Creator Search Insights → 2-3 content-gap keywords into next week's slate.
- Review traffic-source mix on the week's posts (FYP % trend, search %, follower vs non-follower reach).
- Track completion % and rewatch-proxy (avg watch time ÷ duration >100% = looping) per format; double down on the format winning on *completion*, not likes.
- Cadence floor 3/week; Buffer data says more volume = more views per post, so scale toward 1/day as production allows (strategy level: see ../../Carl/organic-marketing/02-short-form-strategy.md).

---

## Common mistakes

1. **Judging by likes.** Likes are a moderate, declining signal. Completion, rewatch, shares, saves — in that order — are the scoreboard.
2. **Front-loading then coasting.** The 2026 70%-completion bar punishes the classic "strong hook, decaying back half." The last third must earn its runtime.
3. **Deleting and re-uploading flops.** Wastes the account's originality standing; duplicate re-uploads are a suppression trigger. Each video gets one test — remake it *differently* instead.
4. **Metadata negligence.** Emoji-only captions and #fyp-type hashtags put the video in front of the wrong test batch. The test can't be passed if the wrong people take it.
5. **Watermarked cross-posts.** Instagram/YouTube-watermarked video gets throttled. Keep a clean master; export per platform.
6. **Topic-hopping.** Mixing baseball, family vlogs, and facility promos on one account confuses the classifier and depresses everything. Separate accounts per audience.
7. **Ignoring the follower base under follower-first testing.** Buying followers, mass giveaway spikes, or a follower base acquired from one off-niche viral hit now directly damage every future video's Phase 1.
8. **Treating a platform-wide views decline as a personal shadowban** — and its inverse, ignoring a genuine suppression cliff for weeks. The traffic-source panel distinguishes them in 60 seconds.
9. **Using MLB broadcast footage without transformation.** Copyright flags on highlight clips are the most common invisible reach-killer for baseball accounts specifically.
10. **First-hour absence.** Posting and walking away forfeits the expansion-flag window; comment replies in hour one are cheap distribution fuel.
11. **Chasing broad viral sounds.** Rising sounds *within the niche cluster* outperform mega-viral general audio for matched distribution.
12. **Over-polish.** TikTok favors native, human, slightly raw. Broadcast-grade production reads as an ad; the 2026 AI-downranking wave further rewards visible real humans.

## Questions Ashley should ask

1. "Pull the traffic-source breakdown on your last 10 TikToks — what % is FYP, and is that share trending down?" (Separates suppression from saturation from content problems.)
2. "What's the average completion rate by format — breakdowns vs. podcast clips vs. reaction posts? Which format clears 70%?"
3. "Under follower-first testing: who actually follows @IamTrevorMay, and would *they* finish this video? Is any chunk of the follower base off-niche dead weight from an old viral moment?"
4. "Which of your videos show meaningful Search traffic, and have you checked Creator Search Insights for baseball content-gap keywords this week?"
5. "Is any recent footage MLB broadcast material, and is it transformed enough to survive a copyright pass?"
6. "What happened in the first 60 minutes after posting — were you (or anyone on the team) in the comments?"
7. "Are avg-watch-time ÷ duration ratios ever above 100% (looping)? Which videos loop, and what's structurally different about them?"
8. "Is the reach drop account-specific or platform-baseline? Compare your decline to the ~31% YoY platform decline before changing strategy."
9. "Should Neptune content be on this account at all — or does the local-parent audience need its own account with its own classifier identity?" (Almost always: own account.)
10. "It's 2026 and the US model is mid-retrain — is this anomaly two weeks old (wait) or six weeks old (act)?"

## Sources

- TikTok Newsroom — How TikTok recommends videos #ForYou (official): https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you
- TikTok Transparency Center — Introduction to the recommendation system (official): https://www.tiktok.com/transparency/en/recommendation-system
- TikTok Newsroom — Announcement from the new TikTok USDS Joint Venture LLC (official): https://newsroom.tiktok.com/announcement-from-the-new-tiktok-usds-joint-venture-llc
- Metricool — 2026 TikTok Study press release (2,314,756 posts, 92K accounts): https://metricool.com/press-release-tiktok-study-2026/
- Metricool — TikTok Study 2026 (full study page): https://metricool.com/tiktok-study/
- Buffer — TikTok Algorithm Guide 2026 (incl. 11M-video posting-frequency analysis): https://buffer.com/resources/tiktok-algorithm/
- Buffer — State of Social Media Engagement 2026 (52M+ posts): https://buffer.com/resources/state-of-social-media-engagement-2026/
- Hootsuite — How the TikTok algorithm works in 2026: https://blog.hootsuite.com/tiktok-algorithm/
- PostEverywhere — How the TikTok Algorithm Works in 2026 (ranking signals & weights): https://posteverywhere.ai/blog/how-the-tiktok-algorithm-works
- SyncStudio — TikTok Algorithm 2026: Follower-First Update: https://syncstudio.ai/blog/tiktok-algorithm-2026
- Darkroom Agency — TikTok Algorithm 2026: How to Win With Rewatches (15 tactics): https://www.darkroomagency.com/observatory/how-tiktok%E2%80%99s-algorithm-works-in-2026-and-15-tactics-to-go-viral
- Shopify — TikTok Shadow Ban: What It Is and How to Fix It (2026): https://www.shopify.com/blog/tiktok-shadow-ban
- CNBC — After a shaky start, TikTok's U.S. joint venture lands on its feet (Feb 2026): https://www.cnbc.com/2026/02/16/tiktok-us-joint-venture-user-data-no-mass-exodus-oracle-mgx-silver-lake-larry-ellison-trump.html
- Miraflow — TikTok SEO in 2026: How Creator Search Insights Changes Growth: https://miraflow.ai/blog/tiktok-seo-2026-how-creator-search-insights-changes-growth
