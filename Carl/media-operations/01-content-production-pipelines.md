---
title: "Content Production Pipelines (Concept to Published)"
domain: media-operations
tags:
  - content-pipeline
  - stage-gate
  - kanban
  - workflow-design
  - cycle-time
  - youtube-production
  - repurposing
sources_reviewed: 16
last_updated: 2026-07-12
---

# Content Production Pipelines (Concept to Published)

## TL;DR

- **Every content pipeline is the same six macro-stages** — Development → Pre-production → Production → Post → Publish → Repurpose — whether it's a $200M film or a weekly YouTube video. What differs is how formal the gates are and how many items flow in parallel. Design the stages once, then enforce them.
- **The workflow only holds if each step has one owner and one date.** This is the single most repeated finding across every practitioner source. No shared ownership, no "the team will handle it."
- **Kill more ideas, earlier.** Cooper's Stage-Gate research says 30–50% of projects should die at a gate. Most small content teams kill ~0% and instead let weak ideas limp through post-production, which is the most expensive place to discover a video shouldn't exist.
- **Approval is the #1 bottleneck, not creation.** 52% of companies regularly miss deadlines due to approval delays. Fix: max 2 reviewers, parallel not sequential review, 48-hour time-boxed feedback windows, owner resolves conflicts.
- **WIP limits are the highest-leverage pipeline intervention.** Little's Law: cycle time = WIP ÷ throughput. A team finishing 10 items/week with 30 in flight has a 3-week cycle time; cut WIP to 20 and cycle time drops to 2 weeks with zero extra effort.
- **Top YouTube studios develop the packaging (title + thumbnail + hook) BEFORE production, and treat it as the greenlight gate.** MrBeast's team builds videos around CTR and retention structure from minute zero, names bottlenecks out loud, and treats "critical components" with obsessive redundancy.
- **Repurposing is a pipeline stage, not an afterthought.** Target ratio: one 30-minute pillar → 10+ assets (3–5 clips, 2–3 text posts, newsletter section, blog post). Budget 2–4 hours per pillar manually; it's the most automatable stage.

---

## 1. The Universal Pipeline Anatomy

Every content operation — film studio, TV network, YouTube channel, agency, newsletter — runs a variant of the same pipeline. Learn the canonical version, then map any client's mess onto it.

### The six macro-stages

| # | Stage | Core question | Typical failure |
|---|-------|---------------|----------------|
| 1 | **Development / Ideation** | Should this exist? For whom? Why now? | Infinite backlog, nothing killed, no packaging test |
| 2 | **Pre-production / Planning** | Exactly what are we making, with what resources, by when? | Skipped entirely on small teams ("we'll figure it out on set") |
| 3 | **Production / Capture** | Get clean, organized raw material | Reshoots because pre-pro was skipped; disorganized media |
| 4 | **Post-production** | Turn raw material into the finished asset | Endless revision loops, unclear "done" definition |
| 5 | **Publish / Distribution** | Right platform, right packaging, right metadata, right time | Treated as an upload button instead of a craft stage |
| 6 | **Repurpose / Measure** | Extract maximum value, feed learnings back to stage 1 | Never happens; no feedback loop to ideation |

### Film-studio version (the most formalized)

Film is the reference implementation because a century of expensive failures forced discipline (StudioBinder framework):

- **Development**: producer/writer assembles a "package" — script + IP + director + talent attachments — to win financing. Ends at the **greenlight**: the formal commitment of production financing. Development can take years ("development hell"); the greenlight is a hard gate because everything after it burns real money.
- **Pre-production**: everything between financing and cameras rolling — line-by-line budget with department heads, full crew/cast hiring, storyboards, shot lists, locations, schedules. This is where films are actually won or lost.
- **Production**: "a sprint" — deliberately compressed because it's the most expensive stage per day. Daily call sheets (one owner: the AD), rigid on-set protocol (sound roll → camera roll → slate → action → cut).
- **Post**: three-stage edit (assembly → rough cut → fine cut → picture lock), then sound edit/mix, score, VFX, color, titles. Note the vocabulary: **picture lock** is a formal state change that freezes downstream work from churn.
- **Distribution**: trailers, EPKs, festival/distributor pitching, release windows.

**Greenlight criteria studios actually use** (Storiara / Hollywood Reporter): bankable talent attached, built-in audience / franchise, story that makes viewers lean forward, likable relatable hero, four-quadrant marketability, multi-window/multi-market distribution potential. Translate for a creator business: proven format or creator attached, existing audience demand signal, strong hook, broad appeal within the niche, repurposing potential across platforms.

### TV's key innovation: the overlapping conveyor

TV can't afford film's serial pipeline (one project at a time), so it runs a **rolling, overlapping schedule**: while Episode 5 shoots, Episodes 6–10 are simultaneously at breaking / first draft / rewrite / polish. Benchmarks (Staff Me Up, industry sources):

- Network hour-long drama (22–24 eps/yr): 4–8 weeks per episode from assignment to finished writer's draft
- Network half-hour comedy (20–24 eps/yr): 2–6 weeks per episode
- Cable/streaming drama (8–13 eps/season): 6–12+ weeks per episode
- Writers' room size scales with episode count: 24-episode shows run large rooms; 5–10-episode shows run small rooms or "mini-rooms"
- Clear hierarchy with one accountable head: the **showrunner** owns budget, scripts, crew, network relations; the room is a structured idea factory, not a democracy

**The lesson for any weekly content operation**: don't run one video through the whole pipeline at a time. Run a staggered conveyor where this week's publish, next week's edit, and the following week's shoot all happen in parallel — but with explicit WIP limits per stage (see §3) so the conveyor doesn't jam.

### Animation/VFX's key innovation: shot-level tracking and dailies

Animation and VFX studios track hundreds to thousands of shots, each with its own status, version history, notes, assignee, and approval state, in dedicated systems (Autodesk Flow Production Tracking née ShotGrid, ftrack). Two practices worth stealing at any scale:

1. **Everything is a tracked unit with a status and an owner.** Not "the video is in post" but "shot 14 is at v3, awaiting supervisor note resolution."
2. **Dailies**: a standing, high-frequency review ritual where work-in-progress is screened and notes are given with full context (previous versions, previous notes visible). Feedback is an appointment, not an ambush. Small-team version: a fixed 30-minute weekly review where all in-flight edits get notes at once.

---

## 2. Stage-Gate Systems for Content

### Cooper's Stage-Gate model (the canonical framework)

Robert Cooper's Stage-Gate (1980s–90s, from new-product-development research; used by ~88% of US firms doing NPD) alternates work **stages** with decision **gates**:

- **Discovery/Ideation** → **Gate 1** → **Stage 1: Scoping** (quick desk-research assessment) → **Gate 2** → **Stage 2: Business case** (real investigation: customer voice, feasibility, financials) → **Gate 3** → **Stage 3: Development** (build the thing) → **Gate 4** → **Stage 4: Testing & validation** → **Gate 5** → **Stage 5: Launch**.

Each gate has three parts:

1. **Deliverables** — what the team must show up with (defined in advance)
2. **Criteria** — scored: strategic fit, product/competitive advantage, market attractiveness, technical feasibility, synergy with core competencies, financial reward vs. risk
3. **Outputs** — a decision (**Go / Kill / Hold / Recycle / Conditional Go**) plus confirmed resourcing: budget, people, timeline, and the date of the next gate

**Gatekeepers** are the people who control the resources — they must be predefined, senior enough to commit resources, and cross-functional. Documented benefits: cycle times reduced ~30%, faster failure detection, better launches.

**Cooper's kill discipline is the whole point**: 30–50% of projects *should* be stopped at gates — not because they're bad, but because resources are finite and only the best deserve full investment. A gate where nothing ever dies is a status meeting, not a gate.

### Adapting Stage-Gate to a content pipeline (right-sized)

Full Stage-Gate is overkill for a weekly video. The content version needs exactly **two or three real gates**, cheap to run, brutal in effect:

**Gate 1 — Concept gate (before any production spend).** Deliverable: one-line concept + draft title + thumbnail sketch/description + target audience + why-now. Criteria: Would *you* click it? Does it fit the channel's proven formats? Is there a demand signal (search volume, comment requests, competitor outlier)? Can we actually make it with current resources? Decision: Go (→ pre-pro), Kill, or Hold (parked list with a revisit date).

**Gate 2 — Greenlight gate (before shoot day).** Deliverable: locked title + thumbnail concept, script/outline, shot list, budget, shoot date, publish date, owner per deliverable. This is the film-industry greenlight scaled down: after this gate, money and calendar are committed, so the packaging must already be validated. *The YouTube-native move — practiced by MrBeast, Hormozi's team, and most top studios — is that title and thumbnail are developed at Gate 1–2, not after the edit. If you can't package it, don't shoot it.*

**Gate 3 — Publish gate (QC before upload).** Deliverable: final cut, thumbnail (2–3 variants for testing), title, description, chapters, end screen, scheduled repurposing plan. Criteria: retention-critical first 30 seconds reviewed? Sponsor deliverable specs met? Metadata complete? This gate is a checklist, not a debate — creative arguments should have died at Gates 1–2.

**Rules that make gates work at small scale:**
- Gates are calendar-fixed (e.g., concept gate every Monday), not ad hoc.
- One gatekeeper per gate (usually the channel lead / creative director). Committees at gates are where velocity dies.
- Every gate ends with an explicit Go/Kill/Hold logged somewhere visible. Track your kill rate — if it's under ~20% at the concept gate, the gate is theater.
- "Recycle" (send back for rework) is allowed once. Twice means Kill or fundamentally re-scope.

---

## 3. Kanban for Content

### Board design

A content kanban board's columns ARE the pipeline stages. Canonical small-team board:

```
Ideas (backlog) → Approved/Scripting → Ready to Shoot → Shooting →
Editing → Review → Ready to Publish → Published → Repurposing → Done
```

Design rules:
- **Columns = states, not people.** "With Dave" is not a state.
- **Every column has an explicit exit policy** ("Definition of Done" per stage): e.g., "Editing exits when: cut approved by lead, color + audio pass complete, exported to review folder."
- **Split queue columns from work columns** where handoffs pile up: "Ready to Edit" (queue) vs "Editing" (active). Aging items in queue columns are your bottleneck detector.
- **One card = one publishable asset.** Repurposed clips can be checklist items on the parent card or their own swim-lane, but pick one convention.

### WIP limits — the core mechanic

**Little's Law**: average cycle time = average WIP ÷ average throughput. It's arithmetic, not opinion. Finish 10 items/week with 30 in progress → 3-week average cycle time. Same team, WIP capped at 20 → 2-week cycle time. Nobody worked harder; items just stopped waiting.

Setting limits (Businessmap / Atlassian guidance):
- **Starting heuristic: team members + 1** per active work column, then tune down.
- Content-team example limits: **Creating: 3, Review: 2, Publishing: 1**. Marketing teams typically run slightly looser than software teams (3–4 items per person) to accommodate creative incubation — but looser ≠ unlimited.
- Five configuration styles: per-person, per-column, CONWIP (one constant limit across the whole board), per work-type (e.g., max 1 "hero" video + 3 shorts in edit), and upstream limits (cap the "Approved" queue so the concept gate can't outrun production).
- **The WIP paradox**: limits too high → multitasking and missed deadlines return; too low → people idle at handoffs. Tune quarterly using cycle-time data.

Evidence it works: Aerosud's IT team doubled throughput (60 → 120 tickets) within days of adding limits; a published global marketing-ops case reported cycle time −37%, backlog −42%, quality scores +18% within three months of introducing WIP limits.

**When the limit blocks you, that's the system working.** The correct response to "Editing is full" is to swarm and finish something in Editing, not to start another shoot. Blocked-by-limit moments are exactly the bottleneck signal the board exists to produce.

### Classes of service (handle urgent vs. planned work)

Content teams die by undocumented drive-by requests ("can we just quickly make…"). Formalize 3 classes:
1. **Standard** — normal pipeline, normal gates.
2. **Expedite** — one (1) expedite lane, max one card in it at a time, requires the gatekeeper's explicit call. Everything else waits.
3. **Date-fixed** — sponsor deliverables, launches, seasonal content. These get scheduled backward from the immovable date with buffer (see §6 checklist).

Intake requirement for ANY request entering the board (Contentoo): what is requested, why it matters now, single owner, real deadline, definition of done. No intake form → no card → no work.

---

## 4. Pipeline Metrics That Matter

Measure the pipeline separately from measuring the content. Pipeline metrics (this section) tell you if the factory is healthy; content metrics (CTR, retention, revenue) tell you if the product is good.

| Metric | Definition | How to use it | Reference points |
|--------|-----------|---------------|------------------|
| **Cycle time** | Days from "work started" (approved at concept gate) to published | The master health metric. Track per content type. Watch the trend, not the absolute. | Agency blog post: ~12 working days brief→distribution (Chaser example). Weekly YouTube video: typically 7–21 days concept→publish depending on format weight |
| **Lead time** | Days from idea captured to published | Reveals backlog rot. Huge lead time + short cycle time = ideas sit forever before starting (usually fine); the reverse means execution drag | — |
| **Throughput** | Published assets per week/month, by type | The capacity number all planning must respect. Never plan a calendar above demonstrated throughput | — |
| **WIP** | Cards in active columns right now | If WIP > ~2× weekly throughput, cycle time is bloating (Little's Law) | — |
| **Stage aging** | How long the oldest card has sat in each column | The bottleneck finder. The column with the oldest cards is your constraint | — |
| **Flow efficiency** | Active-work time ÷ total cycle time | Typically shockingly low (often 10–20% in unmanaged pipelines) — most of a card's life is waiting for review/approval | — |
| **On-time publish rate** | % of items hitting their planned publish date | The external promise metric — matters most for sponsor content | 52% of companies *regularly miss* deadlines due to approval delays — beat this easily by fixing review |
| **Kill rate** | % of concepts killed/held at gates | <20% at concept gate = gate is theater; Cooper: 30–50% should die across the pipeline | — |
| **Revision loops** | Review round-trips per asset | >2 rounds consistently = brief problem or reviewer-authority problem, not an editor problem | Target ≤2 |
| **Content utilization** | % of produced assets actually published/used (Adobe content-supply-chain metric) | Enterprise teams waste a shocking share of produced content; small teams waste shoots that never get edited | 80% of large companies report no end-to-end visibility over campaign processes; creatives report 20+ hrs/week on repetitive tasks |
| **Repurposing ratio** | Derivative assets per pillar published | Target 10+ per 30-min pillar (see §7) | — |
| **Cost per asset** | Fully loaded cost by content type | Needed to price sponsorships and decide format mix; most small teams have never computed it | — |

**Minimum viable dashboard for a small studio**: cycle time by content type, throughput/week, current WIP, oldest card per column, on-time publish rate. Five numbers, reviewed weekly (§10).

---

## 5. How Top YouTube Studios Structure Their Pipelines

### The MrBeast production doctrine (leaked 36-page onboarding doc, Sept 2024)

The most detailed public artifact of a top-of-market YouTube pipeline. Key operational teachings (via Simon Willison's annotated notes and Tubefilter):

**North star**: make "the best YOUTUBE videos possible" — explicitly *not* the highest production value or the funniest content. Platform-native performance is the quality bar. Everything in the pipeline serves CTR (thumbnail/title) and AVD (retention).

**Packaging-first development**: concepts are judged by their thumbnail potential before anything is produced. "I Spent 50 Hours In Ketchup" beats a similar-effort "front yard" concept purely on visual clickability. The thumbnail IS the product spec.

**Retention-engineered structure** (their video spec, useful as a template for any format):
- Minute 0–1: capture attention and *prove the thumbnail promise* — they consider losing 21M of 60M viewers in minute one acceptable, i.e., ~35% first-minute drop is within tolerance even at the top of the game
- ~Minute 3: a planned "re-engagement" beat — often expensive and built specifically for this timestamp
- Minutes 3–6: highest density of exciting-but-simple content, rapid scene changes, make viewers invest in the story/people
- 6–end: payoff escalation ("wow factor" spectacle)

**Bottleneck culture**: bottlenecks are named to people's faces — "Tyler, you are my bottleneck. I have 45 days…" — with daily tracking and confirmed target dates. Uncomfortable, but it makes the constraint visible and owned, which is exactly what kanban aging metrics do politely.

**Critical components**: any element without which "WE DO NOT HAVE A VIDEO" gets obsessive protection — backup units, paid expedited shipping, escalate-the-literal-second-something-slips protocols. Pipeline translation: identify each project's single points of failure at the greenlight gate and pre-plan redundancy for them only (don't gold-plate everything).

**Consultants as cheat codes**: for any hard, novel problem, hire the person who already solved it (need the world's largest cake slice? call whoever made the last record-holder). Compresses timeline risk at the most uncertain stage.

**Communication protocol**: in-person > phone > voice > text > email; written messages "don't count" until receipt is confirmed. Brutal but correct for deadline-critical handoffs.

**Documentation**: "video everything" — film sets, processes, orders — into a reference library so training and disputes resolve from evidence.

**Financial rule**: avoid >$10K on anything off-camera; money should be visible on screen. Generalize: spend where the audience can perceive it; audit spend that only the team can perceive.

### Common patterns across serious creator studios

Synthesized from creator-workflow literature (Subclip, Overseer, CEO Entrepreneur, Jonathan Howard, ViewsMax):

1. **Idea bank with scoring** — a permanently maintained backlog where ideas are scored (packaging strength, effort, audience fit) rather than a blank page every week.
2. **Batching by stage, not by video** — write 3 scripts in one session, shoot 2–5 videos per shoot day (setup cost amortizes: lighting one video ≈ lighting five), edit in dedicated blocks. Batching converts context-switching losses into throughput.
3. **Roles split along pipeline lines** as team grows: researcher/writer → producer → shooter → editor → thumbnail designer → channel manager. First hire is almost always an editor (post is the durable bottleneck for solo creators); second is usually a writer/researcher or thumbnail specialist.
4. **Fixed publish cadence as the drumbeat** — the calendar drives backward-scheduled deadlines for every upstream stage.
5. **Templates everywhere** — script templates per format, edit project templates, thumbnail layout systems, standardized file/folder naming, publish checklists. Templates are the small-team substitute for department heads.
6. **Post-publish review feeding development** — retention graphs and CTR from published videos are reviewed on a fixed cadence and directly generate/kill future concepts.

---

## 6. Approval & Review Design (the #1 bottleneck)

Approval delays are the top pipeline killer: 52% of companies regularly miss deadlines because of them; 58% of marketers report feeling overwhelmed; interruptions cost 8–25 minutes each (Contentoo, citing Marketing Week 2025 survey and UC Berkeley research).

**The failure pattern**: Writer → Manager → Senior Manager → VP → Legal → Brand → rework loop → maybe published. Every layer reviews everything; nothing ships on time.

**The fixed design**: Clear brief → scoped reviewer (48 hours) → owner resolves conflicts → published.

Rules (Contentoo framework, validated everywhere):
1. **Max 2 reviewers per asset.** A third reviewer signals broken authority, not higher quality.
2. **Parallel, not sequential** — both reviewers get it simultaneously.
3. **Time-boxed: 48-hour feedback windows.** Silence = approval (state this explicitly in the policy).
4. **Scoped review**: each reviewer is told what they're reviewing FOR (accuracy vs. brand vs. legal). Unscoped review invites taste-based churn.
5. **The owner resolves conflicting feedback and has final direction authority.** Feedback is input, not instruction.
6. **Feedback cannot reopen decisions made at earlier gates.** If the concept was greenlit, review notes about "should this video exist" are out of order.
7. **One consolidated round.** Reviewers who trickle notes across three days get their later notes deferred to the next asset.

Sponsor/client review add-on: build the client-approval window into the schedule as its own stage with an SLA in the contract (e.g., "feedback within 2 business days or we proceed"), and always schedule sponsor deliverables backward from the air date with one full revision loop plus 2–3 days of buffer.

---

## 7. The Repurposing Engine (stage 6, done as a system)

Framework (Askube five-stage model + creator practice):

1. **Capture** — pick an idea-dense pillar (main video, podcast, webinar). A good pillar contains 3–7 distinct points, 1–3 stories, 1–2 data points, and at least one strong opinion.
2. **Mine** — extract 8–12 "atomic" ideas (a claim, a story beat, a stat, a hot take) into a list.
3. **Adapt** — rewrite each atom natively per platform: LinkedIn (opinion/framework, hook on line one), X/Threads (boldest line first, one beat per post), Shorts/Reels/TikTok (20–45s, open on the payoff, burned-in captions, one idea per clip), newsletter (full idea + personal perspective), blog (SEO-structured answer).
4. **Batch & schedule** — one pillar spreads across a week: Mon publish pillar, Tue LinkedIn #1 + clip, Wed thread + clip, Thu LinkedIn #2 + clip, Fri newsletter section; blog the following week.
5. **Measure & iterate** — engagement rate ((saves+comments+shares)/impressions), saves as the strongest intent signal, retention on clips, CTR into newsletter/blog, and minutes-per-asset as the internal cost metric.

Numbers to hold onto:
- **Target ratio: 1 pillar → 10+ assets** (3–5 clips, 2–3 text posts, 1 newsletter section, 1 blog post)
- **Manual cost: 2–4 hours per pillar** — and stages 2–3 (mining + drafting) are the most mechanical, i.e., the first thing to automate or delegate
- **Reuse windows**: same atom on a *different* platform → immediately; same atom, same platform → 30–60 days with a fresh hook; re-mine a strong pillar quarterly; news-pegged content publishes within 24–48h then retires

Pipeline integration: repurposing is a **column on the board** with its own owner and exit checklist, triggered automatically when a card hits Published. If it's nobody's job, it's nobody's output.

---

## 8. AI in the Pipeline (2024–2026 shift)

What changed and what didn't (2026 practitioner guides):

- **Post-production compression is real**: 60–80% reported reductions in overall editing time on rote tasks (cutting, trimming, transcription, captioning, multi-format reframing); auto-reformatting for aspect ratios/platforms is now table stakes.
- **The modular "daisy-chain" pattern won**: best-of-breed AI per task (one tool for transcription, one for generative b-roll, one for mastering) wired into the existing pipeline — not one monolith.
- **Role shift: editor as curator, not cutter.** Human judgment concentrates at taste decisions (story, pacing, hook) while machines do assembly. "Agent mode" end-to-end automation exists but fully-automated content measurably underperforms — teams relying 100% on automation report engagement drops from missing human timing/humor/nuance.
- **Where AI belongs in the six stages**: Development (research, outlier analysis, title/thumbnail ideation + scoring), Post (transcription, rough assembly, captions, clip candidates), Repurpose (atom mining, platform drafts — the 2–4 manual hours per pillar are the most automatable spend in the pipeline). Where it doesn't: gate decisions, final packaging judgment, anything the audience experiences as the creator's voice without human pass.
- **Carl's stance**: adopt AI stage-by-stage where cycle-time data shows the bottleneck; never adopt it as an identity ("we're an AI-first studio"). Measure minutes-per-asset before and after.

---

## 9. Playbook: Designing a Pipeline From Scratch

Step-by-step for a small team (2–10 people):

1. **Inventory content types** and pick ≤4 to run through the formal pipeline (e.g., main video, short, newsletter, sponsor deliverable). Everything else is ad hoc until it earns a lane.
2. **Map current reality first** — walk the last 3 published items backward and write down every actual step, wait, and person. Design from observed flow, not aspiration.
3. **Define stages + exit criteria per stage** (Definition of Done for each column). One sentence each. Write them on the board itself.
4. **Assign one owner per stage per content type.** On a 3-person team one person owns several stages — fine; fewer handoffs is an advantage, not a gap (Chaser).
5. **Install the 2–3 gates** (§2): concept gate (weekly, fixed slot), greenlight gate (before spend), publish gate (checklist). Name the single gatekeeper.
6. **Set WIP limits**: start at team-members+1 for active columns; Review gets a limit of 2; the expedite lane gets exactly 1.
7. **Create the intake rule**: nothing enters except through the idea backlog with the 5-field intake (what/why-now/owner/deadline/done). Publicize that Slack requests without intake don't exist.
8. **Fix review policy** (§6): 2 reviewers max, parallel, 48h window, owner resolves.
9. **Backward-schedule from the publish cadence**: publish date → publish gate −1d → picture lock −3d → edit start −7d → shoot −10d → greenlight −14d (tune to your measured cycle time, then protect the buffers).
10. **Stand up the 5-number dashboard** (§4) and the weekly pipeline review (below). Run for 4 weeks before changing anything.

### Weekly pipeline review ritual (30 minutes, fixed slot)

1. Walk the board **right to left** (finish-first bias): what's blocking Published-adjacent items?
2. Read the aging report: oldest card per column. Ask "what does this card need to move?" — never "what did you do this week?"
3. Check WIP vs limits; anything over gets swarmed or explicitly parked.
4. Concept gate: score new ideas, issue Go/Kill/Hold. Log the kills.
5. One metric glance: cycle-time trend. One process tweak max per week.

### Per-stage checklist skeleton (adapt per content type)

- **Concept exit**: one-liner, draft title + thumbnail concept, audience/why-now, effort size (S/M/L), demand signal noted
- **Pre-pro exit**: script/outline locked, shot list, gear/location/talent confirmed, shoot date + publish date on calendar, critical components identified with backup plan
- **Shoot exit**: footage ingested to named folder structure, backed up (3-2-1), select notes logged, b-roll checklist verified before wrap
- **Edit exit**: cut approved by lead (≤2 review rounds), audio + color pass, captions, exported to spec
- **Publish exit**: thumbnail variants uploaded, title/description/tags/chapters, end screens, scheduled time, sponsor spec verified against the brief, repurposing card spawned
- **Repurpose exit**: 8–12 atoms mined, clips + posts drafted and scheduled per §7 cadence, performance review date set

---

## 10. Common Mistakes

1. **No kill mechanism.** Every idea that enters eventually ships, so quality control happens via exhaustion in the edit. Fix: concept gate with a logged kill rate.
2. **Packaging developed last.** Title/thumbnail invented the night before upload, after all the cost is sunk. The top studios do it first and gate on it.
3. **Approval sprawl.** 3+ reviewers, sequential, unbounded windows, feedback relitigating greenlit decisions. This is the single most common operational killer (52% miss deadlines because of it).
4. **Unlimited WIP.** Everything "in progress," nothing finishing; cycle time balloons per Little's Law. Starting more work feels productive and is the exact opposite.
5. **Calendar set above demonstrated throughput.** The cadence looks great on the planning slide and collapses by week four. Plan at ~80% of measured throughput; keep slack for expedites.
6. **Tool sprawl / no single source of truth.** Plan in Sheets, briefs in Notion, approvals in email, schedule in a PM tool nobody updates — every team member pulls from a different source and the system loses trust. One board, one truth.
7. **Skipping pre-production.** Shoot days that discover the concept on set; reshoots; missing b-roll. Pre-pro is cheap; production and reshoots are expensive — the film industry's entire structure encodes this.
8. **No queue/work column split**, so bottlenecks are invisible until a deadline explodes.
9. **Repurposing as leftover energy** rather than a staffed stage with a target ratio.
10. **Front-loading the system, no follow-through.** Elaborate calendar and workflow built in an enthusiastic weekend, unmaintained by week three. A crude board reviewed weekly beats a beautiful one reviewed never.
11. **Measuring only content performance, never pipeline performance.** CTR dashboards everywhere, but nobody knows the team's cycle time or where cards age.
12. **Treating the expedite lane as a normal lane.** When everything is urgent, the pipeline is just vibes with columns.

---

## 11. Questions Carl Should Ask (diagnostic)

**Flow & capacity**
- "Walk me through the last video you published, backward — every step and every wait. Where did it sit the longest?"
- "How many pieces of content are 'in progress' right now? How many did you finish last week?" (Instant Little's Law read.)
- "What's your cycle time from approved idea to published, by content type? Do you know it or are you guessing?"
- "When did you last kill an idea after starting work on it? Before starting work on it?"

**Gates & packaging**
- "At what point do you know the title and thumbnail? Before or after you shoot?"
- "Who has greenlight authority? Is it one person? Do they ever say no?"
- "What happens to an idea between 'someone suggested it' and 'someone is working on it'? Is there a real decision in between?"

**Review & approval**
- "How many people review a piece before it publishes? Sequential or parallel? What happens if a reviewer goes silent?"
- "How many revision rounds does a typical asset take? Who resolves conflicting notes?"
- "Have sponsor approvals ever slipped a publish date? What's the contractual feedback SLA?"

**Ownership & intake**
- "For each stage, name the one person who owns it. Any stage with two names or zero names?"
- "How does new work enter the system? Can anyone Slack a request into existence?"

**Repurposing & feedback loop**
- "For your last main video, how many derivative assets shipped? Whose job was that?"
- "When a video over- or under-performs, does that change what gets greenlit next month? Show me an example."

**Load-bearing risks**
- "What's the 'critical component' of your next big piece — the thing without which there's no video? What's the backup plan for it?"
- "If your editor disappeared for two weeks, what happens to the calendar?" (Bus factor / template maturity test.)

---

## 12. Relevance Notes (small media co / training facility)

- A YouTube-first media company with sponsors is really running **three pipelines with different classes of service**: hero content (standard), shorts/repurposing (derivative, high-throughput), and sponsor deliverables (date-fixed, contract SLA on review). Boards and metrics should separate them — blending them hides that sponsor work expedites everything else into lateness.
- A training facility producing content (drills, athlete features, program marketing) is a **batch-shoot operation by nature**: the facility is a permanent set, so the pipeline advantage is shoot-day batching (5–10 assets per session) plus a heavy repurposing stage — closer to the 1-pillar→10-assets model than the film model.
- An internal ops app (project boards, sprints) is only as good as the pipeline it encodes: columns must match the real stage definitions and exit criteria in this doc, WIP limits and stage-aging should be visible, and the concept-gate kill log deserves first-class treatment (most tools track only what survived).

---

## Sources

- Simon Willison — "How to succeed in MrBeast production (leaked PDF)": https://simonwillison.net/2024/Sep/15/how-to-succeed-in-mrbeast-production/
- Tubefilter — MrBeast internal production guide key points: https://www.tubefilter.com/2024/09/17/mrbeast-internal-production-guide-leaked-key-points/
- Chaser — Content Production Workflow: Stages, Examples, and Setup: https://www.trychaser.com/blog/content-production-workflow
- Stage-Gate International — The Stage-Gate Model: An Overview: https://www.stage-gate.com/blog/the-stage-gate-model-an-overview/
- Cora Systems — Stage Gate Process Guide: https://corasystems.com/guidebooks/stage-gate-process-modern-innovation-guide
- StudioBinder — Stages of Film Production: https://www.studiobinder.com/blog/stages-of-film-production/
- Storiara — The Film Greenlight Process: https://storiara.com/blog/the-film-greenlight-process-how-studios-decide-to-make-a-movie
- Contentoo — Fix Content Workflow Bottlenecks: https://www.contentoo.com/blog/how-to-fix-content-workflow-bottlenecks
- Businessmap — The Ultimate Guide to WIP Limits in Kanban: https://businessmap.io/kanban-resources/getting-started/what-is-wip
- Atlassian — Working with WIP limits for kanban: https://www.atlassian.com/agile/kanban/wip-limits
- AgileSherpas — The Many Powers of WIP Limits for Agile Marketing: https://www.agilesherpas.com/blog/wip-limits-agile-marketing
- Askube — The Content Repurposing Workflow (2026): https://getaskube.com/blog/content-repurposing-workflow
- Staff Me Up — TV Production Schedule Explained: https://blog.staffmeup.com/tv-production-schedule-explained-for-writers-and-producers/
- Adobe — Content Supply Chains: Challenges and Optimization Strategies: https://business.adobe.com/blog/perspectives/optimizing-your-content-supply-chain-to-deliver-exceptional-experiences
- The Mayhem Co — Beginner's Guide to Production Tracking Software for Animation & VFX: https://www.themayhemco.com/post/a-beginner-s-guide-to-production-tracking-software-for-animation-vfx
- Digen — How AI is Changing Video Production 2026 / automation guides: https://resource.digen.ai/how-to-automate-video-production-with-ai/
