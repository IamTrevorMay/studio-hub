---
title: "Post-Production Workflows & Media Asset Management"
domain: media-operations
tags: [post-production, editorial-pipeline, media-asset-management, review-approval, proxy-workflow, naming-conventions, archive-strategy, editor-throughput]
sources_reviewed: 14
last_updated: 2026-07-12
---

# Post-Production Workflows & Media Asset Management

## TL;DR

- **Naming conventions and folder structure are decided BEFORE the first frame is shot, not after.** Every recovery project ("let's finally organize the drive") costs 10–50x what up-front discipline would have. Standard pattern: `YYYYMMDD_project_descriptor_vNN` — date-first, no spaces, zero-padded versions.
- **Picture lock is a real gate, not a vibe.** The single biggest post-production cost driver is editorial changes after downstream work (color, sound, graphics) has started. Enforce a formal picture-lock sign-off before finishing begins.
- **Cap review rounds contractually and structurally.** Two consolidated rounds is the professional standard. Uncapped, unconsolidated feedback (email + Slack + text) is the #1 schedule killer. Centralized frame-accurate review (Frame.io-style) cut VMware's tracking time ~60% and revisions ~20%.
- **Use editing-friendly proxy codecs, never H.264/H.265.** Long-GOP codecs are cheap to store but expensive to scrub. ProRes Proxy / DNxHR LB proxies give smooth timelines on laptops and enable remote editors on normal internet.
- **A creator team's benchmark: 30–60 min of edit time per finished minute for standard content; 1–2 hrs/min for heavily-stylized YouTube edits.** 24–72h turnaround is the professional agency standard. Use these to size editor headcount, not gut feel.
- **Buy a MAM by bottleneck, not by feature list.** Frame.io = review loop. iconik/Shade = searchable library. CatDV = automation. Most sub-10-person teams need disciplined folders + a review tool first, a true MAM only when "can't find the clip" costs real hours weekly.
- **Archive on a 3-2-1 pattern; cold data belongs on LTO or deep-archive cloud.** At scale LTO is 50–100x cheaper than hot cloud (~$4.72/TB one-time on LTO-9 vs $23/TB/month S3 Standard). For <50TB/yr, Backblaze/Wasabi ($6–7/TB/mo) or Glacier Deep Archive ($0.99/TB/mo) beat owning a tape library.
- **Metadata is only as good as the person entering it.** Simple, mandatory, enforced-at-ingest beats elaborate, optional, retrofitted. Every failed MAM/DAM post-mortem traces to taxonomy over-design plus adoption under-investment.

---

## 1. The Post-Production Pipeline (Canonical Model)

The full pipeline, from set to delivery. Small creator teams collapse several stages into one person, but the *gates* between stages still matter — they're where errors get caught cheaply.

### 1.1 Stages and gates

| # | Stage | Who | Output / Gate |
|---|-------|-----|---------------|
| 1 | **Ingest / data management** | DIT / data wrangler (or the shooter) | Footage verified, checksummed, backed up 3x, named, logged |
| 2 | **Dailies / selects** | Assistant editor | Synced audio, organized bins, "circle takes" flagged |
| 3 | **Stringout → assembly** | Editor | Chronological dump of usable footage → first structural pass |
| 4 | **Rough cut** | Editor + director/creator | Story works; temp music/SFX; placeholder graphics |
| 5 | **Fine cut** | Editor | Pacing, rhythm, transitions dialed; near-final elements |
| 6 | **Picture lock** | Producer/creator sign-off | **HARD GATE.** No further editorial changes |
| 7 | **Conform / online** | Editor or finisher | Relink proxies to full-res originals |
| 8 | **Color** | Colorist | Correction (consistency) then grading (look) |
| 9 | **Sound** | Sound editor/mixer | Spotting → edit → pre-dub → final mix |
| 10 | **VFX / graphics** | Motion designer | Starts from rough cut with placeholders; finals after lock |
| 11 | **QC + delivery** | Post supervisor | Multi-format masters, captions, platform variants, delivery note |
| 12 | **Archive** | Whoever owns storage | Project consolidated, trimmed, cold-stored, indexed |

Key discipline points from practitioner sources (MASV workflow guide):

- **Ingest is a real job.** Verify card contents against a shot log, checksum-copy (never drag-and-drop for masters), and get to three copies before any card is formatted. "Schofield's Second Law": data doesn't exist unless it's in at least two (post shops say three) places.
- **VFX and graphics start from the rough cut, not picture lock** — but only on shots unlikely to change. Everything else waits for lock.
- **Handoffs travel with documentation**: EDL/XML/AAF plus a fix list. A handoff without a manifest is a support ticket waiting to happen.
- **Delivery is multi-format by default now**: 16:9 master plus 9:16 / 1:1 / 4:5 social crops, captions/subtitles, thumbnail assets. Budget delivery as its own stage (often 10–20% of edit time), not an afterthought.

### 1.2 Why the picture-lock gate matters economically

Every change after lock ripples: color has to re-conform, the mix has to re-lay, graphics re-render, captions re-time. On a broadcast job a post-lock change can cost 5–10x the same change made in rough cut. On a YouTube team the analog is: "creator watches the 'final' and re-cuts the intro" — same tax, smaller scale. The fix is procedural, not technical: an explicit sign-off ("this version is locked; changes from here cost a day each") and versioned exports so everyone knows which cut is which.

For always-on content teams, a soft version works: **rough cut review → one consolidated revision round → lock → finish (thumbnail, color pass, mix, captions) → publish.** The creator's approval on the revision round *is* picture lock.

---

## 2. Review & Approval Loops

This is the highest-leverage process in all of post. Most schedule slippage in creative work is not editing time — it's waiting for feedback, decoding feedback, and re-doing work because feedback arrived late or contradicted itself.

### 2.1 The rules of a functional review loop

1. **One channel.** All feedback lands in one frame-accurate tool (Frame.io, Vimeo Review, Wipster, Ziflow, Dropbox Replay, or even a shared doc with timecodes). Feedback via text message/DM gets transcribed into the channel by the producer or it doesn't exist.
2. **Consolidated, not streaming.** Stakeholders review the *same version* within a defined window; one person (producer role) merges conflicts into a single change list before the editor touches the timeline. Editors should never adjudicate contradictory notes.
3. **Round-limited.** Two rounds is the industry-standard contract term (round 1 = structural, round 2 = polish). Additional rounds are explicitly scoped/billed. Internally, treat a third round as a signal the brief was wrong, and fix the brief.
4. **Timeboxed.** "Feedback within 24/48h or the cut is approved by default" is a legitimate and common policy for recurring content. Silence must not stall the pipeline.
5. **Frame-accurate.** "Around the middle, the part with the music" costs a re-watch; "01:42:13 — cut this beat" costs nothing. Frame-accurate commenting is the entire value proposition of review tools.
6. **Versions are compared, not remembered.** Side-by-side version comparison ends the "I liked the old one better… I think" loop.

### 2.2 What centralizing review is worth (numbers)

Frame.io's VMware case study (24 in-house creatives, ~400 concurrent project requests, ~2,000 internal stakeholders):

- **~60% reduction in time spent tracking review logistics** (chasing approvals, finding the right version, status pings)
- **~20% reduction in revision rounds**
- **Tens of thousands of dollars/year saved**; ~1,000 assets produced for one flagship event
- Architecture: Workfront for intake/brief ("the creative brief and roadmap"), Frame.io for review, Camera-to-Cloud for same-day event turnaround, reusable asset libraries across regions

Directionally, expect a small team switching from email/drive-link review to a dedicated review tool to recover 2–5 hours per editor per week and shave one full calendar day off typical turnaround.

### 2.3 Approval workflow template (recurring content team)

```
V1 (rough)   → creator/producer only. Structural notes. 24h window.
V2 (fine)    → creator + any sponsor/legal check. Polish notes. 24h window.
V3 (final)   → approval-only pass. Any note here = new scoped task, not a revision.
LOCKED       → finishing + delivery. Editor exports platform variants.
```

Sponsor-integrated videos add a gate: **sponsor segment approved in isolation** (send the ad-read section as its own clip) *before* V2, so sponsor notes never force a re-cut of the whole video.

---

## 3. Versioning Discipline

- **Zero-padded version numbers**: `v01, v02 … v10` (not `v1 … v10` — sorts wrong; not `final`, `final2`, `FINALfinal` — the classic failure).
- **Version = a cut shown to someone.** Internal editor saves are autosave/snapshots, not versions. Don't burn version numbers on private WIP.
- **Never overwrite a reviewed version.** Every version that received comments must remain retrievable — comments reference timecodes in *that* file.
- **One current version, clearly marked.** In review tools, version-stack uploads so V3 supersedes V2 in the same thread; in folders, keep only the newest export at the top level and push priors to `_old/`.
- **Project-file versioning mirrors export versioning**: `Project_v03.prproj` produced `Project_v03.mp4`. When a bug surfaces ("v02 had the right music"), you can reopen the matching timeline instantly.
- **Locked = renamed.** On lock, export gains a `_LOCKED` or `_MASTER` token. Platform derivatives inherit it: `..._MASTER_16x9`, `..._MASTER_9x16`.

---

## 4. Naming Conventions & Folder Structure

### 4.1 File naming rules (composite of Frame.io Workflow Guide, MASV, Avid, DockBuddy)

1. **Agree before the project starts**; write it down; everyone uses it identically. A naming convention that lives in one editor's head is not a convention.
2. **Date-first, ISO order**: `YYYYMMDD` or `YYYY-MM-DD` so alphabetical = chronological.
3. **Alphanumerics, underscores, hyphens only.** No spaces, no `#%&{}<>?/\$!'":@+`=|` — they break scripts, URLs, and cross-platform transfers.
4. **Under ~255 characters total path**, and practically much shorter; every element must earn its place.
5. **Unique** — a filename should never be reusable for a different file (dates + counters guarantee this).
6. **Self-describing** — someone should know what the file is without opening it.

**Frame.io reference pattern (source footage):**
`20181004-wfg-filenaming-camA-01-001-4k30.mov`
= date – project code – scene/subject – camera – shot – take – resolution/framerate.

Variants: narrative (`...-camB-roll03-shot05-take002-4k30.mov`), broadcast/series (`...-s02-ep04-bts-1080p60.mov` — season/episode/content-type).

**Deliverable pattern (MASV):** `ProjectName_Version_Platform_AspectRatio.ext` → `BrandLaunch_v04_YouTube_16x9.mp4`.

**Creator-team practical pattern:**
```
Source:      YYYYMMDD_show_epNNN_camA_001.mov
Project:     epNNN_title-slug_vNN.prproj
Export:      epNNN_title-slug_vNN.mp4
Master:      epNNN_title-slug_MASTER_16x9.mp4
Short:       epNNN_shortNN_hook-slug_9x16_vNN.mp4
Thumbnail:   epNNN_thumb_vNN.psd / .png
```

### 4.2 Folder structure (numbered, 3–4 levels max)

The professional-standard template (DockBuddy; matches what most post houses run):

```
YYYY-MM-DD_Client_Project/          (or epNNN_title-slug/)
├── 01_Assets/
│   ├── Video/        (A-Roll, B-Roll, Drone, Screen-rec)
│   ├── Audio/        (VO, Music, SFX)
│   ├── Graphics/     (logos, lower thirds, thumbnail elements)
│   └── Docs_Refs/    (script, brief, reference links)
├── 02_Project/       (NLE project files, versioned)
├── 03_Exports/
│   ├── Review/       (vNN review exports)
│   ├── Final/        (MASTER + platform variants)
│   └── Social/       (shorts, clips)
├── 04_Documents/     (contracts, sponsor copy, delivery notes)
└── 05_Archive/       (retired versions, unused selects)
```

Rules that make it stick:

- **Sequential numbering on top-level folders** so they sort in workflow order, and so muscle memory works across every project.
- **Template it.** One canonical empty structure duplicated per project (Post Haste is the classic free tool; a shell script works). If creating the structure takes more than one action, people will freestyle.
- **Deliverables live apart from working files**, with a README/delivery note listing each file, platform, resolution, codec, duration (MASV recommendation). This is what saves you when a sponsor asks for "the file" eight months later.
- **The structure guides placement, not just retrieval**: it should be obvious where a *new* file goes, or entropy wins (Frame.io guide's core test).
- **Depth ≤ 3–4 levels.** Deeper hierarchies get bypassed, and bypassed structure is worse than no structure.

---

## 5. Proxy Workflows & Cloud Collaboration

### 5.1 Why proxies

Camera originals (4K/6K H.265, RAW, 10-bit 4:2:2) are hostile to timelines: Long-GOP inter-frame codecs make every scrub a decode party, and file sizes make cloud sync impractical. Proxies are small, intraframe (every frame self-contained), and shareable — they let a remote editor on a laptop cut a 4K multicam project over home internet.

- **Never use H.264/H.265 as the proxy codec** (ELEMENTS, Frame.io guides are unanimous): the Long-GOP structure defeats the purpose. Use **ProRes 422 Proxy** or **DNxHR LB** — intraframe, "visually lossless" at proxy tier, cheap to decode.
- Typical proxy size: 960×540 or 1280×720 ProRes Proxy runs roughly 5–15% of the size of high-bitrate camera originals — the difference between an overnight upload and a 20-minute one.
- **Resolve**: prefer Proxy Media over "Optimized Media" for team workflows — proxies keep human-readable filenames and are portable; optimized media is a proprietary local cache (.dvcc). Generate via the Proxy Generator app; toggle Playback → "Prefer Proxies"; "Relink Proxy Media" handles externally-generated proxies.
- **Premiere**: ingest-time proxy creation via Media Encoder (Media Browser → Ingest); the proxy toggle button switches offline/online instantly — the "offline edit → online conform" of film tradition collapsed into one button.
- **Offline/online vocabulary** still matters at handoffs: the *offline* is the creative cut on proxies; the *online/conform* relinks camera originals for finishing. If color/finishing is outsourced, they will ask for an XML/AAF + camera originals — proxy hygiene determines whether relinking takes minutes or days.

### 5.2 Camera-to-Cloud (C2C) and the 2024–2026 direction

- **C2C** (Frame.io + FUJIFILM/RED/Atomos etc., now including photos): camera uploads proxies to the cloud as it records; editors can start cutting *while the shoot is still running*. VMware used it for same-day event recap videos. For a creator team, the equivalent low-rent version: shoot → auto-upload proxies from an SSD/phone to shared cloud before the shooter leaves the location.
- **Cloud project collaboration** matured: Blackmagic Cloud (multi-editor simultaneous Resolve projects), Adobe Team Projects, Avid Everywhere. Multiple editors in one project is now a solved problem *if* media management is disciplined (shared proxy set, consistent relative paths).
- **AI arrives at ingest**: auto-transcription, speech-to-text search, scene detection, auto-tagging (Wasabi AiR, iconik AI segments, Shade). Transcription is the single highest-value AI feature for talking-head/creator content — it converts every hour of footage into searchable text and makes selects/clipping dramatically faster. In 2025+ treat transcription-at-ingest as table stakes.

---

## 6. MAM / DAM Systems

### 6.1 Definitions (iconik framework)

- **DAM** — single source of truth for *approved, finished* brand assets (images, logos, docs, final videos). Audience: marketing/sales/partners. Hot cloud storage. Strengths: brand governance, rights/usage tracking, distribution portals.
- **MAM** — manages *rich media through production*: multi-TB raw video, proxies, camera-card structures, timecode-aware metadata, NLE integrations (Premiere/Resolve/Avid), tiered storage (hot → cold → tape). Audience: editors and media ops. Lifecycle: ingest → edit → review → deliver → archive.
- The 2025+ reality: the categories are merging; unified platforms (iconik et al.) do both, and the differentiator is metadata/AI depth, not the acronym. iconik's framing: the question is no longer "DAM or MAM" but "how smart is my media management."

### 6.2 The landscape by architectural bet (Shade's 11-category map — the most useful mental model)

| Bottleneck you actually have | Tool category | Representative products | Price signal |
|---|---|---|---|
| Review/approval chaos | Creative review | **Frame.io** | Free–$25/user/mo |
| "Can't find anything" across storage | Cloud-native library | **iconik**, Backlight | $9–120/user/mo tiered |
| Repetitive pipeline steps | Workflow automation | **CatDV** (Quantum) | Quote |
| Low-bandwidth remote editing | Proxy streaming | IPV Curator | Quote |
| On-prem facility with shared storage | Facility-grade | EditShare FLOW | Quote |
| Adobe version sprawl | Version-control MAM | Evolphin Zoom | Quote |
| Cheap search over existing drives | AI search | **Axle AI** | $20/TB/mo or $2,995 perpetual |
| Storage + search + review in one, small team | Production infrastructure | **Shade** | from $20/mo |
| Broadcast scale, 24/7 | Enterprise MAM | Dalet | Quote |
| Custom programmable pipelines | API-first | Cantemo Portal | Quote |

Key insight from the comparison: **Frame.io is project-centric (the edit-and-approve loop), not a persistent library** — teams that buy it as a MAM end up with an expensive graveyard of old projects. iconik is library-centric with segment-level (in/out timecode) AI metadata — the strongest queryable architecture for "find me every clip where X happens."

Documented results from MAM adoption (vendor case studies — treat as best-case): 90% reduction in manual tagging time, 10x faster search, 35% faster project completion, 15% lower operational overhead (Shade); the honest generic expectation is "hours of searching per week become minutes."

### 6.3 When a small team actually needs a MAM

Staged maturity model:

1. **Stage 0 (1–3 people):** Disciplined folders + naming + a template. Cloud drive or NAS. Free/cheap review link tool. *A MAM here is over-tooling.*
2. **Stage 1 (3–8 people, recurring output):** Add a dedicated review tool with version stacking; add transcription-at-ingest; add a NAS or mountable cloud storage with the folder template enforced.
3. **Stage 2 (trigger conditions):** Buy a real MAM when ≥2 of: (a) people spend >2–3 hrs/week hunting for clips; (b) reuse of archive footage is a revenue activity (compilations, sponsor recuts, licensing); (c) >~50–100TB across drives nobody fully indexes; (d) multiple editors duplicate-download the same media; (e) rights/usage mistakes have happened.
4. **Stage 3 (facility/broadcast):** Automation-grade MAM + tiered storage + tape robot. Not relevant below ~20 media staff.

### 6.4 MAM implementation playbook (Evolphin best practices + failure post-mortems)

1. **Write down the business problem and success metrics first** (hours-searching, time-to-publish, reuse rate). "We need a DAM" is not a problem statement — strategy-free purchases are the #1 documented failure cause.
2. **Audit before migrating**: volumes, codecs, duplicates, corrupt files, rights status. Garbage migrated is garbage indexed.
3. **Document current workflows (swim-lane diagrams)** so the tool maps to reality, not the demo.
4. **Design the metadata schema small**: 5–10 mandatory fields max (project, date, people/talent, location, content type, rights/usage, status). Every optional field is a field that will be empty. Over-complicated taxonomies are the most-cited metadata failure.
5. **Enforce at ingest**: metadata entry is part of the upload action, not a later cleanup sprint that never happens. Let AI pre-fill (transcription, tags) and humans correct.
6. **Roll out incrementally to enthusiastic users first**; they become the internal sales force. Big-bang deployments to skeptics fail.
7. **Assign an owner.** A librarian-role (even at 10% of someone's job) is the difference between a library and a landfill.
8. **Report wins to leadership** (assets ingested, search-time saved) — MAMs die quietly when nobody demonstrates ROI.

Failure modes with disastrous documented outcomes: no user buy-in, all-at-once deployment, no training, tech-capability/business-goal mismatch, no ROI measurement → "abysmal adoption, missed deadlines, negative ROI." Also: version chaos (multiple versions circulating with no clear owner) and duplicated storage silos.

---

## 7. Archive & Backup Strategy

### 7.1 The rules

- **3-2-1**: 3 copies, 2 media types, 1 offsite. Enhanced **3-2-1-1**: +1 air-gapped copy (ransomware can't encrypt a tape on a shelf).
- **Active projects ≠ archive.** Working storage is fast and expensive; archive is slow and cheap. Move projects to archive on a schedule (e.g., 60–90 days after delivery), don't let them squat on the NAS.
- **Archive = consolidate + trim + index.** Before archiving: collect media into the project folder (Premiere Project Manager / Resolve media management), decide policy on unused raw (keep circle takes + selects + masters; many teams drop never-logged B-roll), write a manifest (what's in it, where the master is, codecs, rights notes). An archive you can't search is a liability with a power bill.
- **Test restores.** An untested backup is a hope, not a backup. Quarterly: pull a random archived project and verify it opens.

### 7.2 LTO vs cloud — the actual numbers (Archiware 2025 analysis + Backblaze)

| Option | Cost | Notes |
|---|---|---|
| LTO-9 tape | ~$85/tape, 18TB native → **~$4.72/TB one-time** | Write everything twice (2 tapes); drives $5k standalone / $15k library; ~$3.7k/yr maintenance at library scale; LTO-10 shipping now |
| S3 Standard | $23/TB/**month** | Hot; egress fees |
| S3 Glacier Flexible | $3.60/TB/mo | Retrieval fees + delay |
| **S3 Glacier Deep Archive** | **$0.99/TB/mo** | ~$20+/TB egress; hours–days retrieval |
| Wasabi | $6.99/TB/mo | Free egress, 90-day min retention |
| Backblaze B2 | $6.00/TB/mo | Free egress up to 3x stored |

Break-even logic (Archiware's 10-year scenarios):

- **200TB+/year archived:** LTO library beats every cloud option except Glacier Deep Archive on raw cost.
- **50–100TB/year:** standalone LTO drive is cheapest; Backblaze/Wasabi are competitive once you count the drive, tapes-times-two, and the human who runs it.
- **≤10TB/year:** cloud wins outright; a tape library is capex theater. (Backblaze's broader point: honest LTO math must include labor, offsite rotation, drive refresh every generation or two, and migration when a generation ages out — tape readers only read back ~2 generations.)
- Video compresses ~0% on tape (already compressed), so media shops must budget *native* capacity — effectively doubling tape counts vs. vendor "compressed" capacity claims.

**Recommended pattern for a creator-scale team (≤~30TB/yr new media):** working NAS (RAID is uptime, not backup) + continuous cloud backup of working set (Backblaze) + per-project cold archive to Glacier Deep Archive or a pair of rotated offline HDDs, masters additionally kept hot (they're small and get reused). Revisit LTO only if annual archive volume passes ~50TB or a facility/insurance requirement appears.

---

## 8. Editor Throughput Benchmarks & Capacity Planning

### 8.1 Time per finished minute (the core planning ratio)

| Content type | Edit hours per finished minute | Example |
|---|---|---|
| Simple cut-down, podcast clip, minimal graphics | 0.25–0.5 h/min | 10-min podcast episode: 3–5 h |
| Standard YouTube/corporate (cuts, music, basic titles) | **0.5–1 h/min** | 5-min video: 3–5 h |
| Stylized creator content (jump cuts, memes, SFX, motion gfx) | 1–2 h/min | 12-min video: 12–20 h+ |
| Heavy VFX / doc-style multi-source | 2–4+ h/min | budget as its own line |

(Composite of Tasty Edits, industry agency guides.) A "6–10 hour" YouTube edit is normal for standard fare; heavily-edited entertainment formats routinely hit 12–20 hours.

Multipliers that blow the ratio up: bad source audio, unlogged footage mountains (10h raw for 10min out), multicam sync, revision-heavy clients, and file-transfer overhead (large raw over slow links can add a full day before editing starts).

### 8.2 Turnaround norms

- **Professional agency standard: 24–72h** for a standard 10–20 min video; **24h for shorts/Reels/TikTok, 48h for long-form** is the common subscription-service SLA. Revisions add 24–48h per round.
- First-draft window for one-off freelance work: 2–7 business days; overnight/24h exists at premium rates.
- **Dedicated editors get faster over time** — brand familiarity compounds; the tenth video in a format costs meaningfully less than the first. This is the economic argument for retained editors over per-project freelancers for recurring formats.

### 8.3 Capacity math (how Carl sizes a post team)

Weekly editor capacity ≈ 30–35 productive hours (meetings, exports, file wrangling eat the rest).

Example: a channel shipping 1×15-min stylized long-form (15 × 1.5 = ~22h) + 3 shorts (3 × 1.5h = ~4.5h) + thumbnail support = **~28–30h/week = one full-time editor at capacity with zero slack.** Any revision-heavy week or second weekly video means either a second editor, an assistant-editor/selects role, or format simplification. Assistant-editor leverage (selects, sync, organization, captions, short cut-downs) is the cheapest capacity add — it can reclaim 30–40% of a lead editor's hours.

Track three numbers monthly: **edit-hours per published minute** (efficiency trend), **calendar days brief→publish** (pipeline health), and **revision rounds per video** (brief/review-process health; should trend to ≤2).

---

## 9. Playbooks & Checklists

### 9.1 Project close-out checklist (run after every delivery)

- [ ] Final master + all platform variants in `03_Exports/Final`, named per convention
- [ ] Delivery note written (files, specs, where published, sponsor copy version approved)
- [ ] Project file saved as final version matching the master's version number
- [ ] Media consolidated/trimmed via NLE media manager
- [ ] Unused-raw policy applied (keep selects/masters; cull per policy)
- [ ] Project archived to cold storage; archive location recorded in the index/manifest
- [ ] Working storage freed on schedule (60–90 days)
- [ ] Reusable assets (b-roll gems, motion gfx, music licenses) promoted to the shared library with metadata

### 9.2 New-team post-ops bootstrap (order of operations)

1. Write the naming convention + folder template (half a day; see §4)
2. Stand up storage: NAS or mountable cloud + continuous backup (3-2-1)
3. Adopt one review tool; kill feedback in every other channel by fiat
4. Define the version/round policy (§2.3) and put it in every editor/client agreement
5. Turn on transcription-at-ingest
6. Only then evaluate MAM software, against the trigger conditions in §6.3

### 9.3 Review-tool selection quick test

- Frame-accurate comments? Version stacking + compare? NLE panel integration? Guest review without accounts? Approval status tracking? Price per *reviewer* vs per *seat* (client reviewers should be free)? If a tool passes all six, the specific brand matters much less than adopting it fully.

---

## 10. Common Mistakes

1. **Organizing retroactively.** The "we'll clean up the drive later" plan. Later never comes; the cleanup costs 10x and the search costs bleed daily.
2. **`final_v2_FINAL_new.mp4`.** No versioning scheme, or scheme abandoned under deadline pressure. Fix is templates + habit, not willpower.
3. **Feedback sprawl.** Notes across email/Slack/texts/calls, arriving serially from stakeholders who haven't seen each other's notes. Editor becomes the arbiter of politics. (The most expensive mistake on this list.)
4. **No picture lock.** Endless "one more tweak" after finishing has started; every tweak re-taxes color/sound/captions/thumbnails.
5. **H.264 proxies / editing camera originals.** Sluggish timelines get blamed on hardware; the fix was a codec choice.
6. **RAID ≙ backup.** RAID survives a disk death, not deletion, ransomware, fire, or theft. One-copy media on a NAS is uninsured inventory.
7. **Buying a MAM to fix a discipline problem.** Software indexes the chaos; it doesn't remove it. Naming + folders + ownership first.
8. **Over-designed metadata taxonomy.** 40 optional fields → all empty. The documented top metadata failures: inconsistent tagging standards, missing descriptive info, over-complicated structures.
9. **Big-bang MAM rollout with no owner and no training** → abysmal adoption, negative ROI (the canonical implementation failure pattern).
10. **Hot-storing everything forever.** Paying S3-Standard prices ($23/TB/mo) for footage nobody has touched in two years — a 20x+ overspend vs deep archive.
11. **Archiving without an index.** Tapes/drives in a closet with no manifest = data you own but cannot use.
12. **No unused-footage policy.** Either everything is kept "just in case" (storage bloat) or an editor silently deletes raws (irreversible). Decide the policy once, in writing.
13. **Ignoring delivery variants until publish day.** Social crops, captions, and thumbnails treated as afterthoughts add a surprise half-day per video.

---

## 11. Questions Carl Should Ask

**Diagnosing the pipeline**
- "Walk me through the last video: from card to published. Where did it sit waiting, and for whom?" (Waiting time usually dwarfs working time.)
- "How many revision rounds did your last five videos take?" (>2 average → brief or review-process problem, not an editor problem.)
- "Is there a moment where the cut is formally locked? What happens when someone asks for a change after that?"
- "How many hours of edit time per finished minute are you actually running?" (If they can't answer, that's the answer.)

**Diagnosing asset management**
- "Find me the best clip of [X] from six months ago. Time it." (The one-question MAM audit.)
- "How many places does footage live right now — drives, laptops, cloud accounts? Who knows what's where?"
- "If your main drive died tonight, what exactly is gone?" (Tests 3-2-1 honestly.)
- "What's your naming convention? Show me — don't tell me — three recent project folders." (The gap between stated and actual convention is the real finding.)
- "Who owns the library? Whose job is it when metadata is wrong?"

**Diagnosing review/approval**
- "Where does feedback arrive? How many channels?"
- "Do reviewers see each other's notes before the editor does?"
- "What's the SLA on feedback — and what happens when a reviewer goes silent?"
- "Do sponsors approve their segment separately from the full cut?"

**Diagnosing cost/capacity**
- "What's your monthly storage bill, and how much of that data was touched in the last 90 days?"
- "If you added one more weekly video, what breaks first — shooting, editing, or review?"
- "What does your editor do that an assistant/AI (selects, transcription, captions, crops) could do?"

**Relevance notes for a creator-led team (Mayday-shaped):** the highest-ROI moves at this scale, in order: (1) enforce one review channel with version stacking and a 2-round cap; (2) template naming/folders and make the archive-on-close-out checklist mandatory; (3) transcription-at-ingest for talking-head footage — it accelerates both long-form selects and shorts clipping; (4) cold-archive published projects to deep-archive cloud instead of accumulating hot storage; (5) hold off on a full MAM until the §6.3 triggers actually fire — a disciplined folder tree plus a review tool covers a small team, and an in-house ops app can carry the project-status/approval-state layer that expensive MAMs bundle. A training-facility sibling business producing athlete video (swing analysis, promo content) inherits the same rules at smaller scale: naming by athlete/date/session is its metadata schema, and per-athlete folders are its library.

---

## Sources

- Frame.io Workflow Guide — File Naming & Folder Structure: https://workflow.frame.io/guide/file-naming
- MASV — Ultimate Post-Production Workflow Guide: https://massive.io/workflow/post-production-workflow/
- MASV — Video File Naming Convention & Best Practices: https://massive.io/file-transfer/video-file-naming-convention/
- iconik — DAM vs. MAM: Key Differences: https://www.iconik.io/blog/dam-vs-mam
- Shade — Best MAM for Video Production Teams (2026): https://shade.inc/blog/best-mam-for-video-production
- Evolphin — Media Asset Management Implementation Best Practices: https://evolphin.com/blog/media-asset-management-implementation-best-practices/
- ELEMENTS — Proxy Workflow in DaVinci Resolve: https://elements.tv/blog/everything-you-need-to-know-about-the-proxy-workflow-in-davinci-resolve/
- ELEMENTS — Proxy Workflow in Adobe Premiere Pro: https://elements.tv/blog/everything-you-need-to-know-about-the-proxy-workflow-in-adobe-premiere-pro/
- Frame.io — VMware Explore Case Study: https://frame.io/case-studies/vmware
- Archiware — Comparison of LTO and Cloud Storage Costs for Media Archive: https://blog.archiware.com/blog/comparison-of-lto-and-cloud-storage-costs-for-media-archive/
- Backblaze — How to Calculate the Cost of LTO vs. Cloud Storage: https://www.backblaze.com/blog/lto-versus-cloud-storage/
- Tasty Edits — How Long Does It Take to Edit a Video?: https://www.tastyedits.com/how-long-does-it-take-to-edit-a-video/
- DockBuddy — Video File Folder Structure (Editor's Naming Conventions): https://www.dockbuddy.app/en/blog/video-file-folder-structure
- Adobe — Frame.io Camera to Cloud (real-time photo & video collaboration): https://blog.adobe.com/en/publish/2024/11/12/frameios-camera-to-cloud-adds-real-time-photo-video-collaboration
