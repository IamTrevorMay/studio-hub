---
title: The Platform-Native Repurposing Pipeline
domain: cross-platform
tags:
  - repurposing
  - clip-selection
  - hook-recutting
  - ai-clipping-tools
  - publish-order
  - caption-adaptation
  - crossposting-mechanics
sources_reviewed: 19
last_updated: 2026-07-12
---

# The Platform-Native Repurposing Pipeline

One shoot → many platform-native assets. This is the execution layer: exactly what to clip, how much to re-edit for each platform, how to re-cut hooks, what to write in each caption, which tools to use, what order to publish in, and how to measure it. (Strategy level — pillars, the GaryVee reverse-pyramid rationale, hero/hub/help portfolio, "distribution > creation" — see ../../Carl/organic-marketing/04-content-strategy-pillars-repurposing.md.)

## TL;DR

- **Yield benchmark: ~1 publishable clip per 5–7 minutes of talk-heavy source.** A 60-min podcast episode should reliably produce 10–20 short clips; a 20-min tutorial/breakdown 4–8. If the team is getting 2–3 clips per episode, the selection process is broken, not the source material.
- **A clip earns standalone status only if it passes all five gates:** self-contained payoff, hook-able first line, no missing context, an emotional or informational peak, and a natural end (ideally loop-able). Score every candidate 1–5 on each; publish 4s and 5s, kill 1–2s, re-cut 3s.
- **There is no cross-platform duplicate-content penalty (as of 2026) — but watermarks are a real one.** Platforms can't see each other's post history; they only see what's in the file. A TikTok watermark on a Reel/Short cuts reach ~40–60%. Always export clean masters from the edit, never download-and-reupload.
- **Re-edit at the right effort tier, not maximum everywhere:** Tier 1 (clean master + native caption/hashtags, ~5–10 min/variant) for TikTok/Reels/Shorts; Tier 2 (re-cut hook + re-timed length + platform text style) for the clips your scoring says are winners; Tier 3 (native rebuild) only for proven outliers.
- **The hook is a per-platform re-cut, not a shared asset.** First-3-second retention above ~70% is the algorithmic gate everywhere (85%+ = viral tier, 2.2–2.8x view multiplier on TikTok). TikTok wants a spoken/provocative cold open in ≤1.5s; Reels wants a visually striking first frame; Shorts wants a searchable question/claim.
- **Publish order: test on the fastest-feedback platform first** (TikTok for Trevor's clips), read 24–48h signal, then push winners to Reels/Shorts with upgraded edits — and stagger, don't simulcast, so each clip gets its own diagnostic window.
- **Measure repurposing as a system:** per-clip naming convention tied back to the source episode, non-follower reach + shares as the clip north star, and a monthly count of "clips that sent people to the long-form" (pinned-comment link clicks, YouTube traffic from Shorts, HDYHAU mentions). (Metric definitions: see ../../Carl/organic-marketing/12-analytics-experimentation.md.)
- **Tooling: an OpusClip-class AI clipper is a first-pass triage tool, not an editor.** Use AI to surface candidate moments and burn captions; a human applies the five-gate score and re-cuts hooks. Budget $20–50/mo for the stack.

---

## 1. The pipeline at a glance

**Input classes for Mayday** (each has a different clip-yield profile):

| Source | Typical length | Expected clip yield | Best derivative types |
|---|---|---|---|
| "Mayday! with Trevor May" podcast episode | 45–90 min | 10–20 shorts + 2–4 horizontal clips | Hot takes, stories, guest moments, audiograms |
| More Mayday long-form video | 10–25 min | 3–8 shorts | Peak moments, punchlines, reveals |
| Trevor May Baseball instructional | 8–20 min | 4–8 shorts | Single-drill / single-cue clips (tutorials clip best — each step stands alone) |
| Live stream / event / facility day | 60–120 min | 15–30 candidates (heavier kill rate) | BTS, reaction moments, Neptune build progress |
| One deliberate "shoot day" (batch vertical) | 2–3 hrs | 8–15 native verticals | Direct-to-camera takes, trends, facility tours |

**The seven-step loop per source asset:**

1. **Mark moments live** — whoever is in the room (or editing first pass) timestamps peaks in real time. Cheaper than archaeology later.
2. **AI first pass** — run the file through the clipping tool; treat its output as *candidates*, not deliverables.
3. **Human gate** — apply the five-gate score (§2). Kill hard.
4. **Hook re-cut per platform** (§4) + effort-tier edit (§3).
5. **Caption/text adaptation** per platform (§6).
6. **Staggered publish** in test-first order (§8).
7. **Score and log** — per-clip performance feeds next episode's selection instincts (§9).

Reality check on ROI (as of 2026): per-platform adaptation of an existing clip costs ~5–10 minutes per variant; three-platform distribution of the same clip inventory roughly triples weekly reach versus single-platform posting. The marginal cost of a variant is tiny compared to the cost of the shoot — the pipeline's whole economics rest on that.

---

## 2. Clip selection: what makes a clip work standalone

### The five gates (score each 1–5; publish at 4+ average)

1. **Self-contained payoff.** The clip delivers a complete thought, story beat, or lesson with zero setup required. Test: would a viewer who has never heard of Trevor understand and get value in isolation?
2. **Hook-able first line.** There exists a moment within the clip's first ~5 seconds of source audio that can open cold — a bold claim, a question, a name-drop, a visual jolt. If the good line arrives at 0:40 of the candidate, re-cut so it's at 0:00 (see §4).
3. **No orphaned context.** No "like I said earlier," no unexplained pronouns ("he told me…" — who?), no reference to something shown off-clip. These are the #1 silent killers of podcast clips.
4. **A peak.** Emotional (laughter, disbelief, vulnerability), informational ("I never knew that"), or status-based (MLB insider detail civilians can't get). AI clippers detect speech-pattern and emotional peaks reasonably well; they miss *insider-value* peaks — a human who knows baseball must catch those.
5. **Natural end — ideally loop-able.** Ends on the punchline or a beat that flows back into the opening frame. The last 3 seconds should invite a replay; even a ~10% replay rate materially boosts distribution (as of 2026).

### What clips best, by content type

- **Instructional (Trevor May Baseball):** one drill, one cue, one fix per clip. Never two. "The one grip change that added 2 mph" beats "3 grip tips."
- **Podcast (guest episodes):** the guest's single most quotable 20–40 seconds; Trevor's strongest disagreement or confession; any moment with a proper noun civilians recognize (team, star player, famous game).
- **Podcast (solo/co-host):** hot takes with a stated stake ("I'd bench him"), stories with a twist, rankings/lists cut to one item per clip.
- **Athlete-creator specific:** locker-room-grade specificity is the moat. The clip test: "could a generic baseball page have made this?" If yes, deprioritize — Trevor's edge is first-person MLB experience, and clips should be selected to maximize that unfair advantage.
- **Facility/Neptune content:** transformation beats (before/after), numbers ("this machine costs $X"), and founder-vulnerability moments. These clip well as Stories/Reels even from casual phone footage.

### Selection process patterns worth stealing

- **ESPN model (as of 2026):** staff watch every premier show specifically hunting YouTube-able moments; a single *First Take* episode yields 8+ clips across three formats — vertical snippets, 1–5 min horizontal clips, and 10–16 min segment uploads. Notably, the *long* segments often massively out-view the short ones (a 16-min Inside the NBA segment did 465K views the same day a 1-min highlight did 2K). Lesson for Mayday: **don't only cut vertical — 2–8 min horizontal "segment" cuts of the podcast are a distinct, underused asset class on the main channels.**
- **GaryVee community-selection tip (tactical version):** ask viewers in the pinned comment and community tab to reply with timestamps of their favorite moment. Comments with timestamps become a free clip-selection layer; the team reviews comments 24–48h post-publish before finalizing the clip slate.
- **The "93% structure" heuristic:** successful short clips overwhelmingly follow hook → concise value bomb → CTA/loop. When trimming a candidate, cut everything that isn't one of those three jobs.

### Kill criteria (auto-reject regardless of score)

- Requires knowing the episode's earlier context
- Peak arrives after 50% of clip runtime and can't be re-cut forward
- Contains unlicensed music bed (blocks Reels distribution; TikTok sounds are not licensed for Meta)
- Guest says something they'd want approval on (athlete-world trust is a business asset — flag, don't post)

---

## 3. Re-editing per platform: the effort-tier system

Lazy identical crossposting isn't algorithmically punished for *duplication* (platforms can't see each other's post history, as of 2026) — it's punished for being *non-native*: wrong watermark, wrong hook style, wrong length, wrong text treatment. The fix is a tiered system so effort goes where the data says.

### Tier 0 — Prohibited: download-and-reupload
Never take a posted video from platform A and upload it to platform B. Watermark detection (visual fingerprinting of the logo position) suppresses reach ~40–60% on the receiving platform, and generational compression degrades quality (another ranked signal). Also (Instagram, as of 2026): accounts that repost heavily — on the order of 10+ detected reposts in 30 days — get excluded from recommendations entirely. **Always export clean masters from the editing tool before anything is posted anywhere.**

### Tier 1 — Native-clean crosspost (~5–10 min/variant) — the default floor
Same edit, per-platform packaging:
- Clean master file (no watermarks, no borrowed platform fonts)
- Platform-correct length trim (see spec table, §5)
- Native caption + hashtags written for that platform (§6)
- Platform-native text overlay style where feasible (TikTok's own text tool reads as native to TikTok; imported CapCut text is fine if rendered clean)
- Reels: set a cover frame that works in the profile grid; Shorts: keyword title + description
Use for: the middle 60–70% of the clip slate.

### Tier 2 — Hook re-cut + re-time (~20–40 min/variant)
Everything in Tier 1, plus:
- Re-cut the opening so each platform gets its native hook type (§4)
- Re-time total length to the platform's retention sweet spot (e.g., the same story runs 24s on TikTok, 34s on Reels, 45s on Shorts with a beat more setup)
- Re-position on-screen text into that platform's safe zones
- Swap the CTA (TikTok: profile/follow; Reels: share/save framing; Shorts: subscribe/watch-full end beat)
Use for: the top 20–30% of the slate by five-gate score, and any Tier 1 clip that shows breakout signal in its first 24–48h.

### Tier 3 — Native rebuild (hours)
A new asset that only borrows the *idea*: re-shot direct-to-camera version of a take that popped, a trend-format remake, a stitched/duet-style response to the clip's own comments, a text-thread version for X, a Substack section. Use only for proven outliers (≥3x the account's rolling average — outlier logic: see ../../Carl/organic-marketing/12-analytics-experimentation.md) or planned hero moments.

### Audio rule (frequently missed)
Trending TikTok sounds are licensed for TikTok only. A clip built on a TikTok sound gets **limited distribution on Reels**. Keep the master's audio bed platform-agnostic (original speech + royalty-free/owned music), and add trending sounds *inside each platform's native composer* at low volume if wanted.

---

## 4. Hook re-cutting

### Why this is its own step
First-3-second retention is the universal gate (as of 2025–2026 data):
- TikTok: 70–85% first-3s retention ≈ 2.2x total views vs. sub-60% clips; 85%+ ≈ 2.8x and viral-tier distribution; below 60% gets minimal push. Over 70% of TikTok users decide watch-or-scroll within 3 seconds.
- Shorts: 50–60% of all drop-off happens in the first 3 seconds; target >70% surviving them. Shorts with the hook inside the first 2 seconds retain ~19% more viewers; vidIQ data shows hooks under 2s deliver ~30% higher average view duration than longer intros.
- Reels audiences tolerate a slightly slower, more polished open than TikTok, but the visual first-frame matters more (Reels is judged on the thumbnail/first-frame in more surfaces — feed, grid, Explore).

### The re-cut method (per clip, per platform)
1. **Find the strongest single sentence** anywhere in the clip. That sentence becomes second zero — even if it originally came mid-story ("cold open on the payoff, then rewind").
2. **Cut all throat-clearing:** "so, um, one thing I always say…" dies. Enter mid-energy.
3. **Write the on-screen hook text** as a separate asset from the spoken hook — it should add tension, not transcribe. Spoken: "He told me he was tipping his pitches." On-screen: "An MLB hitter knew what was coming." (>60% of mobile viewing is sound-off; text carries the hook alone.)
4. **Platform-flavor the open:**
   - **TikTok:** provocative claim or unresolved statement in ≤1.5s; conversational, imperfect energy reads as native.
   - **Reels:** lead with the most visually striking frame (the swing, the radar gun, the facility reveal); hook text can be a beat slower and more polished.
   - **Shorts:** open with a searchable question or claim ("Why do MLB pitchers hate the new baseballs?") — Shorts surfaces in YouTube *and Google search*, unlike the pure-feed platforms, so the hook doubles as a query match.
5. **Check the loop:** does the last beat flow back into the first frame? If the clip ends on the setup of the opening claim, replays climb.

### Reusable hook patterns for Trevor's lanes
- **Insider reveal:** "Here's what actually happens in the bullpen when…"
- **Contrarian take with stakes:** "Everyone teaches this cue wrong, and it's costing kids velocity."
- **Named-entity gravity:** open on the famous name/team, not on Trevor's setup to it.
- **Number-first:** "97 mph looks like this from the batter's box."
- **Confession/vulnerability:** "The at-bat that made me consider retiring."
- **Before/after (Neptune):** first frame = finished thing or dramatic result, then the build.

---

## 5. Per-platform adaptation spec sheet (as of mid-2026 — recheck quarterly)

| Platform | Target length | Hook style | Text/caption treatment | CTA | Notes |
|---|---|---|---|---|---|
| TikTok | 21–34s (talk clips); up to ~60s for stories that hold | Spoken cold open ≤1.5s, provocative | Native-feel overlays; word-by-word captions; keep center-safe (UI eats right rail + bottom ~15%) | Profile visit / follow | Completion rate is the dominant signal; shorter beats longer if retention flat |
| Instagram Reels | 30–45s | Visually striking first frame; slightly more polished | High-contrast animated captions; set a deliberate cover frame for grid | Share / save framing ("send this to a coach") | Sends/saves outweigh likes; no TikTok audio |
| YouTube Shorts | 15–45s by type (tips 15–20s; tutorial cuts 25–40s; stories 30–45s); up to 60s+ tolerated | Searchable question/claim in first 2s | Burned captions (+15–25% retention); keyword title 60–70 chars; 2–3 search phrases in description | Subscribe / "full video on the channel" | Search-discoverable (YouTube + Google); Shorts is also the funnel into long-form via the related-video link |
| X | 20–45s video, or thread/text-native version | First line of the post is the hook | Post text 71–100 chars performs best; quote the clip's best line verbatim | Link in reply/follow-up post | Text-native versions (the take as a thread) often beat the video itself here |
| Facebook | Reels specs mirror IG; also 1–3 min horizontal for pages/groups | Same as IG | Slightly longer captions acceptable; older demo tolerates slower pacing | Group/community pushes | Meta Business Suite crossposts IG↔FB natively without penalty |
| YouTube main (horizontal clips) | 2–8 min "segment" cuts; 10–16 min for premium segments | Standard YT packaging: thumbnail + title do the hooking | Full title/thumbnail treatment like any upload | End screens to related long-form | The ESPN lesson: segment-length uploads can out-view everything else in the slate |
| Podcast audiogram / Substack | 30–60s audiogram; clip transcript → newsletter section | The pull-quote is the hook | Substack: the clip's transcript, lightly edited, + embedded video | Subscribe / listen link | Cheapest derivative in the whole pipeline — near-zero marginal cost |

**Safe zones (vertical, all three short platforms):** keep faces and hook text in the middle third; nothing meaningful in the bottom ~15% (caption/UI overlap) or the right edge (engagement rail). One master 9:16 frame designed to these constraints exports safely to all three.

**Cut cadence:** high-performing shorts average a cut or visual change every 2–4 seconds. Talk clips hold attention with punch-ins, caption animation, and B-roll inserts rather than literal cuts.

---

## 6. Caption & text adaptation per platform (as of early 2026)

The caption is a separate creative asset per platform — 2–3 minutes each, never pasted across.

- **Instagram Reels:** ≤150 characters preferred; the hook must land in the first 125 characters (the "…more" fold). Hashtags: Instagram began capping at 5 per post (rollout started Dec 2025) — use 3–5 niche tags (#pitchingdrills, #mlboffseason), never broad spam tags. Keywords in the caption text now do more for discovery than hashtags.
- **TikTok:** two modes. FYP-play: 50–150 characters, punchy, can tease ("he wasn't ready for this answer"). Search-play: 150–300 characters written keyword-first ("how to increase pitching velocity 14u") — TikTok search behaves like Google and instructional content should be written for it. 3–5 niche hashtags.
- **YouTube Shorts:** the *title* is the caption. 60–70 characters, primary keyword up front; value proposition inside the first 150 characters of the description; 2–3 search phrases naturally in the description; a few hashtags in description are fine.
- **X:** 71–100 characters of post text performs best; the strongest single quote from the clip, verbatim, usually outperforms a description of the clip.
- **Facebook:** IG caption works; can run slightly longer. Groups reward a discussion question at the end.
- **Substack/newsletter:** don't caption — *contextualize*. 2–4 sentences of why this moment mattered, then the clip/quote. The newsletter is where orphaned context is allowed back in.
- **Universal:** first line = hook, written fresh per platform; platform-specific CTA; keywords woven into natural sentences (the 2026 shift: keywords beat hashtags for discovery on every platform).

---

## 7. Tooling (as of 2026 — this market churns; re-verify pricing quarterly)

### AI clipping layer (OpusClip-class)

| Tool | Price (from) | Strength | Weakness |
|---|---|---|---|
| OpusClip | ~$15–29/mo (credit-based) | Best-in-class moment detection + Virality Score (the category benchmark); B-roll gen | Credit model punishes volume: Pro's 300 credits ≈ one weekly hour-long podcast eats 240; limited post-clip editing |
| Vizard | ~$29/mo | Strong clip relevance; team/brand kits | Cost |
| Choppity | ~$20/mo (hour-based) | Full pipeline: clip → transcript edit → multi-platform post → cross-platform analytics in one tool | Free tier preview-only |
| Descript | ~$24/mo | Transcript-native precision editing (best for podcast workflows) | Manual clip selection — no moment detection |
| quso.ai | ~$19/mo | Clipping + scheduler + analytics bundle, cheaper than Opus | Detection quality behind Opus |
| Submagic | ~$19/mo | Best caption animations | Weak moment detection |
| CapCut | Free | Manual editing, full-featured | No AI detection; render *clean* (no CapCut watermark) |
| Repurpose.io | ~$35/mo | Automated multi-platform distribution of finished clips | No clip detection — distribution only |

**Key buying insight:** variance in *moment-detection quality* between tools is larger than variance in pricing — trial on 2–3 real podcast episodes and count how many AI picks survive the five-gate score. Expect the AI to surface maybe half your final slate; it reliably finds speech-energy peaks and misses insider-value peaks.

**Reasonable Mayday stack:** one detection tool (OpusClip or Choppity) + Descript or CapCut for hook re-cuts + native schedulers or Metricool (already in-house) for publishing. ~$30–50/mo total.

### Template layer (build once)
- A 9:16 master template per show: caption style, safe-zone guides, logo placement, end-card. Every clip inherits it → per-variant time drops toward the 5–10 min floor.
- A caption-formula doc per platform (the §6 rules as fill-in-the-blank).
- A hook-pattern bank (§4 list, appended every time a hook overperforms).
- A clip-log spreadsheet or Studio table: source episode, timestamp, five-gate score, platforms posted, per-platform 48h numbers.

---

## 8. Publish-order strategy

### The test-first ladder
1. **TikTok first.** Fastest, most honest feedback loop: distribution is least follower-dependent, and 24–48h of data cleanly separates the clip's intrinsic appeal from Trevor's existing audience. Post the Tier 1 cut.
2. **Read the 24–48h signal:** completion/retention (esp. first-3s hold), shares-per-reach, non-follower %, comment velocity.
3. **Winners get promoted up-stack:** re-cut to Tier 2 for Reels and Shorts (platform-native hook + length). Losers still go out at Tier 1 on the other platforms (marginal cost is minutes) — different platforms genuinely disagree — but get no extra edit investment.
4. **Proven outliers (≥3x rolling average) trigger Tier 3:** native remake, X text-thread version, newsletter feature, possibly a full long-form video on the topic. The clip has just validated a content thesis for free.

### Why stagger instead of simulcast
- Each platform gets a clean diagnostic window (a clip dying everywhere simultaneously teaches less than sequential reads).
- The Tier 2 upgrade for platforms 2–3 is *informed* by platform 1's retention graph — if TikTok shows a drop at second 9, the Reels cut fixes second 9.
- Staggering by hours–days has zero algorithmic cost; platforms can't see each other (as of 2026). Same-day is fine; same-minute wastes the learning.

### Sequencing against the long-form parent
- **Pre-drop teasers (1–2 clips, 24–48h before the long-form/episode):** curiosity cuts that *don't* resolve — drive anticipation, pin the episode link once live.
- **Launch-week wave (3–6 clips over days 1–7):** the strongest self-contained moments, each pointing at the parent.
- **Evergreen trickle (remaining slate over 2–6 weeks):** instructional and story clips that don't age; this is how one shoot fills the calendar between shoots. Yesterday's episode is not "old news" on a feed platform — a great moment posts just as well 3 weeks later.
- **Shorts-specific:** Shorts→long-form is the highest-intent bridge (related-video link + same-platform audience); weight the most "watch the full breakdown" clips toward Shorts.

### Volume guardrail
3–5 shorts/week/platform is the sustainable high-signal cadence (as of 2026 guidance); creators repurposing well ship 5–7 posts/week across platforms from 2–3 original productions. Flooding 3+/day from one episode cannibalizes the clips' individual windows and burns the slate that should trickle.

---

## 9. Measuring repurposed content

(Metric definitions and north stars per platform: see ../../Carl/organic-marketing/12-analytics-experimentation.md. Below is only the repurposing-specific instrumentation.)

### Per-clip tracking (non-negotiable hygiene)
- **Naming convention** encoding source + platform + variant: `MM-EP47-C3-TT-v1` (show, episode, clip #, platform, cut version). Without this, "which moments work" is unanswerable at month's end.
- **Log at 48h and at 14d:** views, non-follower reach %, shares, completion/retention, follows-per-clip, and (Shorts) traffic to the parent video.
- **Clip north star:** shares + non-follower reach (feed views are cheap; amplification is the point).

### System-level questions the log must answer monthly
1. **Yield:** clips published ÷ source hours. Falling yield = selection or capacity problem.
2. **Hit rate:** % of clips beating the platform's rolling per-clip average. A 20–30% hit rate is healthy; near-100% means not enough swings, near-0% means selection gates are broken.
3. **Which source segments over-index?** (Guest stories? Velocity content? Neptune build updates?) This feeds *recording* decisions — the pipeline should reshape what gets shot.
4. **Bridge conversion:** evidence clips feed the compounding assets — Shorts→long-form views, pinned-link clicks, follower growth on clip-heavy weeks vs. not, podcast-follow lift in clip-wave weeks, and HDYHAU/"saw your clip" mentions for Neptune.
5. **Effort ROI by tier:** do Tier 2 re-cuts actually outperform Tier 1 of the same clip? If not consistently ~1.5x+, the Tier 2 checklist needs revision — don't pay the edit tax on faith.

### Cross-platform comparison caveat
Expect systematic platform gaps independent of clip quality (Metricool, 5M+ videos, 2025–2026): Reels averaged ~30% fewer views and ~14% fewer interactions than the same-format TikTok posting; YouTube Shorts interactions fell ~50% YoY in 2025 amid volume saturation. Judge each platform's clips against *that platform's* rolling average, never against each other raw.

---

## 10. The weekly SOP (one podcast episode → full slate)

**Day 0 (record):** timestamp peaks live in a shared note. Guest flag-list for approval-needed moments.
**Day 1 (triage, ~60 min):** run file through AI clipper → merge AI candidates with live timestamps → five-gate score → final slate: 8–15 verticals + 1–3 horizontal segment cuts + 1 audiogram + pull-quotes for Substack/X.
**Day 1–2 (edit):** template-drop all Tier 1 cuts; Tier 2 hook re-cuts for the top-scored 3–4. Export clean masters. Write per-platform captions in the same sitting (batching beats per-post writing).
**Day 2 (pre-drop):** 1–2 teaser clips to TikTok + Reels.
**Day 3 (episode live):** parent publishes; teasers get pinned comments/links updated; first launch-wave clip on all three verticals (staggered by hours); horizontal segment cut to the relevant YouTube channel.
**Days 4–9:** launch wave continues, 1/day/platform max; 48h reads logged; winners promoted to Tier 2 on remaining platforms.
**Ongoing:** evergreen trickle scheduled 2–6 weeks out; outliers flagged for Tier 3 and for the "make more of this" list.
**Weekly review (15 min inside the existing analytics review):** hit rate, best/worst hook, one selection-rule update written down.

---

## Common mistakes

1. **Download-and-reupload crossposting.** Watermark suppression (~40–60% reach cut) + quality loss. Clean masters only.
2. **Same caption everywhere.** Not a technical penalty, but each platform's fold, search behavior, and CTA norms differ enough that pasted captions measurably underperform.
3. **Letting the AI clipper choose the final slate.** It finds energy peaks, not insider-value peaks; unscored AI output ships mediocre clips that poison the account's per-clip averages.
4. **Hook buried at 0:20.** The most common fixable failure: the clip contains a great hook, just not at second zero. Re-cut, don't reject.
5. **Two ideas per clip.** Especially instructional content — one drill/cue/take per clip, always.
6. **TikTok-sound masters.** Kills Reels distribution. Sounds get added natively per platform, never baked into the master.
7. **Only cutting vertical.** The ESPN data says 2–16 min horizontal segments are their view leaders; a shorts-only pipeline leaves the biggest derivative asset unmade.
8. **Simulcasting the whole slate on launch day.** Burns the evergreen trickle and collapses all diagnostic windows into one noisy day.
9. **Judging clips on raw views across platforms.** Platform baselines differ ~30%+ structurally; use per-platform rolling averages.
10. **No naming convention / no log.** The system can't learn; every month restarts from instinct.
11. **Orphaned context clips** ("as I said before…") shipped because the moment was good in-episode. The five gates exist to catch exactly this.
12. **Treating repurposing as an editing task instead of a selection task.** 80% of clip performance is decided at selection and hook; polish is the last 20%.

## Questions Ashley should ask

- "What's your current clip yield per podcast episode, and who applies a quality gate between the AI clipper and publish?"
- "Show me the last 10 clips: were the captions written per platform, or pasted?"
- "Which platform do you post to first, and what do you actually do differently based on its first 48 hours?"
- "Do your masters have any platform watermark or TikTok-licensed audio baked in?"
- "What's your per-clip naming convention — can you tell me right now which *episode segment types* over-index?"
- "When did a clip last change what you recorded next? If never, the pipeline is only running downstream."
- "Are you cutting horizontal segment clips (2–8 min) or only verticals?"
- "What's the Tier 2 re-cut actually buying you — have you compared a re-cut hook vs. the Tier 1 version of the same clip?"
- "How would a Neptune prospect who saw a clip tell you that's how they found you?"
- "Which of last month's clips would pass all five gates today — and would you have killed the bottom third before posting?"

## Sources

- Conbersa — How to Repurpose One Video Across TikTok, Reels, and Shorts: https://www.conbersa.ai/learn/how-to-repurpose-one-video-across-platforms
- Socialync — Avoid Duplicate Content Penalties When Cross-Posting (2026): https://www.socialync.io/blog/avoid-content-duplication-penalties-cross-posting-2026
- Metricool — State of Short-Form Video in Social Media 2025 (5M+ videos, 582K accounts): https://metricool.com/social-media-short-video-report-2025/
- Metricool — Instagram Study 2026 press release: https://metricool.com/press-release-instagram-study-2026/
- YouTube Official Blog — Transitioning your long-form content to YouTube Shorts: https://blog.youtube/creator-and-artist-stories/transitioning-your-long-form-content-to-youtube-shorts/
- OpusClip Blog — The Ideal YouTube Shorts Length & Format for Retention: https://www.opus.pro/blog/ideal-youtube-shorts-length-format-retention
- OpusClip Blog — YouTube Shorts at Scale (clip yield benchmarks): https://www.opus.pro/blog/youtube-shorts-at-scale
- Sportico — ESPN YouTube Strategy: Studio Show Clips Bring Views by the Billion (2026): https://www.sportico.com/business/media/2026/espn-youtube-strategy-clips-pat-mcafee-stephen-a-smith-1234899297/
- Choppity — Best Opus Clip Alternatives (Tested & Ranked, 2026): https://www.choppity.com/blog/best-opus-clip-alternatives/
- TTS Vibes Insights — TikTok First 3 Seconds Hook Retention Rate Statistics: https://insights.ttsvibes.com/tiktok-first-3-seconds-hook-retention-rate/
- GaryVee Content Model (original PDF): https://s3.amazonaws.com/gv2016wp/wp-content/uploads/20180725172810/GV-Content-Model-1.pdf
- chopcast — Applying the GaryVee Content Model (community timestamp selection): https://www.chopcast.io/blog/garyvee-content-model
- Boomp — Social Media Caption Length / Character Limits 2026: https://boomp.net/blog/social-media-caption-length
- Monolit — How Long Should a TikTok Caption Be in 2026 (FYP vs Search modes): https://monolit.sh/blog/how-long-should-tiktok-caption-be-2026-data-backed-answer-founders
- trustypost — Instagram Reel caption length 2026 (hashtag cap rollout): https://trustypost.ai/blog/instagram-reel-caption-length-2026-best-practices-examples-that-get-watched/
- SocialKit — Does the TikTok Watermark Hurt Your Reach?: https://socialk.it/en/blog/tiktok-watermark-reach-guide
- SocialGPT — How to Repurpose Content Across TikTok, Reels, and Shorts in 2026 (per-platform hook types): https://gpt.social/blog/how-to-repurpose-content-across-tiktok-reels-and-shorts
- Virvid — First 3 Seconds Hook Structures / Shorts retention data: https://virvid.ai/blog/first-3-seconds-hook-faceless-shorts-2026
- quso.ai — How to Turn Long Form Videos into YouTube Shorts at Scale: https://quso.ai/blog/how-to-turn-long-form-videos-into-youtube-shorts-at-scale
