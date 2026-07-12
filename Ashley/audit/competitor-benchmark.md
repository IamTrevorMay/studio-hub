---
title: Competitor & Niche Benchmark (Live Data)
domain: audit
tags: [competitors, benchmarks, baseball, athlete-creators, youtube, vidiq, blocked]
data_pulled: 2026-07-12
last_updated: 2026-07-12
status: BLOCKED — vidIQ credits exhausted; live data could not be pulled
---

# Competitor & Niche Benchmark (Live Data)

> **AUDIT STATUS: BLOCKED.** On 2026-07-12 the connected vidIQ account (`trevor.may.khs@gmail.com`, **free plan**) had **0 of 150 credits** remaining. Every data-bearing vidIQ tool costs 5 credits per call and returned `Not enough credits`. Credits renew **2026-07-25T19:35Z**. This document contains only what the free (0-credit) tools returned, an unpopulated benchmark scaffold, and an exact refresh runbook. **No numbers below are invented — empty cells mean "not yet pulled."**

## TL;DR

1. **The live benchmark could not be built.** vidIQ credit balance at pull time: `totalCredits: 0`, `renewableCredits: 0/150`, plan `free`, renewable reset `2026-07-25T19:35:52Z`. A test call to `vidiq_channel_stats` failed with "Not enough credits (this tool costs 5 credits)."
2. **One channel is connected to vidIQ:** channel ID `UCXnWH_cIChvXGhLPIJGoiBg` (the only entry from `vidiq_user_channels`). The second Trevor May channel (More Mayday vs. Trevor May Baseball — whichever this ID is not) is **not authorized** in vidIQ and should be connected before the refresh so both can be benchmarked with owner-level analytics.
3. **No competitors are tracked in vidIQ yet:** `vidiq_list_competitors` for `UCXnWH_cIChvXGhLPIJGoiBg` returned an empty list. Setting the tracked-competitor set (via `vidiq_update_competitors`) after the refresh is a cheap way to make future pulls one-call.
4. **Full refresh cost is affordable on the free tier:** the complete runbook below is ~30 calls x 5 credits = **~150 credits**, i.e. exactly one month's free-plan allowance. Run it right after the 2026-07-25 reset, or upgrade the plan to run it plus ongoing monitoring.
5. **Candidate competitor roster is defined (12 channels, below)** covering the three comparison bands that matter: baseball-content giants (Jomboy Media), baseball analysis/storytelling mid-tier (Foolish Baseball, Baseball Doesn't Exist, Made The Cut, Baseball Is Dead), player-adjacent/training (Eric Sim / CoachEricSim, Garrett Gordon-style trainers), and athlete-creator analogues from other sports (Deestroying, Tracy McGrady-style post-career, MostVerified etc. — to be validated live).
6. **Nothing else in this doc is a measured fact.** All stats tables are intentionally empty scaffolds to be filled by the refresh runbook.

## Data provenance

| Pull | Tool | Result | Cost |
|---|---|---|---|
| 1 | `vidiq_user_channels` | `{"channels":[{"channelId":"UCXnWH_cIChvXGhLPIJGoiBg"}], "authenticatedAs":"trevor.may.khs@gmail.com"}` | 0 credits |
| 2 | `vidiq_balance` | 0/150 renewable credits, free plan, resets 2026-07-25T19:35:52Z | 0 credits |
| 3 | `vidiq_channel_stats(UCXnWH_cIChvXGhLPIJGoiBg)` | **FAILED — Not enough credits** (tool costs 5) | n/a |
| 4 | `vidiq_list_competitors(UCXnWH_cIChvXGhLPIJGoiBg)` | `{"competitors":[]}` — no tracked competitors | 0 credits |

**What could NOT be pulled (everything requiring credits):** channel stats/analytics for the Trevor May channels, channel search to resolve competitor IDs, per-channel video lists, niche outliers (6–12 months), channel performance trends (view-velocity curves), similar-channels discovery, and keyword research. Total data-bearing pulls attempted: 1 (failed). Successful free pulls: 3.

## Candidate competitor set (roster only — stats NOT pulled)

These are the channels the refresh should resolve and benchmark. Handles must be verified with `vidiq_channel_search` at refresh time (do not assume them). Selection rationale: named in the audit brief, or well-known occupants of the baseball-content / athlete-creator niche the Trevor May channels compete in for the same viewer.

| # | Channel | Band | Why it's a comparable |
|---|---|---|---|
| 1 | Jomboy Media | Baseball media giant | Ceiling benchmark; breakdown format defined the niche |
| 2 | Foolish Baseball | Analysis / storytelling | Editorial baseball video essays, mid-size, high views-per-sub |
| 3 | Baseball Doesn't Exist | Analysis / storytelling | Documentary-style outlier machine; closest format model for More Mayday longform |
| 4 | Made The Cut (Zack) | Analysis / storytelling | Baseball stories/documentary band |
| 5 | Baseball Is Dead / Fuzzy | Personality / podcast | Personality-led baseball audience overlap |
| 6 | Eric Sim (CoachEricSim) | Ex-pro player-creator | Former pro turned creator — direct analogue for Trevor's positioning |
| 7 | Antonelli Baseball | Ex-pro / training | Ex-MLB, instruction + commentary — Trevor May Baseball comparable |
| 8 | Baseball Bat Bros | Gear / demo | Demo-driven baseball entertainment, comparable audience |
| 9 | Deestroying | Athlete-creator (football) | Post-career athlete-creator playbook at scale |
| 10 | Jesser | Sports creator (basketball) | Format ceiling for sports-challenge content |
| 11 | Sfia / Marcus Stroman or other active-MLB creator | Active-player channel | How active/recent MLB players perform as creators |
| 12 | Talkin' Baseball (Jomboy net) | Podcast / commentary | Podcast-format benchmark vs. More Mayday talk content |

> At refresh, replace/validate rows 4, 5, 11, 12 with what `vidiq_similar_channels` and `vidiq_channel_search` actually return — the live similar-channels call is the source of truth for who the algorithm considers adjacent, and it may surface stronger comparables than this hand list.

## Benchmark tables (EMPTY — to be filled at refresh)

### A. Channel stats field (from `vidiq_channel_stats` + `vidiq_get_channels_by_ids`)

| Channel | Subs | Total views | Videos | 30d sub growth | 30d view growth | Avg views/video | Country |
|---|---|---|---|---|---|---|---|
| Trevor May — connected channel (`UCXnWH_cIChvXGhLPIJGoiBg`) | — | — | — | — | — | — | — |
| Trevor May — second channel (resolve ID) | — | — | — | — | — | — | — |
| (12 competitor rows) | — | — | — | — | — | — | — |

### B. Niche outliers, last 6–12 months (from `vidiq_outliers`)

| Video | Channel | Views | VPH | Outlier multiple | Published | Format notes |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

### C. View-velocity curves (from `vidiq_channel_performance_trends`)

| Channel | Median views @24h | @7d | @30d | Shape (fast-pop vs slow-burn) |
|---|---|---|---|---|
| — | — | — | — | — |

### D. Keyword landscape (from `vidiq_keyword_research`)

| Keyword | Volume | Competition | Overall | Est. monthly searches |
|---|---|---|---|---|
| — | — | — | — | — |

## Top opportunities (provisional — re-rank after live pull)

Ranked by expected impact; every item is contingent on live data confirming it.

1. **Restore data access before anything else.** Either wait for the 2026-07-25 credit reset and immediately run the runbook (~150 credits = one full month's free allowance), or upgrade the vidIQ plan so benchmarking doesn't consume the entire monthly budget in one audit. Without this, Ashley has no competitive numbers at all.
2. **Authorize the second Trevor May channel in vidIQ.** Only `UCXnWH_cIChvXGhLPIJGoiBg` is connected; `vidiq_channel_analytics` (owner-level: watch time, traffic sources, retention) works only on authorized channels. Both More Mayday and Trevor May Baseball should be connected before the refresh.
3. **Seed the tracked-competitor list.** `vidiq_list_competitors` is empty. After resolving the 12 roster IDs, write them with `vidiq_update_competitors` — then future outlier pulls are a single `vidiq_outliers(channelIds=[...])` call instead of 12 searches.
4. **Prioritize the outlier-format analysis in the refresh.** The single highest-value pull for content decisions is `vidiq_outliers` scoped to the competitor IDs over `sixMonths`/`oneYear` — it directly answers "what formats are breaking out in this niche right now," which no internal Mayday data can answer.
5. **Benchmark the ex-pro band specifically.** Trevor's unique asset is MLB credibility; the most decision-relevant comparison is not Jomboy (media company) but the ex-pro creators (Eric Sim, Antonelli). The refresh should compute views-per-subscriber and outlier multiples for that band separately.

## Refresh

Run after **2026-07-25T19:35Z** (credit reset) or after a plan upgrade. Check `vidiq_balance` first (free). Estimated cost: ~150 credits at 5/call. Exact calls, in order:

1. `vidiq_balance` — confirm ≥150 credits available. (0 cr)
2. `vidiq_user_channels` — confirm both Trevor May channels are authorized; if only one, have Trevor connect the other in vidIQ first. (0 cr)
3. `vidiq_channel_stats(channelId="UCXnWH_cIChvXGhLPIJGoiBg", from=<90d ago>)` — own-channel stats. Repeat for the second channel ID once known. (5 cr each)
4. `vidiq_channel_analytics(channelId="UCXnWH_cIChvXGhLPIJGoiBg", dimensions=["day"], startDate=<90d ago>)` and a second call with `dimensions=["insightTrafficSourceType"]` — owner-level performance + traffic mix. (5 cr each)
5. `vidiq_channel_search(handle="@JomboyMedia")` — and equivalent single-handle lookups (or one `channelTitle` search per name) for: Foolish Baseball, Baseball Doesn't Exist, Made The Cut, Baseball Is Dead, Eric Sim, Antonelli Baseball, Baseball Bat Bros, Deestroying, Jesser, plus any active-MLB-player channels. Capture `channelId`, `niche`, `subscriberCount`, growth fields. (~10–12 calls, 5 cr each)
6. `vidiq_similar_channels(niche=<the connected channel's niche verbatim from step 5's own-channel row>, minSubscribers=<10% of own subs>, maxSubscribers=<5x own subs>)` — validate/extend the roster with algorithmic comparables. (5 cr)
7. `vidiq_get_channels_by_ids(channelIds=[<all resolved IDs>])` — one batched call for uniform stats across the field (fills Table A). (5 cr)
8. `vidiq_outliers(channelIds=[<all resolved IDs>], publishedWithin="sixMonths", limit=50)` and a second call with `publishedWithin="oneYear", contentType="long"` — fills Table B; capture breakout score, VPH, views. (5 cr each)
9. `vidiq_outliers(keyword="baseball", publishedWithin="sixMonths", minOutlierScore=<pick after seeing distribution>, limit=50)` — niche-wide outliers beyond the tracked roster. (5 cr)
10. `vidiq_channel_performance_trends(channelId=...)` for both Trevor channels + 3–4 key comparables (Baseball Doesn't Exist, Foolish Baseball, Eric Sim, Jomboy) — fills Table C. (5 cr each)
11. `vidiq_channel_videos(channelId=..., videoFormat="long", popular=true)` for the 3–4 channels whose outliers dominate step 8 — get their top-video sets for format-pattern analysis. (5 cr each)
12. `vidiq_keyword_research(keyword="baseball training", country="US")` and `vidiq_keyword_research(keyword="mlb", country="US")` — fills Table D. (5 cr each)
13. `vidiq_update_competitors(youtubeChannelId="UCXnWH_cIChvXGhLPIJGoiBg", ...)` — persist the final roster so the next refresh starts from `vidiq_list_competitors` (0 cr) + one batched outliers call. *(Schema not yet loaded this session — load via ToolSearch `select:mcp__claude_ai_vidIQ_for_Claude__vidiq_update_competitors`.)*
14. Rewrite this file: fill Tables A–D, replace the provisional roster and opportunities with measured findings, update `data_pulled` / `last_updated`, and remove the BLOCKED banner.
