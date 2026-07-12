---
title: "Live Streams & Podcasts on YouTube"
domain: youtube-longform
tags:
  - live-streaming
  - podcast-optimization
  - live-to-vod
  - simulcasting
  - chat-engagement
  - rss-ingestion
  - clips-strategy
  - multi-hour-retention
sources_reviewed: 16
last_updated: 2026-07-12
---

# Live Streams & Podcasts on YouTube: Tactical Reference

Scope: live stream discoverability, live-to-VOD decisions, podcast mechanics on YouTube (podcast playlists, RSS ingestion, the podcast shelf), clips strategy, multi-hour retention, chat effects on distribution, and simulcasting rules (Twitch vs YouTube). Algorithm fundamentals, packaging, and general retention strategy live at the strategy level: see `../../Carl/organic-marketing/01-youtube-growth-strategy.md` — this doc assumes that layer and goes one level deeper.

## TL;DR

- **Live discovery is engagement-velocity driven.** YouTube seeds a live stream to recent engagers of your Shorts/posts/videos, then scales distribution in near-real-time based on chat density (messages-per-minute per concurrent viewer), early retention, and CTR stability. A stream with 100 viewers and 20 msgs/min outranks one with 1,000 viewers and 5 msgs/min. Engineer chat in the first 10 minutes.
- **Never delete a live VOD — unlist or trim instead.** Deleting erases the watch time, engagement history, and audience signals attached to it (YouTube's Todd Beaupré is explicit on this). Default flow: trim the VOD (cut "starting soon" screens and dead air), repackage the title/thumbnail as an on-demand video, or unlist if it's genuinely unsalvageable.
- **Podcast = a designated playlist of full episodes, and it unlocks a separate recommendation pool.** Marking a playlist as a podcast in Studio adds it to YouTube Music (background play + downloads without Premium), podcast badges, the youtube.com/podcasts shelf, and podcast-specific carousels including the TV app — where viewers watched ~700M podcast hours/month in 2025.
- **RSS ingestion (static show-art video) is a trap for growth.** Static-image podcast uploads lose ~90–95% of viewers in the first 90 seconds and train the algorithm to stop recommending you. Native video episodes with per-episode thumbnails are the only real path (NPR saw ~16x views adding studio footage). Use RSS only as a catalog-presence backstop, never as the strategy.
- **Judge multi-hour content on absolute watch time, not retention %.** 25–35% retention is *normal* for 30-min-plus podcast/interview content; on a 2-hour episode that's 30–42 minutes of watch time per viewer — an elite signal. Don't compare retention % across lengths.
- **Keep full episodes and clips structurally separate.** YouTube's official guidance: podcast playlists must contain only full episodes; clips/Shorts live outside the show playlist (or on a dedicated clips channel at scale, à la JRE Clips). Use Shorts' "related video" link to route clips → full episode.
- **Simulcasting is now nearly friction-free (as of 2026).** Twitch dropped its exclusivity rule (Oct 2023) and stopped enforcing the on-screen combined-chat ban (Feb 2026). Remaining Twitch rules: quality parity, don't ignore Twitch chat, no directing viewers off-platform in chat. YouTube has zero simulcast restrictions — and its Sept 2025 live stack (dual-format vertical+horizontal, AI Highlights → Shorts, side-by-side ads) makes it the better anchor platform for a non-gaming creator.
- **Streams over 12 hours may not archive at all.** YouTube auto-archives streams under 12 hours; past that the VOD can be lost. Always keep a local recording.

---

## 1. How live streams get discovered (2026 state)

### 1.1 The distribution loop

As of 2026, YouTube Live distribution works in phases (per Streams Charts' 2026 analysis and practitioner consensus):

1. **Seed audience.** When you go live, YouTube identifies users who recently engaged with your Shorts, community posts, or past videos and injects the stream into their home feeds — high-affinity viewers can see it in the top rows.
2. **Recency-of-intent expansion.** Viewers who searched a related topic in the last ~24 hours may be shown your stream even with zero channel history. This is why the *spoken* content matters (see 1.3).
3. **Real-time scaling.** The algorithm evaluates live performance within minutes and expands or throttles reach based on three signals:
   - **Chat density** — messages-per-minute relative to concurrent viewers (second-strongest live signal after total watch time; detail in §6).
   - **Return-to-watch** — viewers who leave and rejoin in the same session read as satisfied.
   - **CTR stability** — if browse CTR on the live card falls below roughly the 4–6% band, testing on new feeds stops.
4. **Early retention gate.** The first ~60 seconds of a viewer's session are tracked; streams that open with dead air or "we'll start soon" fail this gate for every new arrival, all stream long. There is no single "start" for a live stream — every minute is someone's first minute.

Over 70% of YouTube watch time comes from algorithmic recommendation, and live is no exception: subscribers and notifications are your seed, not your ceiling.

### 1.2 Pre-live discoverability playbook

- **Schedule the stream 24–48h ahead** so the waiting room exists, the URL is shareable, and Remind Me notifications accrue.
- **Package the live like a video:** title on a "keyword + value proposition" pattern (e.g., "Trade Deadline LIVE: Every Move Graded by a Big-Leaguer"), custom thumbnail (live thumbnails support A/B testing as of 2026). Live cards compete on the same home feed as VODs.
- **Post a Short ~30 minutes before going live** (the "LIFT" pattern): a tactical teaser that creates a curiosity gap, which wakes up the recent-engager pool right before the seed-audience selection happens. Link it to the stream ("Watch Live Now" via the live-transition/related-video feature).
- **Community post + channel banner** the day before; pin the stream link.
- **Use Practice Mode** (rolled out after Made on YouTube, Sept 2025) to test the full setup privately before going public — no more "testing, can you hear me?" openings burned into the VOD.

### 1.3 Spoken SEO (as of 2026)

YouTube transcribes live audio in real time and ranks streams partly on what is *said*, not just written metadata. Tactics:

- Say the target phrase naturally 3–5 times in the first 15 minutes ("today we're breaking down the Mariners' bullpen usage…").
- Target 4–5-word long-tail phrases; live streams get a "live priority" boost in search results for matching queries — a small live stream can outrank million-view VODs on a live topic (game reactions, breaking trades, award announcements).
- This makes **news-reactive live** the highest-leverage live format for a baseball channel: going live within minutes of a trade, injury, no-hitter, or playoff game ending captures search intent no VOD can reach in time.

### 1.4 In-stream mechanics that affect distribution

- **First 10 minutes:** run a poll or direct question immediately — "Interaction Velocity" early in the stream influences suggested placement (§6 for the full chat playbook).
- **Re-hook on a loop:** every ~10–15 minutes, re-state what the stream is and what's coming ("if you just joined, we're grading every deadline trade — Padres are next"). Every minute is someone's minute one.
- **Concurrent viewers are social proof to the algorithm** — recommending a stream that already holds viewers is "safe." This compounds: engineered chat → more recommendations → more viewers → more chat.
- **Watch-along caution (baseball-specific):** never show broadcast footage on stream. MLB/broadcast rights strikes on live content can end the stream mid-air and jeopardize live access on the channel. Reaction format = your face, your audio, a scorebug-free setup; sync commentary to the game without showing it.

### 1.5 The 2025–2026 live feature stack (Made on YouTube, Sept 16, 2025)

| Feature | What it does | Tactical use |
|---|---|---|
| **Dual-format streaming** | Simultaneous horizontal + vertical broadcast, one unified chat | Vertical feed puts the live in mobile/Shorts-adjacent surfaces; frame the shot so a center crop works |
| **AI-Powered Highlights** | Auto-generates Shorts from the stream's best moments | Free clip pipeline — review, retitle, and publish the good ones within 24h of stream end |
| **Side-by-side ads** | Ad renders beside the stream instead of interrupting it (desktop/TV first) | Removes the retention penalty of midrolls on live; leave enabled |
| **Members-only transition** | Flip a public stream to members-only mid-broadcast without stopping | Public first hour for reach → members-only Q&A back half; funnels memberships |
| **React Live** | Vertical mobile stream reacting to other live content | Low-lift presence during big baseball moments without full production |
| **Practice Mode** | Private full dress rehearsal | Kill tech-check dead air from the VOD permanently |

Stat worth knowing: YouTube reported over 30% of daily logged-in viewers watched live content in Q2 2025 — live is a first-class surface now, not a niche.

---

## 2. Live-to-VOD: trim, repackage, unlist — almost never delete

### 2.1 Hard mechanics (as of 2026)

- **Auto-archive:** streams **under 12 hours** are archived automatically (encoder, webcam, mobile, incl. 1440p/4K). **Streams over 12 hours may not be captured at all.** Always run a local recording as backup — YouTube itself recommends this.
- **Trim:** the Studio Editor can trim the archived VOD (cut the pre-show screen, dead air, tech failures) without losing the video ID, its accumulated watch time, comments, or URL.
- **Privacy:** VOD can be set public/unlisted/private or deleted after the stream from Studio → Content → Live.

### 2.2 Why deletion is the wrong default

Deleting a VOD deletes the watch time, engagement history, and audience-connection signals that video earned — YouTube's own product lead guidance (Todd Beaupré) is not to delete videos without a very good reason. The recommendation system is demand-driven and can resurface old lives when topic interest spikes. Unlisting preserves everything while removing it from discovery. (Algorithm mental model: strategy level, see `../../Carl/organic-marketing/01-youtube-growth-strategy.md`.)

### 2.3 Decision framework for every stream, within 48 hours

| Stream outcome | Action |
|---|---|
| Strong stream, evergreen-ish topic | **Trim + repackage**: cut pre-roll/dead air in Editor, rewrite title from live-speak ("LIVE: hanging out + Qs") to VOD-speak (specific promise), new thumbnail, add chapters. It now competes as a normal long-form video. |
| Strong stream, moment-dependent (game reaction) | **Trim lightly, keep public.** Searchable for days ("[team] [event] reaction"); accept decay. Harvest clips before interest fades. |
| Mediocre stream, few usable moments | **Unlist** (preserve signals), extract 2–5 clips/Shorts and any standalone segment worth a re-edit. |
| Broken stream (tech failure, dead air) | **Unlist** — not delete — unless there's a real reason (rights issue, misinformation, private info leaked). |
| Over 12 hours / archive failed | Upload the local recording as an edited VOD if worth it. |

### 2.4 Repackaging playbook (one stream → a week of content)

1. **Within 24h:** review AI-Highlights Shorts; publish the best 1–3 with proper hooks and the related-video link to the VOD.
2. **Trim the VOD** in Editor: everything before the first spoken word of value goes; cut mid-stream dead segments if the Editor allows clean joins.
3. **Retitle + rethumbnail as on-demand content.** A trimmed VOD with a specific title and per-video thumbnail is "far more likely to be found via search than a long, unedited live replay." Remove "LIVE" / dates unless the moment is the point.
4. **Chapters:** timestamp every segment/question — critical for search ("key moments") and for letting VOD viewers self-serve (multi-hour content behaviors, §5).
5. **Optional hard re-edit:** if a 20-minute segment stands alone (a teaching breakdown, a great guest story), cut it as a *separate upload* with full packaging — this routinely outperforms the parent VOD. The original stays unlisted or trimmed-public; don't double-publish identical content.
6. **Audio pass:** if the stream was podcast-shaped, the trimmed audio can feed the podcast RSS feed (reverse of §3's flow).

---

## 3. Podcasts on YouTube: mechanics that matter

### 3.1 What a "podcast" is on YouTube (as of 2026)

A podcast show = **a playlist designated as a podcast**; episodes = videos in that playlist. Created via Studio → Create → New podcast, or by converting an existing playlist ("Set an existing playlist as a podcast"). Required: title (specific — avoid generic "Podcast"/"Full Episodes"), description, visibility, and a **square 1280×1280 show thumbnail**.

Designation unlocks (eligible shows):
- **YouTube Music distribution** — background listening and downloads *without* Premium; this is where the "audio listener" experience lives.
- **Podcast badges** on watch and playlist pages.
- **youtube.com/podcasts shelf** placement and podcast-specific carousels — including homepage and **TV app** carousels. Podcasts enter a partially separate recommendation pool from standard videos.
- **Podcast Analytics** (Analytics → Overview → See Podcast Analytics): show-level views, watch time, traffic sources, demographics, retention, revenue.

Rules: the podcast playlist must contain **only full episodes**, in consumption order (episodic: newest→oldest; serial: oldest→newest). Do not put clips, Shorts, seasons compilations, or other shows in it — and don't designate clip playlists as podcasts. MP3s can't be uploaded; everything is a video. Copyright strikes disqualify podcast features.

**Why this matters for "Mayday! with Trevor May":** TV is the fastest-growing podcast surface (~700M hours of podcast watch time per month on TVs in 2025). Episode framing, text size on graphics, and thumbnail legibility should assume living-room viewing.

### 3.2 RSS ingestion: what it actually does (and why it underperforms)

Mechanics (YouTube Help, as of 2026):
- Submit RSS feed → verify via the feed's email → YouTube auto-creates a **static-image video** (your show art) per episode and auto-uploads new episodes going forward, notifying eligible subscribers of *new* (not back-catalog) episodes.
- Episodes appear on YouTube + YouTube Music, sorted by RSS release date where available.

Hard limitations:
- **No embedded ads allowed** in RSS-delivered episodes (dynamic ad reads baked into your feed audio violate this); paid promotions must be declared.
- Audio files **cannot be updated after publication** — a fix means a new video.
- Show details don't auto-sync from RSS changes; initial uploads land **private** and must be manually published.
- Deleting an RSS-created YouTube video triggers **automatic re-upload** unless the episode is removed from the feed itself.
- No custom per-episode thumbnails, chapters, end screens, or info cards on the auto-generated videos.

Performance reality: static-image podcast uploads lose **~90–95% of viewers within the first 90 seconds**, which teaches the algorithm to stop recommending the whole show. Real numbers: Slate's static library averaged ~75 views/video, NPR ~179; when NPR added actual studio footage to Life Kit, views jumped ~16x (≈300 → 3,000/episode). Audio-identical video podcasts typically pull only ~5% of the audio feed's download numbers. RSS ingestion is a **catalog-presence backstop for the YouTube Music audience only** — never the growth strategy.

### 3.3 The correct publishing stack for a video-first podcast

1. **Film it** — even two static cameras + a wide beats show art by an order of magnitude (the NPR 16x case is footage, not fancy production).
2. **Native upload each episode** with full packaging: unique 16:9 thumbnail per episode (faces + emotion + the episode's ONE hook — packaging craft: strategy level, see `../../Carl/organic-marketing/01-youtube-growth-strategy.md`), a title selling the single most compelling idea in the episode, not "Ep. 47 — Guest Name."
3. **Chapters on every episode** — non-negotiable for 60+ minute content (§5).
4. **Add to the designated podcast playlist** (full episodes only).
5. **Use the Collaboration/guest-tagging tool** (2025–2026 feature) to tag past guests — cross-pollinates both audiences; one reported case saw a ~700% view increase in two weeks after retroactive tagging. Tag every baseball guest, always.
6. **Auto-dubbing with Expressive Speech** (27 languages, as of 2026) — turn it on; baseball has large Spanish- and Japanese-speaking audiences and this is free international reach.
7. **A/B test thumbnails** (Test & Compare) on episodes with weak first-48h CTR.
8. Keep the audio RSS feed running for Apple/Spotify; optionally point RSS ingestion at YouTube only if you want auto-catalog coverage for episodes you won't produce video for — otherwise skip it.

### 3.4 Episode packaging specifics

- **Title the idea, not the episode.** "Why Pitchers Hide Their Grip — with [Guest]" beats "Mayday Ep. 47: [Guest]." Include the guest's name only when the guest is the draw; otherwise the topic leads.
- **First 60 seconds:** cold-open with the single best exchange of the episode (15–30s), then a one-line frame of what's coming. Never start with "welcome back to the show." Target: hold ≥60% of viewers past 0:30.
- **Description:** first two lines = hook + guest credential; then chapters; then links. Front-load keywords — podcast search on YouTube is a real discovery channel (~40% of new podcast discovery happens via platform search; YouTube leads podcast *discovery* at ~33% of listeners even though consumption skews to audio apps).

---

## 4. Clips strategy: the discovery engine around the show

### 4.1 Structure (YouTube's official position)

- Full episodes: in the podcast playlist, main channel.
- Clips & Shorts: **outside** the show playlist. Two viable homes:
  - **Same channel** (fine at Mayday's scale; Shorts and long-form ranking are decoupled as of late 2025, so clip volume can't drag episode performance).
  - **Dedicated clips channel** (JRE Clips / Waveform Clips model) — only worth it when clip volume is high enough (5+/week) that it pollutes the main channel's identity, or when clips target a broader audience than the show.

### 4.2 Clip production spec

- **Length:** 15–45s is the engagement sweet spot; under 60s to stay a Short on YouTube (a 61s vertical becomes a regular video with vertical-video packaging problems).
- **Selection criteria** (in priority order): contrarian/challenging takes, insider stories with stakes (a big-leaguer saying what fans can't know), emotionally resonant personal moments, "wait, what?" facts. The athlete-insider angle is Trevor's structural clip advantage — every "here's what actually happens in the clubhouse/bullpen" moment is clip fuel.
- **Hook in ≤5 seconds:** open mid-sentence at the most surprising line, then backfill context. Burned-in captions always (majority of feed viewing is muted-first).
- **Route clips to the episode:** use the Shorts related-video link to the full episode; in captions, CTA first, hashtags last.
- **Cadence:** minimum 3 clips/week per active show; a single episode reliably yields 5–10 clips. Channels integrating Shorts see ~14% higher subscription growth (as of early 2025); podcast clips as short-form grew 77% YoY and ~58% of podcast discovery now starts with short-form video.
- **Harvest AI Highlights from live streams** (§1.5) — free first drafts; re-cut the good ones rather than auto-posting.
- Short-form craft (hooks, loops, per-platform nuances): strategy level, see the Carl short-form doc if present; this section covers only the podcast-specific pipeline.

---

## 5. Multi-hour content retention patterns

### 5.1 The benchmark table (as of 2026)

| Length | Healthy retention | Notes |
|---|---|---|
| 5–15 min | 40–55% | Pacing-driven |
| 15–30 min | 30–45% | 50% = exceptional for niche |
| 30+ min (podcast/interview) | **25–35% is normal** | Lowest %, often the *highest absolute watch time* on the channel |

**Rule: never compare retention % across lengths.** 30% on a 2-hour episode = 36 minutes/viewer — more algorithmic value than 70% on an 8-minute video. Judge episodes on average view duration and total watch time. The strongest long-term health metric for a show is **return viewer rate** (10%+ = a genuine audience is forming).

### 5.2 Retention architecture for 1–3 hour episodes

- **Cold open (0:00–0:45):** best exchange of the episode, cut tight. This is where 90-second abandonment is decided.
- **Roadmap (0:45–1:30):** 3 teases of what's coming, with the best one timestamped verbally ("around the hour mark he tells the story about…") — plants a completion goal.
- **Segment resets every 15–20 min:** a new question, topic card, or energy shift. Long-form death is monotony, not length.
- **Chapters:** name them like mini-titles ("The pitch that ended his career"), not labels ("Segment 3"). Chapters let TV and returning viewers re-enter where they left off — multi-hour episodes are consumed in multiple sessions, and YouTube resumes position; chapter names decide whether a paused viewer comes back.
- **Payoff placement:** put a genuinely strong moment at ~60–70% depth. Retention graphs on podcasts sag in the middle; a known-good story there flattens the sag and lifts the whole episode's AVD.
- **TV-first framing (2026):** with podcast TV watch time at ~700M hrs/month, assume a 10-foot viewing distance — bigger lower-thirds, fewer tiny graphics, longer shot durations.

### 5.3 Reading a long-form retention graph

- Cliff at 0:00–0:30 → hook failure (or static-image syndrome).
- Slow linear decay → normal and fine for podcasts.
- Step-drops at segment changes → the outgoing segment overstayed; cut earlier next time.
- Bumps → moments viewers scrub *to*; those are your next clips and your template for future segments.

---

## 6. Live chat & engagement effects on distribution

### 6.1 The mechanics

**Chat density** = messages per minute relative to concurrent viewers, tracked with participant diversity, message timing, and conversation quality. It is the **second-strongest live ranking signal after total watch time** (as of 2026). Ratio beats volume: 100 viewers / 20 msgs-min > 1,000 viewers / 5 msgs-min. Super Chats, Super Stickers, and regular messages all count toward engagement metrics; the 2025 **Engagement Leaderboard** (XP for chats/Super Chats/stickers) gamifies it natively.

Distribution flywheel: chat density ↑ → recommendations ↑ → new viewers → a % of them chat → density holds → more recommendations. The flywheel dies if new arrivals hit a silent chat — so density must be *engineered*, not hoped for.

### 6.2 Chat-engineering playbook

- **Minute 1–10:** direct, zero-effort question with a one-word answer ("Where are you watching from?" / "Mariners or Phillies tonight — one word"). Polls in the first 10 minutes register on interaction velocity.
- **Rotate interactive elements every ~15 min:** trivia round → poll → prediction ("chat, over/under 2 more runs this inning") → shoutouts. Comment-games generate 50–200+ messages per round; giveaway entries 200–400 per round.
- **Read names aloud.** Nothing sustains chat like being acknowledged; batch 3–4 replies at natural pauses so it doesn't fragment the content.
- **Prediction mechanics are baseball's native chat engine:** every at-bat is a poll waiting to happen. Standing segments ("K or no K," "call the pitch") give returning viewers a ritual — which also drives return-to-watch.
- **Benchmarks:** passive streams run 5–20 comments/hour with 2–5 min average retention; interactive streams run 500–2,000+ comments/hour with 15–30+ min retention. Moderation filters target repetitive single-account spam, not high volume — varied answer formats are safe.
- **Super Chat prompts:** acknowledge every Super Chat by name + answer it on-air within ~2 minutes; visible payoff drives the next one. Use members-only transitions (§1.5) as the premium tier of the same behavior.

---

## 7. Simulcasting: rules and the platform decision

### 7.1 Rules as of 2026

**Twitch** (exclusivity dropped Oct 2023; enforcement further relaxed Feb 2026):
- Simulcasting to any platform is allowed for everyone incl. Affiliates/Partners — *unless* you signed an exclusivity contract.
- **Quality parity:** the Twitch feed's resolution/bitrate/framerate must match or exceed what you send elsewhere.
- **Don't neglect Twitch chat:** you must read/engage the Twitch community while simulcasting (third-party multichat tools for private monitoring were always fine).
- **No off-platform direction:** no links to other live platforms in Twitch chat; channel links live in the About section only.
- **Feb 2026 change:** Twitch (Dan Clancy) stopped enforcing the ban on displaying **combined/merged chat on screen** — a unified Twitch+YouTube chat overlay is now permitted (ToS text lagged the enforcement change; check current wording before building around it).
- Enforcement is graduated: warning first, then restrictions.

**YouTube:** no simulcast restrictions at all; actively encourages multi-platform streaming. Also natively supports dual-format (horizontal+vertical) with unified chat within YouTube itself.

### 7.2 Tradeoff analysis (athlete-creator, non-gaming lane)

| Factor | YouTube | Twitch |
|---|---|---|
| Discovery of non-followers | Strong: home feed seeding, search "live priority," Shorts pipeline | Weak: browse directory only; category-driven, gaming-skewed |
| VOD value | VOD inherits the channel's long-form machine; trim/repackage (§2) | VODs sub-only/expiring by default; near-zero search value |
| Revenue split | ~70/30 on memberships/Supers; side-by-side ads | 50/50 sub baseline |
| Audience fit | Baseball/sports audience already lives here | Gaming-native culture; sports is a minor category |
| Clip pipeline | AI Highlights → Shorts natively | Manual clip export |

**Recommendation logic Ashley should apply:** for Mayday, YouTube is the anchor — the live stream feeds the same channel machine (VOD, Shorts, podcast shelf, search) that everything else feeds. Simulcast to Twitch only if (a) a legacy Twitch community from Trevor's playing-days streaming still shows up, and (b) someone can genuinely mind the Twitch chat (a visibly ignored Twitch chat is both a rule risk and a community killer). If simulcasting: match quality both ways, run a combined chat overlay (legal since Feb 2026), and never say "come over to YouTube" in Twitch chat — put the funnel in the About panel and in content itself.

---

## 8. Standing checklists

### Pre-live (T-48h → T-0)
- [ ] Schedule stream w/ keyworded title + custom thumbnail (A/B if the topic repeats)
- [ ] Community post T-24h; Short teaser T-30min with live link
- [ ] Practice Mode dress rehearsal (audio, scenes, overlays)
- [ ] Local recording armed (12-hour archive rule; backup regardless)
- [ ] First-10-minutes chat plan written: opening question + first poll
- [ ] If simulcasting: Twitch quality parity confirmed, combined-chat overlay loaded, chat coverage assigned

### Post-live (T+0 → T+48h)
- [ ] Decide: trim+repackage / trim lightly / unlist (never delete without cause) — §2.3 table
- [ ] Trim pre-show + dead air in Editor; retitle/rethumbnail as VOD; add chapters
- [ ] Review AI Highlights; publish top 1–3 Shorts w/ related-video links
- [ ] Cut any standalone segment worth its own upload
- [ ] Note retention-graph bumps → future clip/segment templates

### Podcast episode publish
- [ ] Native video upload (never rely on RSS static image for a flagship show)
- [ ] Cold open = best 15–30s exchange; no "welcome back" intro
- [ ] Unique 16:9 episode thumbnail + idea-first title; square 1280×1280 art current on the show
- [ ] Chapters with mini-title names; keyword-front-loaded description
- [ ] Added to podcast playlist (full episodes only, correct order)
- [ ] Guest tagged via Collaboration tool; auto-dubbing on
- [ ] 5–10 clips scheduled (≥3/week), hooks in first 5s, captions burned in

---

## Common mistakes

1. **Deleting live VODs** "to keep the channel clean" — erases accumulated watch time and audience signals; unlist instead. Channel-cleanliness anxiety is a feeling, not a ranking factor.
2. **Leaving "Starting Soon" screens on the VOD** — every VOD viewer's first 90 seconds is dead air; the retention graph cliffs and the video never gets recommended.
3. **Publishing the podcast as RSS static-image video and calling it "being on YouTube."** 90–95% 90-second abandonment; ~5% of audio numbers. It's presence, not distribution.
4. **Mixing clips into the podcast playlist** — violates YouTube's podcast-playlist spec and pollutes the shelf/YouTube Music listing.
5. **Judging a 2-hour episode by retention %** and "fixing" it by making episodes shorter — cutting length to chase percentage sacrifices absolute watch time, the thing that actually ranks.
6. **Going live to a silent room with no chat plan** — density is engineered in the first 10 minutes or the distribution flywheel never spins.
7. **Streaming past 12 hours without a local recording** — the archive may simply not exist.
8. **Simulcasting with a worse Twitch feed or an ignored Twitch chat** — both are rule violations (warning → restrictions), and the second one quietly kills whatever Twitch community remains.
9. **Titling live streams like calendar entries** ("Stream 7/12," "Hanging out + Qs") — the live card competes on the same feed as packaged videos; it needs a packaged promise.
10. **Showing broadcast footage in baseball watch-alongs** — rights strike risk that can end live access, not just the stream.
11. **Auto-posting AI Highlights untouched** — they're drafts; without a re-cut hook and title they're mediocre Shorts wearing your channel's name.
12. **Episode titles that lead with episode number and guest name** when the guest isn't famous — the idea is the draw; number-first titles read as homework.

## Questions Ashley should ask

- What did the chat-density curve look like in the first 10 minutes of the last three streams — and what was the scripted opening question, if any?
- For each of the last five live VODs: trimmed, repackaged, unlisted, or left raw? What's the 90-second retention on the raw ones?
- Is "Mayday! with Trevor May" a designated podcast playlist in Studio, and does it contain only full episodes? Is it showing in YouTube Music?
- Are episodes native video uploads or RSS static-image — and if video, what % of each episode's views come from the TV surface?
- What's the average view duration (minutes, not %) on full episodes, and what's the return-viewer rate on the channel hosting them?
- Where are the retention-graph *bumps* on the longest recent episode — and have those moments been cut as clips?
- How many clips per episode actually ship, and do they carry the related-video link back to the episode?
- Has every past baseball guest been retroactively tagged with the Collaboration tool?
- Is there any live Twitch audience worth simulcasting for — and if yes, who is watching the Twitch chat while Trevor performs?
- For news-reactive live (trades, playoffs): what's the current time-from-event-to-live, and what would it take to get it under 30 minutes?
- Is auto-dubbing enabled, and is there any signal from Spanish/Japanese-market viewers worth leaning into?
- Are members-only stream transitions being used as a membership funnel, or is live monetization still Super Chat-only?

## Sources

- Streams Charts — "YouTube Live Growth Explained: How Discovery Actually Works (2026)" — https://streamscharts.com/news/youtube-live-how-effectively-grow-your-audience-2026
- YouTube Official Blog — "YouTube Live Streaming Updates: New Discovery, AI, & Ad Tools" (Made on YouTube, Sept 2025) — https://blog.youtube/news-and-events/live-updates/
- TechCrunch — "YouTube Live gets a major update: dual-format streaming, minigames" (Sept 16, 2025) — https://techcrunch.com/2025/09/16/youtube-live-gets-a-major-update-introduces-dual-format-streaming-minigames-and-more/
- YouTube Help — "Deliver podcasts using an RSS feed" — https://support.google.com/youtube/answer/13525207
- YouTube Help — "Create a podcast in YouTube Studio" — https://support.google.com/youtube/answer/12751636
- YouTube Help — "Manage live stream archives" (12-hour archive limit) — https://support.google.com/youtube/answer/6247592
- Castos — "How YouTube Podcasts Work in 2026" — https://castos.com/youtube-podcasts/
- LiveReacting — "How YouTube's Chat Density Algorithm Affects Live Stream Rankings" — https://blog.livereacting.com/how-youtubes-chat-density-algorithm-affects-live-stream-rankings-2/
- Humble & Brag — "YouTube Audience Retention Benchmarks 2026" — https://humbleandbrag.com/blog/youtube-audience-retention-benchmarks
- Restream — "Twitch Multistreaming Rules Explained" — https://restream.io/blog/twitch-multistreaming-rules-explained/
- Upstream — "Twitch Simulcasting Rules 2026: Unified Chat Allowed" (Feb 2026 enforcement change) — https://upstream.so/blog/twitch-allows-unified-chat-simulcasting-rules/
- Fame.so — "The Ultimate Guide for Creating Podcast Clips That Go Viral on Shorts" — https://www.fame.so/post/ultimate-podcast-clip-guide
- Sweet Fish Media — "State of Video Podcasts 2025" (clip growth, discovery stats) — https://www.sweetfishmedia.com/blog/the-2025-state-of-video-podcasts
- Radio Ink — "Why Are Popular Podcasts Falling Flat on YouTube?" (Slate/NPR static-image data) — https://radioink.com/2023/05/04/why-are-popular-podcasts-falling-flat-on-youtube/
- Birdeye — "Why you should unlist, not delete, your YouTube videos" (Beaupré deletion guidance) — https://birdeye.com/blog/why-you-should-unlist-youtube-videos/
- StreamHub — "Repurposing YouTube Live Streams: Turning VODs into Evergreen Content" — https://streamhub.world/streamer-blog/youtube/1539-repurposing-youtube-live-streams-turning-vods-into-evergreen-content/
