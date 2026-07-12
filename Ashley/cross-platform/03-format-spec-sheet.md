---
title: Cross-Platform Format Spec Sheet
domain: cross-platform
tags:
  - video-specs
  - safe-zones
  - aspect-ratios
  - caption-limits
  - thumbnails
  - feature-support
  - publish-checklists
sources_reviewed: 16
last_updated: 2026-07-12
---

# Cross-Platform Format Spec Sheet

The definitive spec reference for the six surfaces Mayday publishes to: TikTok, Instagram Reels, YouTube Shorts, Facebook Reels, Facebook video, and YouTube long-form. Everything here is execution-level: exact pixels, exact limits, exact feature availability. Strategy for *what* to repurpose where lives in Carl (see ../../Carl/organic-marketing/04-content-strategy-pillars-repurposing.md); metrics for judging results live in ../../Carl/organic-marketing/12-analytics-experimentation.md.

## TL;DR

- **One vertical master spec covers all four short-form surfaces**: 1080×1920, 9:16, MP4, H.264 + AAC audio, 30fps, 6–10 Mbps. Design to the *Instagram Reels* safe zone (strictest: top 220px, bottom 450px) plus the *TikTok* right rail (140px) and the video works everywhere.
- **Length ceilings as of mid-2026**: Reels record 3 min in-app / upload up to 20 min (but IG says Reels over 3 min are not recommended to new audiences); Shorts = anything square-or-vertical ≤3 min uploaded after Oct 15, 2024; TikTok = 10 min in-app, 60 min via web; Facebook removed reel length limits entirely (June 2025 — all FB video now publishes as a reel).
- **The universal safe zone is roughly the center 4:5** — a 1080×1350 box centered on the 1080×1920 canvas. Anything (text, scoreboard graphics, pitch-grip labels) outside it risks being covered by UI or cropped in feed previews.
- **Never let a platform watermark cross platforms.** Meta downranks watermarked reels officially; creator-reported reach hits run ~40–70%. Always export clean masters from the edit, never re-download from TikTok/IG.
- **YouTube long-form has the most "free" native features and they're all checklist items**: chapters (0:00 + ≥3 ascending timestamps, ≥10s each), custom thumbnail (1280×720, <2MB), end screen (last 5–20s), cards, pinned comment, Test & Compare thumbnail A/B (3 variants), related-video link on Shorts. Skipping any of these leaves distribution on the table.
- **Links are wildly asymmetric across platforms**: FB captions = clickable; YT long descriptions = clickable; Shorts = NO clickable links anywhere (use the related-video feature); IG Reels captions = not clickable (link sticker is Stories-only; up to 5 bio links); TikTok = bio link only.
- **Titles/captions have two limits: the hard cap and the visible cutoff.** YT title cap 100 but Shorts feed shows ~40 chars; IG caption cap 2,200 but feed truncates ~125 chars; TikTok caption cap 4,000 in-app (API-posted content caps at 2,200) but one line shows. Front-load everything.

---

## 1. Master spec table (as of July 2026)

| Spec | TikTok | IG Reels | YT Shorts | FB Reels (= all FB video) | YT Long-form |
|---|---|---|---|---|---|
| Aspect ratio | 9:16 native (1:1, 16:9 accepted but letterboxed) | 9:16 (feed preview crops to 3:4/1:1) | Square or vertical (≤3 min ⇒ classified as Short) | 9:16 recommended; no format restriction since Jun 2025 | 16:9 (up to 8K accepted) |
| Resolution | 1080×1920 (4K downscaled anyway) | 1080×1920 | 1080×1920 | 1080×1920 | 1920×1080 min recommended; 3840×2160 for 4K |
| Min length | 3 sec | ~3 sec | none | ~3 sec | ~1 sec |
| Max length | 10 min in-app record; 60 min web upload | 3 min in-app record; 20 min upload | 3 min (180s) — uploads after Oct 15, 2024 | No limit (Meta removed restrictions Jun 2025) | 12 hr or 256 GB (verified accounts); 15 min unverified |
| Recommended discovery length | 15–34 sec sweet spot | <90 sec; **>3 min not recommended to new audiences** (IG official) | <60 sec for loop rate; ≤3 min allowed | 15–30 sec sweet spot | Whatever retention supports; 8+ min unlocks mid-rolls |
| File size cap | ~72 MB Android app / ~288 MB iOS app / 4 GB web | 4 GB | 256 GB (same pipeline as YT) | 4 GB | 256 GB |
| Container / codec | MP4 or MOV; H.264 + AAC | MP4 (preferred) or MOV; H.264 + AAC | MP4/MOV + most YT formats; H.264 | MP4; H.264 + AAC 48 kHz | MP4/MOV/ProRes/HEVC etc.; H.264 + AAC-LC safest |
| Frame rate | 30fps standard; 60fps for action (pitching, batting cages) | 30fps | Source fps (24–60) | 30fps | Upload at source fps; 24/25/30/48/50/60 |
| Bitrate target | 6–8 Mbps @30fps | 3.5–5 Mbps (compresses hard) | 8–12 Mbps | ~4–8 Mbps | 8 Mbps (1080p 30fps) / 12 Mbps (1080p 60fps) / 35–45 Mbps (4K 30) |
| Caption hard cap | 4,000 chars in-app (2,200 via API/schedulers) | 2,200 chars | Title 100 / description 5,000 | 63,206 chars (practically unlimited; schedulers often cap 5,000) | Title 100 / description 5,000 |
| Visible before truncation | ~1 line | ~125 chars feed; ~1 line on Reel overlay | ~40 chars of title in Shorts feed | ~140 chars mobile | ~60–70 title chars desktop, fewer mobile |
| Cover / thumbnail | Choose frame or upload; text-safe center | Upload 1080×1920; grid crops to 3:4, feed to 1:1 | Frame selection only (no custom upload) | 1080×1080 thumbnail behavior; frame selection | Custom 1280×720 JPG/PNG/GIF, <2 MB, min width 640px |
| Clickable link on the post | No (bio link only) | No (bio links ×5; link sticker Stories-only) | No (related-video link to your own long-form only) | Yes — links in caption are clickable | Yes — description links clickable, plus cards/end screens |

Volatile items are date-stamped in the sections below; re-verify the length ceilings and IG grid crop quarterly — these changed three times in 2024–2026.

---

## 2. Safe zones: UI overlap maps (1080×1920 canvas)

Numbers below are the conservative consensus across safe-zone template publishers (Kreatli, PostPlanify, CampaignSwift, EzUGC) as of 2026. Platforms don't publish exact overlay pixel maps and UI shifts by device, so build to the conservative number.

### Per-platform danger zones

| Edge | TikTok | IG Reels | YT Shorts | FB Reels |
|---|---|---|---|---|
| Top | 130 px (username, search, LIVE tabs) | **220 px** (top bar, camera icon) | 120 px (search/camera/menu) | 210 px (profile pic + page name) |
| Bottom | 250–484 px (caption, sound, marquee — worst case with long caption + comment prompt) | **450 px** (caption, audio, CTA row) | 300 px (title, channel, subscribe, sound) | 290 px (caption + engagement row) |
| Right | **140 px** (avatar, like, comment, share, spinning disc rail) | ~110 px (action rail) | ~120 px (action rail) | ~110 px (action rail) |
| Left | 44–60 px (edge crop across devices) | 35–60 px | ~60 px | ~60 px |

### The universal safe zone (one design, four platforms)

Take the worst case of every edge: **top 220, bottom 450, right 140, left 60**. That leaves a ~880×1250 working area — very close to a centered 4:5 (1080×1350) box, which is also what YouTube's own guidance implies (keep key content within a centered 4:5 so it survives every device).

Working rules:

1. **Hook text**: place in the upper-middle band, 250–600 px from the top. Never in the top 220.
2. **Persistent captions/subtitles**: center-screen or just below center, ending ≥460 px above the bottom. Auto-captioning tools (CapCut, Submagic, Opus) default too low — drag them up.
3. **Nothing meaningful in the right 140 px.** For baseball demo content this matters: a pitch-grip close-up framed right-of-center gets buried under the like/comment rail on TikTok.
4. **Logos/watermarks (your own)**: top-left inside the safe box (x: 60–200, y: 230–350) is the only corner no platform covers.
5. **Design to IG Reels first.** It has the tallest bottom overlay; content clean on IG is clean everywhere (confirmed pattern across template publishers).
6. **Check the end frame**: end-card CTAs ("comment your velo") placed in the bottom 450 px get covered exactly when viewers would read them.

### Feed-preview crops (second crop layer, separate from overlays)

- IG Reels shown in the home feed render at 3:4 (center crop of your 9:16). The Reels tab shows full 9:16.
- IG profile grid crops covers to **3:4 (1080×1440)** since January 2025 (was 1:1 for years — old guides are wrong).
- FB feed previews vertical reels at ~4:5.
- Shorts shelf tiles crop toward the vertical center.

Net: the middle 4:5 is both the overlay-safe zone and the crop-safe zone. One rule, two problems solved.

---

## 3. Covers & thumbnails

### YouTube long-form thumbnail (the only true custom-thumbnail surface)

- 1280×720 px, 16:9, minimum width 640 px, **under 2 MB**, JPG/PNG/GIF/BMP.
- Requires a verified channel (phone verification) — one-time setup.
- Design for the ~168×94 px render on mobile home feed: ≤3–4 words of text, one focal face/object, high contrast. (Packaging strategy: see ../../Carl/organic-marketing/12-analytics-experimentation.md.)
- **Test & Compare** (native A/B): up to 3 thumbnail variants, judged on watch-time share over up to ~2 weeks; only worth running where the video will clear ~1,000+ views in that window.
- Bottom-right corner shows the duration stamp — keep it clear of text.

### YouTube Shorts

- No custom thumbnail upload for new Shorts — you select a frame from the video (mobile app at upload, or Studio). Plan a "thumbnail frame": a 1-second beat early in the video where the composition reads as a poster (subject centered, no mid-blink).
- The selected frame matters mainly for the channel-page Shorts shelf and search results.

### Instagram Reels cover

- Upload a designed cover at **1080×1920** (official minimum 420×654, but it renders soft).
- Triple-crop reality: profile grid shows **3:4** (center 1080×1440, post-Jan-2025), feed thumbnail shows **1:1** (center 1080×1080). Keep title text inside the central 1080×1080 square; avoid the top and bottom ~480 px entirely.
- Covers are re-editable after publish (Edit → Cover) — fixable retroactively when the grid looks broken.

### TikTok cover

- Frame selection + optional text overlay in-app; web upload allows choosing the frame. No separate image upload for organic posts.
- Covers matter mainly on the profile grid (users binge-scroll profiles after one video hits) — put an episode label ("Velo Series Ep. 4") in the center of the chosen frame.

### Facebook Reels

- Thumbnail crops to ~1:1 in most surfaces; frame selection at publish. Same center-square rule as IG.

---

## 4. Text-field limits (hard caps + visible cutoffs, as of 2026)

| Field | Hard cap | Visible before "…more" | Notes |
|---|---|---|---|
| TikTok caption | 4,000 (native app) | ~1 line (~40–60 chars) | **API/scheduler posts cap at 2,200** — relevant because Mayday posts through Metricool. Optimal engagement length 50–150 chars. |
| TikTok bio | 80 | all | One clickable website link (business account or follower threshold). |
| IG caption | 2,200 | ~125 chars (feed) | Hashtags count toward the 2,200. Max 30 hashtags; IG's own guidance is now ≤5. |
| IG bio | 150 | all | Up to 5 bio links. |
| YT title (long + Shorts) | 100 | ~60–70 desktop; **~40 in Shorts feed** | Front-load the payoff word. |
| YT description | 5,000 | ~2–3 lines above the fold | First ~150 chars show in search snippets. |
| YT tags | 500 chars total | n/a | Minor ranking signal; don't overthink. |
| FB caption | 63,206 | ~140 chars mobile | Clickable links allowed — the only short-form surface with them. |
| YT pinned comment | 10,000 | ~4 lines | Free CTA slot on every upload. |

Scheduler caveat: third-party tools (Buffer, Metricool, etc.) enforce their own lower caps (e.g., FB 5,000 via Buffer). When a caption "won't save," check the tool's cap before blaming the platform.

---

## 5. Feature-support matrix (as of July 2026)

| Feature | TikTok | IG Reels | YT Shorts | FB Reels | YT Long |
|---|---|---|---|---|---|
| Chapters | — | — | — | — | ✅ (0:00 + ≥3 timestamps, ascending, each ≥10s, in description) |
| Clickable caption/description links | ❌ | ❌ | ❌ (removed Aug 2023) | ✅ | ✅ |
| Link to your own video | — | — | ✅ Related-video link (1 long-form video; requires advanced feature access; **set on desktop Studio only**) | — | ✅ Cards + end screens (last 5–20s) |
| Link sticker | ❌ | Stories only | ❌ | Stories only | — |
| Pinned comment | ✅ (up to 3) | ✅ (up to 3) | ✅ (1) | ✅ | ✅ (1) |
| Polls / interactive stickers on the video | ✅ (poll, Q&A stickers) | ❌ on Reels (Stories only) | ❌ (polls live in Community tab) | ❌ | ❌ (Community tab polls) |
| Duet / Stitch / Remix | ✅ Duet + Stitch (toggleable) | ✅ Remix (toggleable) | ✅ Remix (toggleable) | limited | ✅ can be remixed into Shorts (toggleable) |
| Collab post (shared to both audiences) | ❌ (branded-content tag only) | ✅ Collab — up to 5 co-authors, appears on all profiles | ❌ | ✅ (via IG crosspost/collab) | ❌ |
| Native scheduling | ✅ web, up to 10 days out | ✅ in-app up to 75 days; Meta Business Suite further | ✅ Studio, unlimited horizon | ✅ Meta Business Suite | ✅ Studio + Premieres |
| Auto-captions | ✅ | ✅ | ✅ | ✅ | ✅ + full subtitle editor |
| Shopping/product tags | ✅ TikTok Shop | ✅ IG Shopping | ✅ YT Shopping (eligibility) | ✅ | ✅ YT Shopping |
| Crosspost IG→FB automatic | — | ✅ (toggle: share Reels to Facebook) | — | receives | — |
| A/B packaging test | ❌ | ❌ (Trial Reels = non-follower test, different tool) | ❌ | ❌ | ✅ Test & Compare (3 thumbnails) |
| Custom thumbnail upload | ❌ (frame + text) | ✅ (1080×1920 cover) | ❌ (frame only) | ❌ (frame) | ✅ (1280×720, <2MB) |

Notable 2024–2026 feature changes worth remembering:

- **Shorts related-video link** replaced clickable Shorts links (Aug 2023). It renders as a persistent chip on the Short — the single best Shorts→long-form funnel mechanic, and it must be set per-Short in desktop Studio.
- **IG Trial Reels** (2025): publishes a Reel to non-followers only as a test; convert to full publish if it performs. Use for risky hooks before burning them on the main audience.
- **FB video/Reels merge** (announced June 17, 2025; global rollout through late 2025): all new FB video publishes as a reel, no length/format restrictions, Video tab renamed Reels tab. Practical effect: "Facebook video specs" and "FB Reels specs" are now the same sheet; horizontal 16:9 uploads still work and display in feed, but the vertical 9:16 master is the default deliverable.
- **Shorts 3-minute expansion** (uploads on/after Oct 15, 2024; Official Artist Channels Dec 8, 2025). Classification is mechanical: square-or-vertical AND ≤180s ⇒ Short. **A 2-minute vertical podcast clip intended as long-form will be forced into the Shorts feed** — export 16:9 if you want long-form treatment. Content ID caveat: Shorts >1 min with an active Content ID claim get blocked entirely; most licensed audio caps at 90s of use inside a 3-min Short.

---

## 6. Per-platform pre-publish checklists

### TikTok
1. 1080×1920, H.264 MP4, ≤287 MB (post from iOS or web, not Android, for big files).
2. Text inside safe box (top 130 / bottom 480 / right 140 clear).
3. Caption: hook line first (~50–150 chars), 3–5 hashtags (mix one broad + niche: #baseball + #pitchingmechanics), keyword-rich for TikTok search.
4. Choose cover frame + cover text (profile-grid legibility).
5. Toggle Duet/Stitch ON (baseball reaction/analysis content gets stitched — free reach).
6. Add to a playlist/series if part of one.
7. Tag location if facility-relevant (Neptune local discovery).
8. Pin a comment with the CTA that would've been a link ("full breakdown on the More Mayday channel").

### Instagram Reels
1. Same vertical master, re-exported clean (no TikTok watermark, ever).
2. Upload custom cover 1080×1920; verify grid (3:4) and feed (1:1) crops in preview.
3. Caption: first 125 chars carry the hook; ≤5 hashtags; @mention collaborators.
4. **Collab invite** if a guest/partner is in it (doubles surface area for zero cost).
5. Toggle "Share to Facebook" ON (feeds the FB Reels surface for free).
6. Keep it ≤3 min or accept no new-audience recommendation (IG official, as of 2026).
7. Topic tags (Reels topic picker) set.
8. Consider a Trial Reel for unproven hook formats.

### YouTube Shorts
1. Vertical, ≤3 min; confirm it *should* be a Short (if not, export 16:9).
2. Title ≤100 chars with payoff in first 40.
3. **Set the related-video link** (desktop Studio) to the parent long-form video — this is the whole funnel.
4. Select thumbnail frame for channel-shelf legibility.
5. Licensed music: confirm ≤90s usage / no Content ID block if Short >1 min.
6. Pinned comment with question prompt (comment velocity is a breakout tell — see Carl 12).
7. Add to the channel's relevant playlist for shelf grouping.

### Facebook Reels / video (post-merge, 2026)
1. Vertical master by default; long horizontal content (full podcast episodes) uploads fine and displays 16:9 in feed — both are "reels" now.
2. Caption WITH clickable link — the only short-form surface where "link in caption" works; use it (Substack, podcast, Neptune signup).
3. Crossposted-from-IG reels need no extra work, but native uploads let you customize the caption/link — prefer native for anything with a CTA.
4. Tag location for Neptune-adjacent content; FB local/group distribution is real for facility marketing.

### YouTube long-form
1. 16:9, upload at source resolution/fps (4K master if available — YT gives 4K uploads the VP9 codec earlier, which looks better even at 1080p playback).
2. Title ≤100 (aim 50–70), thumbnail 1280×720 <2MB, run Test & Compare with 3 variants when the concept is uncertain.
3. Description: first 150 chars = search snippet + hook; links to Substack/podcast/socials; then **chapters** (0:00 + ≥3 ascending timestamps, ≥10s each — malformed lists silently fail).
4. End screen on last 5–20s (video + subscribe elements); 2–4 info cards at retention dips.
5. Pinned comment (question or link block).
6. Cut list marked in the edit: 2–4 Shorts candidates per episode, each with its related-video link back (pipeline mechanics: see ../../Carl/organic-marketing/04-content-strategy-pillars-repurposing.md).
7. Schedule or Premiere; verify monetization checks (yellow icon) before publish time, not after.

---

## 7. One-master export workflow

The efficient pipeline for a small team:

1. **Shoot/frame for 4:5.** Compose every A-camera shot so the action lives in the vertical center — a 16:9 frame whose subject sits center-frame crops cleanly to 9:16 later.
2. **One vertical master export**: 1080×1920, H.264 High profile, 8–10 Mbps VBR 2-pass, AAC 320 kbps 48 kHz, 30fps (60fps only for high-motion demo content). This single file uploads natively everywhere.
3. **Burn subtitles inside the universal safe box** (see §2) once; no per-platform re-caption.
4. **Never re-download from a platform to repost.** Meta officially recommends watermarked reels less; creator-side measurements report reach cuts of roughly 40% for visibly recycled content and up to ~70% when watermark remnants are detected (directional numbers, not official). Watermark-remover tools re-compress and leave artifacts that trip the same originality detection. Archive clean exports in Drive at edit time.
5. **Per-platform deltas are metadata only**: caption, hashtags, cover, links, toggles — 5 minutes per platform, not a re-edit.
6. Platform benchmarks for expectation-setting (Metricool, 5M+ videos, 2024–25 dataset): avg views TikTok ~18.2k > IG Reels ~16.2k > FB Reels ~8.6k > Shorts ~647; engagement ratio Shorts 5.91 > TikTok 5.75 > IG Reels 5.53 > FB Reels 2.07. Translation: the same clip "failing" on Shorts at 500 views is normal; judge each surface against its own baseline (see Carl 12 on outlier multipliers).

---

## 8. Common mistakes

- **Captions burned in the bottom third.** The #1 spec error. Auto-caption defaults sit inside IG's 450px dead zone. Everything below y≈1470 on a 1920 canvas is at risk.
- **Reposting with a TikTok watermark** (or IG watermark to TikTok). Officially downranked on Meta; kills the video before it starts.
- **Uploading a 2-minute vertical clip to YouTube expecting long-form treatment.** Square/vertical ≤3 min = Short, period (post-Oct 2024). Export 16:9 to stay long-form.
- **Chapters that silently fail**: missing 0:00, only two timestamps, out-of-order times, or a chapter under 10 seconds. YouTube gives no error — the chapters just don't render.
- **Treating the 20-minute Reels upload cap as permission.** IG states Reels over 3 minutes are not recommended to new audiences (as of 2026) — long uploads are for existing followers only.
- **Designing covers to old IG grid specs.** The grid went 3:4 in January 2025; 1:1-designed covers now crop heads off.
- **Putting the CTA where a link can't exist**: "link in description" on a Short (no clickable links), "link in caption" on TikTok/IG (not clickable). Match the CTA to the surface: FB = caption link; Shorts = related video; IG = "link in bio" or Stories sticker; TikTok = bio.
- **Scheduling TikToks through the API with a 3,000-char caption** — the API caps at 2,200; the post fails or truncates. Keep scheduled captions ≤2,200 everywhere for safety.
- **Uploading big files from Android TikTok** (~72 MB cap ⇒ crushed quality). Use web upload (4 GB).
- **Ignoring the right rail on demo content.** Grips, hand positions, and overlay stats framed right-of-center disappear under the action buttons.
- **One caption pasted across all platforms** — hashtag conventions, visible-length cutoffs, and link behavior all differ (strategy level: see ../../Carl/organic-marketing/04-content-strategy-pillars-repurposing.md).

## 9. Questions Ashley should ask

1. "Where do your burned-in captions sit on the 1920 canvas — are they above y≈1470?" (Instant audit of the most common error.)
2. "Are you exporting clean masters from the edit, or downloading from TikTok to repost?" (Watermark penalty check.)
3. "Is the related-video link set on every Short cut from this episode?" (The Shorts→long funnel is a per-video manual desktop step; it gets skipped.)
4. "Did this vertical clip *mean* to be a Short? It's under 3 minutes — YouTube will classify it as one."
5. "What does the cover look like in the IG 3:4 grid crop and the 1:1 feed crop — did you check both previews?"
6. "Which surface carries the clickable CTA for this campaign, and does every other surface's CTA route there correctly?"
7. "Are you posting this through Metricool? Then is the TikTok caption under 2,200 characters?"
8. "For the licensed music in this 2-minute Short — is the track cleared past 90 seconds, or will Content ID block it?"
9. "What's the thumbnail frame for the Short / cover frame for the TikTok — was one planned in the edit, or are we picking the least-bad blurry frame?"
10. "When did we last re-verify this sheet's length ceilings and grid crops?" (Specs changed at least five times across platforms in 2024–2026; re-check quarterly.)

---

## Sources

- YouTube Help — Understand three-minute YouTube Shorts: https://support.google.com/youtube/answer/15424877
- YouTube Help — Video Chapters: https://support.google.com/youtube/answer/9884579
- YouTube Help — Add a related video to your YouTube Shorts: https://support.google.com/youtube/answer/14075157
- Meta Newsroom — Making it Easier to Create Videos on Facebook (June 2025 video/reels merge): https://about.fb.com/news/2025/06/making-it-easier-create-videos-facebook/
- TechCrunch — Facebook announces all videos will be shared as reels: https://techcrunch.com/2025/06/17/facebook-announces-that-all-videos-on-its-platform-will-soon-be-shared-as-reels/
- Metricool — Short-Form Video Study (5M+ videos, cross-platform benchmarks): https://metricool.com/short-form-video-study/
- Kreatli — Safe Zone Hub 2026 (Reels/TikTok/Shorts overlay maps): https://kreatli.com/guides/safe-zone-guide
- PostFast — TikTok Video Size & Specs (verified June 2026): https://postfa.st/sizes/tiktok/video
- Somake — Instagram Reel Size Guide 2026 (cover crops, safe zones, duration): https://www.somake.ai/blog/instagram-reel-size-guide
- SendShort — Facebook Reels Dimensions & Size Guide: https://sendshort.ai/guides/facebook-reels-size/
- Boomp — Social media caption/character limits 2026 (scheduler vs native caps): https://boomp.net/resources/questions/social-media-caption-character-limits-2026
- vidIQ — YouTube "Related Links" connecting Shorts and long-form: https://vidiq.com/blog/post/youtube-related-links-connect-shorts-long-videos/
- SocialKit — Does the TikTok watermark hurt your reach: https://socialk.it/en/blog/tiktok-watermark-reach-guide
- Wordcountr — TikTok character limits (4,000 caption vs 2,200 API): https://wordcountr.app/blog/tiktok-character-limit
- CampaignSwift — Instagram safe zone sizes 2026: https://campaignswift.com/blog/instagram-safe-zone-sizes
- BIGVU — YouTube video size/bitrate guide 2026: https://bigvu.tv/blog/youtube-video-size/
