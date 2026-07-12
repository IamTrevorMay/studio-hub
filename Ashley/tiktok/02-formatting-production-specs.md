---
title: "TikTok Formatting & Production Specs"
domain: tiktok
tags:
  - tiktok-specs
  - safe-zones
  - captions-seo
  - on-screen-text
  - watermarks
  - cover-frames
  - video-length
  - photo-carousels
sources_reviewed: 16
last_updated: 2026-07-12
---

# TikTok Formatting & Production Specs

Tactical execution reference: the exact numbers, placements, and settings that affect whether a TikTok gets distributed. Strategy (why short-form, algorithm mechanics, cadence, clip selection) lives at ../../Carl/organic-marketing/02-short-form-strategy.md — this doc assumes that layer and goes one level down.

## TL;DR

- **Ship 1080×1920 (9:16), MP4/H.264, 30fps, ≥2 Mbps.** Anything other than 9:16 gets letterboxed or cropped in feed → lower watch time → less reach. Minimum acceptable source is 720p; blurry video is deprioritized by the recommendation system (as of 2026).
- **Respect the safe-zone box:** keep all text, faces, and payoff visuals out of the top ~150px, bottom ~480px, right ~250px, left ~60px of a 1080×1920 frame. The single most common self-inflicted reach killer is hook text hidden behind the caption stack or the like/comment rail.
- **TikTok reads three text layers for search indexing: spoken audio (ASR), on-screen text (OCR), and the caption field.** Put the target keyword in all three. Front-load it in the first ~100 characters of the caption (before the "…more" fold). 3–5 hashtags, not 15.
- **Length: completion rate beats duration, but the reach data now favors 60s+.** Buffer's 1.1M-video study: >60s videos got 43% more reach and 64% more watch time than 30–60s videos. Sweet spots by job: 21–34s entertainment, 24–38s viral/story, 60–90s storytelling/analysis, 60–180s tutorials.
- **Native features are a real, if modest, reach input.** TikTok's own docs list "created natively" among video-detail signals; native text tool, native auto-captions, and sounds from TikTok's library are indexed better than burned-in third-party equivalents. Edit wherever you want, but add text/captions/sound *inside* the app when practical.
- **Watermarks are a one-way penalty you control.** A TikTok logo on a Reel/Short reliably tanks distribution (Meta has said so publicly); reported reach hits of 40%+ on repurposed content. Always keep a clean master and export per platform — never download-and-repost. (Workflow strategy: see ../../Carl/organic-marketing/02-short-form-strategy.md.)
- **Photo carousels are the highest-engagement-per-view format on TikTok right now (2025–2026).** Fanpage Karma's 698K-post analysis: +81% engagement rate vs. video. TikTok is actively boosting them on the FYP. Use 5–10 slides, 1080×1920, first slide built like a thumbnail.
- **Set a custom cover on every post.** Covers don't affect FYP reach directly, but they drive profile-grid binge sessions and search-result clicks — and search is now ~a fifth of good accounts' views. Design for the center 1080×1080 square (grid crop) and keep the bottom ~270px clear of text (auto caption overlay).

---

## 1. Core video specs (as of mid-2026)

| Spec | Value | Notes |
|---|---|---|
| Aspect ratio | **9:16** | 1:1 and 16:9 are accepted but letterboxed/cropped in feed — measurably worse watch time. Full-bleed vertical only. |
| Resolution | **1080×1920** | 720×1280 is the floor. Upscale 4K masters down to 1080p on export; TikTok recompresses aggressively. |
| Format / codec | **MP4, H.264** | MOV also accepted. Avoid H.265/HEVC — compatibility issues on older Android trigger extra transcoding and quality loss. |
| Frame rate | **30fps** (23–60 accepted) | Export ≤60fps. 24fps podcast clips are fine; don't frame-blend up. |
| Bitrate | **≥2 Mbps** for 1080p; 8–12 Mbps export is a good target | TikTok's transcoder degrades low-bitrate sources further. |
| Duration | 3 sec – 10 min (most accounts) | Practical ceilings below in §7. |
| File size | ~287 MB mobile (iOS), ~72 MB (Android), up to 1–4 GB desktop/API | Desktop upload preserves quality better for edited content. |
| Audio | Always include sound | TikTok's own best-practices doc treats sound as table stakes; silent video is effectively broken content on this platform. |

**Upload-quality settings checklist (do once per device):**
1. In-app: when posting, tap "More options" → toggle **"Upload HD" / "Allow high-quality uploads"** ON. It defaults off on some builds.
2. iPhone camera: 4K/30 or 1080/30, HDR off for cleaner transcode (HDR→SDR conversion on TikTok can blow out skin tones — relevant for face-to-camera baseball breakdowns).
3. Prefer **desktop upload (tiktok.com or Studio)** for edited/podcast-clip content — larger file allowance = less pre-compression.

---

## 2. Safe zones — the pixel map

TikTok's UI sits *on top of* the video. On a 1080×1920 frame, treat these as no-go zones for text, faces, scoreboards, and payoff moments:

| Zone | Keep clear | What covers it |
|---|---|---|
| Top | **~150px** | Username, "Following / For You" tabs, search icon |
| Bottom | **~480px** (organic feed; ads UI is closer to ~320px) | Caption text, hashtags, sound/music marquee, "see more" expander |
| Right | **~250px** | Avatar, like, comment, save, share stack |
| Left | **~60px** | Edge bleed / rounded corners |

**Working rule:** the reliable canvas is roughly the **center 700×1200** of the frame. Put hook text in the **upper-middle third** (below the 150px top band, above vertical center) — this is the conventional "TikTok text" position and it never collides with UI.

Practical steps:
- Build a 1080×1920 safe-zone overlay PNG once (transparent with the four zones shaded) and drop it as a top layer in Premiere/CapCut templates for every Mayday vertical export. Toggle visibility before export.
- Longer captions push the caption stack *higher* — if you run 300-character SEO captions (see §4), assume the bottom ~550px is dead.
- Baseball-specific: pitch-tracking overlays, velo readouts, and K/BB graphics that editors habitually park bottom-right sit exactly under the engagement rail. Move them upper-left.

---

## 3. On-screen text conventions

Two distinct text layers, different jobs:

### A. Hook text (the headline)
- One line of large text on screen for the **first 1–3 seconds**, upper-middle position. This is the "thumbnail" of a TikTok — most viewers decide in ~1.3 seconds.
- Conventions that read as native: bold sans-serif (TikTok's native "Classic" font, or Montserrat/Helvetica Bold), white with black outline or the native background-pill style, sentence case, ≤10 words.
- The hook text should create an open loop the video closes: "The pitch that ended my career" > "Trevor May talks injuries." Curiosity gap, named stakes, or a bold claim.
- **OCR matters:** TikTok reads this text for search indexing (as of 2026). Put the search keyword in the hook text itself ("How to throw a changeup" on screen, not just spoken).

### B. Subtitles / running captions
- **Chunking: 3–7 words per line, 1–3 seconds each**, broken at natural speech pauses. Mobile reading speed is ~3–4 words/sec; TikTok's official ad guidance says display 5–10 words per second max.
- High contrast is non-negotiable: white + black outline (or the karaoke-highlight style popularized by Hormozi/podcast clippers — fine, but don't animate so hard it competes with the face).
- **Position: center-middle to upper-middle.** Never the bottom 25% (caption stack) or top 8% (username).
- **Use TikTok's native auto-captions, then edit them.** Native auto-captions (a) are indexed for search more reliably than burned-in third-party captions, (b) let sound-off viewers toggle them, and (c) are an accessibility signal. Editing pass: fix proper nouns (player names, "Wheeler" vs "wheeler"), homophones, and timing in the first 10 seconds where sync errors cluster. Budget 2–5 minutes per post.
- Captions raise watch time **12–40%** depending on niche — one of the highest-ROI 5-minute tasks in the workflow.
- For podcast clips ("Mayday! with Trevor May"): burned-in stylized subtitles for the sound-off scroll **plus** native auto-captions on. They don't conflict; the native layer is for indexing and the toggle-on audience.

---

## 4. Caption field: length, keywords, hashtags (TikTok SEO layer)

The caption (description) field limit is **4,000 characters** (as of 2026; raised from 2,200 specifically to enable search optimization). Only the first **~100 characters** show before the "…more" fold.

**Length guidance by goal:**
- Pure engagement / entertainment clips: **under ~150 characters** — short captions correlate with ~21% higher engagement rates in 2025–2026 datasets.
- Search-target content (tutorials, "how to" baseball mechanics, facility content): **150–300 characters**, keyword-rich, conversational. Socialinsider's carousel data found 200+ character captions averaging ~3x more views on that format.
- Don't write 1,000+ character essays; diminishing returns and it buries the fold line.

**Keyword placement rules:**
1. **Primary keyword in the first 50–100 characters** — before the fold, where algorithmic weight is highest.
2. Same keyword should also be **spoken in the first 5 seconds** (ASR-indexed) and **on screen as hook text** (OCR-indexed). Triple-layer indexing is the core TikTok SEO move (as of 2026); TikTok's NLP handles synonyms, so natural variations are fine.
3. Structure: **Hook line → context → CTA.** ("The grip change that added 3mph ⤵️ Full breakdown on the changeup every HS pitcher should learn. Which pitch next?")
4. Questions in captions bait comments; comments are a distribution signal. End with one.

**Hashtags:** **3–5**, laddered — one broad (#baseball), one mid (#pitchingtips), one or two specific (#changeupgrip, #neptuneperformance). Hashtags are categorization hints, not magic; #fyp/#viral do nothing. (Strategy-level treatment of search vs. FYP discovery: see ../../Carl/organic-marketing/02-short-form-strategy.md.)

**Why this matters more every quarter:** TikTok search runs ~140B searches/year, 74% of Gen Z use it as a search engine, and 43% of top search results come from accounts under 10K followers (2026 figures) — search is the one distribution surface where a smaller account competes on content, not momentum. Target: 20%+ of views from search on evergreen instructional content.

---

## 5. Native editing features — do they actually boost reach?

What's actually known (as of 2026):
- TikTok's documentation lists "video details" — including whether content was **created/edited natively** — among recommendation inputs. This is a real but **secondary** signal; it will not save a weak video and won't sink a strong one.
- The *mechanistic* advantages of native features are bigger than the raw "native flag":
  - **Native text tool + auto-captions** → cleanly OCR/indexed for search (burned-in text is OCR'd too, but native metadata is more reliable).
  - **Sounds from TikTok's library** → the video joins that sound's page and rides its trend graph; videos on trending sounds see ~52% more views in 2025–2026 datasets. Externally-mixed audio joins nothing.
  - **Native effects/templates during a trend window** → same page-attachment effect.
- **CapCut:** owned by ByteDance; there is no credible evidence TikTok penalizes CapCut-edited video, and the (removable) "CapCut template" end-card is the only real risk — always delete it. Persistent "CapCut hurts views" chatter is confounded by quality, not causation.
- **Premiere/Resolve-edited uploads** (the Mayday pipeline) are fine and the norm for podcast-clip accounts. The play is hybrid:

**Hybrid workflow (recommended for Mayday):**
1. Cut, color, and burn stylized subtitles in the desktop NLE. Export clean 1080×1920.
2. Upload via TikTok app or Studio; add **native elements in-app**: auto-captions (edited), a library sound bed at low volume under original audio when a relevant sound is trending, poll/comment stickers when they fit, location tag for Neptune facility content.
3. Never post a bare re-encode with zero native metadata — that's the profile TikTok's spam/unoriginal-content filters are tuned to.

---

## 6. Watermarks and cross-posting penalties

- **TikTok logo on other platforms:** Meta has publicly confirmed Reels deprioritizes videos with visible watermarks from other apps; measured/reported reach reductions on repurposed watermarked content run ~40%+ (up to ~70% in worst-case creator reports, 2024–2026). YouTube Shorts applies similar unoriginality demotion. This is the most expensive lazy habit in short-form.
- **Other platforms' watermarks on TikTok:** less publicly documented, but TikTok's unoriginal-content policy demotes obviously recycled video, and an Instagram/CapCut-template watermark is the clearest possible recycled-content fingerprint. Treat it as penalized.
- **Ghost artifacts count:** cropped-but-visible watermark remnants, bouncing-logo blur patches, and platform-specific UI baked into the frame (Reels remix bar, TikTok caption bubbles in a screen recording) all trip detection.

**Clean-master workflow (non-negotiable):**
1. Edit once → export a **clean 9:16 master** with no platform branding.
2. Export per-platform variants (safe zones differ slightly; TikTok bottom-heavy, Reels bottom ~35% + right rail, Shorts bottom ~25%).
3. Upload natively to each platform. Never use "download from TikTok → post to Reels."
4. If a legacy TikTok must be salvaged: re-export from the original project file, or pull the pre-publish draft. Watermark-removal tools (SnapTik etc.) are the last resort — they leave quality loss detection can flag.

---

## 7. Length sweet spots by content type

Two data points to hold simultaneously (both true, as of 2026):
- **Buffer, 1.1M videos:** >60s videos earned **+43.2% reach and +63.8% watch time** vs 30–60s, **+70.3% reach** vs 10–30s, **+95.7% reach** vs 5–10s. Median watch time: 3.1s (5–10s videos) → 6.9s (30–60s) → 11.3s (60s+). Only 12.3% of videos run over a minute — longer video is an under-supplied niche the algorithm rewards because it accumulates raw watch time.
- **Completion still gates distribution:** a 20-second clip at 80% completion beats a 2-minute clip at 20%. Length only helps if retention supports it. Never pad.

| Content type (Mayday examples) | Sweet spot | Why |
|---|---|---|
| Reaction / trend / comedy beat | **15–30s** (TikTok's own entertainment guidance: 21–34s) | Completion + loop potential |
| Story / "one complete thought" podcast clip | **24–45s** | Hook → payoff arc fits; the viral-band range |
| Storytelling / career anecdote ("the night I got called up") | **60–90s** | Deep-dive band; retains if the story earns it |
| Instructional / mechanics breakdown (Trevor May Baseball, Neptune) | **60–180s** | Tutorial band; feeds search + saves |
| Podcast clips with layered context | **60–120s** | Rides the >60s reach premium *if* every 15s re-hooks |

**Editing rule for anything over 60s:** structure in ~15-second re-hook intervals (new angle, new text card, new question) — long TikToks die at their first flat stretch, not at the end.

---

## 8. Cover frames (thumbnails)

Covers don't change FYP scoring, but they control three surfaces: **profile grid, search results, and shares/DMs previews.** Search + grid binge are how a viewer becomes a follower.

Specs and mechanics (as of 2026):
- Cover = a chosen frame from the video (set at upload: "Edit cover") or a designed frame **edited into the first frames of the video** and selected as cover. TikTok has no separate thumbnail upload for organic video — bake designed covers into the file (2–3 frames at the head; invisible at playback speed).
- Design at **1080×1920**, but the profile grid shows a **center-cropped square (~1080×1080)** — top ~420px and bottom ~420px of the cover are invisible on the grid. Put face + title text in the center square.
- TikTok overlays the **first line of your caption across the bottom ~270px** of the cover on the grid. Keep that band empty.
- Convention that works: consistent template per series (same font/color block per franchise — podcast clips vs. mechanics breakdowns vs. facility content get distinct looks), 3–6 word title, high-saturation color, expressive face. Treat search-targeted covers like YouTube thumbnails: bold text, clear subject, high contrast.
- Grid coherence is a conversion asset: a profile-visitor deciding whether to follow scans 9–12 covers in two seconds. Templated covers read as "a show," random frames read as "a feed."

---

## 9. Photo / carousel posts (Photo Mode)

The quiet outperformer of 2025–2026 — TikTok is explicitly boosting carousels on the FYP to drive adoption.

**Specs:**
- **2–35 images**, 9:16 at **1080×1920** (4:5 also works), JPG/PNG, ≤20 MB each (some scheduler APIs cap at 5 MB — export accordingly).
- Music/original audio/voiceover plays across the whole post; viewers swipe manually or let it auto-advance (~3–5s per slide). Per-slide text, stickers, and effects supported.
- Caption limit behaves like video; long (200+ char) keyword captions perform disproportionately well on carousels (~3x views in Socialinsider's data).

**Performance (2025–2026 data):**
- Fanpage Karma, 698K posts: carousels **+81% engagement rate, +82% likes** vs comparable video; video wins raw plays by only ~7%.
- Carousels over-index on **saves and shares** — the loyalty/authority signals — and have longer shelf life than TikTok video's 48–72h window because search and saves keep resurfacing them.

**Playbook:**
1. **5–10 slides** (usable max 35; engagement decays past ~15).
2. **Slide 1 = thumbnail:** big text promise ("6 grips every pitcher should test"), face or striking image. It competes in the same feed as video hooks.
3. One idea per slide, ≤2 lines of text per slide, consistent template.
4. Last slide = CTA (follow / comment prompt / "full video on YouTube").
5. Add trending or fitting audio — carousels with sounds join sound pages just like videos.
6. Mayday use cases: pitch-grip photo series, "5 things I learned in the big leagues" text-forward slides, Neptune facility before/after and program explainers (carousels are exceptionally good local lead-gen because parents save them), podcast quote cards.
7. Cadence: mix 1–2 carousels per week into the video schedule — cheap to produce from existing photo assets and they diversify the account's format signal.

---

## 10. Pre-publish checklist (per post)

1. [ ] 1080×1920, 9:16 full-bleed, H.264 MP4, ≥2 Mbps, ≤60fps
2. [ ] All text/faces/graphics inside safe zone (top 150 / bottom 480 / right 250 / left 60)
3. [ ] Hook text on screen in first 1–3s, upper-middle, ≤10 words, contains keyword
4. [ ] Keyword spoken in first 5 seconds
5. [ ] Burned subtitles chunked 3–7 words, center/upper-middle
6. [ ] Native auto-captions generated AND proofread (names, first 10s timing)
7. [ ] No watermarks or foreign-platform artifacts anywhere in frame
8. [ ] Caption: keyword in first 100 chars, hook + context + question CTA, 3–5 laddered hashtags
9. [ ] Sound attached (library sound or original audio); trending sound if genuinely fitting
10. [ ] Custom cover set: title text in center square, bottom 270px clear, series template
11. [ ] "Upload HD" toggled on; desktop upload for heavily edited files
12. [ ] Location tag on Neptune/facility content
13. [ ] Length sanity check: does every 15s stretch re-hook? Cut anything that doesn't.

---

## Common mistakes

1. **Text in the dead zones.** Hook line behind the caption stack or under the like rail — the #1 avoidable reach killer, invisible in the editor, obvious in feed. Fix with a safe-zone overlay layer in every project template.
2. **Reposting watermarked video across platforms.** 40%+ reach penalty for zero effort saved. Clean master, always.
3. **16:9 podcast frames dropped into a 9:16 canvas with dead bars.** Recompose per clip: punch in on the speaker, stack dual shots vertically, fill the frame.
4. **Trusting raw auto-captions.** Misspelled player names and desynced first-10-seconds text read as low-effort; 2–5 minutes of editing fixes it.
5. **Hashtag spraying (#fyp #viral #foryou + 12 more)** instead of 3–5 laddered tags; and burying the keyword after the caption fold.
6. **Cutting everything to 15s out of habit.** The reach premium moved to 60s+ (as of 2026) — instructional and story content is being left short of its optimal length. Conversely: padding a 20s idea to 70s is worse.
7. **No cover discipline.** Random auto-frames make the profile grid unbrowsable, killing the search-visitor → follower conversion.
8. **Ignoring carousels entirely** because "TikTok is a video app" — conceding the currently-boosted, highest-save format.
9. **HDR uploads with blown-out skin tones** after TikTok's SDR conversion — record or export SDR for talking-head content.
10. **Leaving the CapCut template outro / end-card in the export.**

## Questions Ashley should ask

- "Show me this video in the TikTok app preview — is any text touching the caption stack or the right rail?" (Not in the editor. In the feed.)
- "What's the target keyword, and is it in all three layers — spoken in the first 5 seconds, on screen, and in the first 100 characters of the caption?"
- "What job is this post doing — FYP entertainment, search/evergreen, or Neptune local lead-gen — and does the length match the band for that job?"
- "Is this exported from the clean master, or did someone download it off another platform?"
- "What's the cover, and does it work in the center square of the grid next to the last 8 covers?"
- "Could this be a carousel instead?" (Grip series, list content, before/after → often yes, and cheaper.)
- "Did anyone proofread the auto-captions — are the player names right?"
- "For 60s+ cuts: where are the re-hooks? Point to the beat at 0:15, 0:30, 0:45."
- "Is 'Upload HD' on, and was this uploaded from desktop or a compressed phone transfer?"
- "What % of this account's views came from search last month?" (If <10% on instructional content, the SEO layer isn't being executed.)

## Sources

- Buffer — Longer TikToks Get More Views (1.1M-video study): https://buffer.com/resources/longer-tiktoks-get-more-views-data/
- TikTok Ads — Creative best practices for performance ads (official): https://ads.tiktok.com/help/article/creative-best-practices
- TikTok Newsroom — Introducing auto captions (official): https://newsroom.tiktok.com/en-us/introducing-auto-captions
- Recharm — TikTok Video Ad Specs: The 2026 Safe Zone Guide: https://www.recharm.com/blog/tiktok-video-ad-specs
- Postfast — TikTok Video Size & Aspect Ratio (June 2026): https://postfa.st/sizes/tiktok/video
- HeyOrca — TikTok media specs & best practices (2026): https://www.heyorca.com/blog/tiktok-media-specs-best-practices-2026
- Sked Social — The Ultimate TikTok Video Size Guide for 2026: https://skedsocial.com/blog/tiktok-video-size-guide
- OpusClip — TikTok Caption & Subtitle Best Practices in 2026: https://www.opus.pro/blog/tiktok-caption-subtitle-best-practices
- Outfame — TikTok SEO in 2026: How to Rank in Search: https://www.outfame.com/blog/tiktok-seo-2026-how-to-rank-in-search-keywords-captions-hooks
- Monolit — How Long Should a TikTok Caption Be in 2026: https://monolit.sh/blog/how-long-should-tiktok-caption-be-2026-data-backed-answer-founders
- Socialinsider — How to Use TikTok Carousels For Successful Storytelling: https://www.socialinsider.io/blog/tiktok-carousel/
- Krumzi — How to Make TikTok Carousel Posts (2026, incl. Fanpage Karma 698K-post data): https://www.krumzi.com/blog/how-to-make-tiktok-carousel-posts-a-complete-guide-2026
- MarketerHire — The Right Way to Share TikTok Videos on Instagram: https://marketerhire.com/blog/how-to-share-tiktok-to-instagram
- ALM Corp — Meta's New Original Content Rules (2026): https://almcorp.com/blog/meta-original-content-rules-2026-facebook-instagram-creators/
- Miraflow — TikTok Cover Image Strategy 2026 (profile grid crop mechanics): https://miraflow.ai/blog/tiktok-cover-image-strategy-2026-profile-grid-convert
- SocialMediaToday — Data Shows That Longer Clips Are Gaining Traction on TikTok: https://www.socialmediatoday.com/news/research-tiktok-longer-videos-get-more-reach/742754/
