---
title: Keyword & Search Opportunity Map (Live Data)
domain: audit
tags: [keywords, youtube-seo, search-opportunities, baseball, vidiq, seasonal-calendar]
data_pulled: 2026-07-12
last_updated: 2026-07-12
status: BLOCKED — vidIQ credits exhausted; live metrics pending refresh after 2026-07-25
---

# Keyword & Search Opportunity Map (Live Data)

> **DATA AVAILABILITY WARNING — read before trusting anything below.**
> On 2026-07-12 the connected vidIQ account (`trevor.may.khs@gmail.com`, **free plan**) had **0 of 150 renewable credits** remaining. Every vidIQ data tool (keyword research, channel stats, channel videos, outliers, similar channels, YouTube search, trending) costs 5 credits per call, so **no live keyword metrics could be pulled this session**. Credits reset **2026-07-25T19:35:52Z**.
> Everything in this doc is therefore a *research scaffold*: a prioritized keyword queue, seasonal calendar, and ranked idea list built from niche knowledge — with empty metric columns that the Refresh section fills in one pass once credits are back. **No number in a "Volume/Competition/Score" column below is real vidIQ data yet.**

## TL;DR

1. **Live-data pull failed: 0/150 vidIQ credits** (free plan). Only zero-cost calls succeeded. All keyword volume/competition tables below are pending; run the Refresh section after **2026-07-25**.
2. **What live data we do have (zero-cost calls):** one connected channel, ID `UCXnWH_cIChvXGhLPIJGoiBg` (authorized via `trevor.may.khs@gmail.com`); its vidIQ competitor list is **empty** — Trevor is tracking **0 competitors** in vidIQ, which is itself a finding (no competitor benchmarking is configured).
3. **The free plan's 150 credits/month ≈ 30 tool calls** — the full refresh below needs ~26 calls, consuming nearly the whole monthly allowance. Recommendation: budget one full refresh per cycle, or upgrade the vidIQ plan if Ashley's audits are to run monthly across all six domain docs.
4. **Highest-conviction opportunity class (pre-validation):** question-style "how to pitch" search terms (grip tutorials, velocity, arm care) where a 9-year MLB pitcher outranks generic coaching channels on credibility — these are evergreen, low-churn, and map directly to Trevor May Baseball.
5. **Seasonal structure is known even without metrics:** baseball search demand has four predictable waves — offseason training (Nov–Jan), spring training/season start (Feb–Apr), trade deadline/dog days (Jul), playoffs/World Series (Sep–Nov). The calendar below assigns keyword clusters to each wave; the refresh only needs to rank them.
6. **20+ ranked video/short ideas are drafted** (section 6) with the exact keyword each targets, so the moment metrics land, ideas can be re-ranked by real Volume-vs-Competition scores instead of judgment.
7. **Action item independent of credits:** populate the vidIQ competitor list (via `vidiq_update_competitors`) with 5–10 baseball/athlete-creator channels so future outlier and trend pulls have a benchmark set. Candidate list in section 7.

---

## 1. Data provenance

| Call | Tool | Cost | Result |
|---|---|---|---|
| 1 | `vidiq_user_channels` | 0 | OK — one authorized channel: `UCXnWH_cIChvXGhLPIJGoiBg` |
| 2 | `vidiq_get_channels_by_ids` | 5 | **FAILED — insufficient credits** |
| 3 | `vidiq_channel_search` ("Trevor May Baseball") | 5 | **FAILED — insufficient credits** |
| 4 | `vidiq_balance` | 0 | OK — 0/150 renewable credits, resets 2026-07-25T19:35:52Z, plan: free |
| 5 | `vidiq_list_competitors` (UCXnWH…) | 0 | OK — empty list (no tracked competitors) |

**Could NOT get (all 5-credit tools):** channel stats/analytics for More Mayday or Trevor May Baseball, channel video lists, keyword research metrics (volume, competition, overall score, monthly estimates, country volume), outlier videos, similar/competitor channel discovery, trending videos, YouTube search results, video stats/VPH. It is not confirmed which channel `UCXnWH_cIChvXGhLPIJGoiBg` is (metadata lookup costs credits); resolve on refresh.

---

## 2. Confirmed live facts

- **Connected channel:** `UCXnWH_cIChvXGhLPIJGoiBg` (only one channel is authorized in vidIQ — if both More Mayday and Trevor May Baseball should be audited, the second channel needs to be connected in vidIQ).
- **Tracked competitors:** none. The vidIQ competitors feature is unused.
- **Plan constraint:** free plan, 150 credits/month, ~30 five-credit calls. The refresh plan in section 8 is sized to fit.

---

## 3. Keyword research queue (metrics pending)

These are the seed keywords to run through `vidiq_keyword_research` (mode `research`, country `US`), grouped by cluster. Columns left blank are filled on refresh. **Priority** is pre-validation judgment: how well the term matches Trevor's unique credibility (retired MLB pitcher, ex-closer, gamer/streamer crossover) and evergreen-ness.

### Cluster A — Pitching instruction (evergreen, highest credibility fit)

| Seed keyword | Volume | Competition | Score | Est. monthly | Priority |
|---|---|---|---|---|---|
| how to pitch faster | — | — | — | — | P1 |
| how to throw a slider | — | — | — | — | P1 |
| how to throw a changeup | — | — | — | — | P1 |
| pitching grips | — | — | — | — | P1 |
| pitching mechanics | — | — | — | — | P1 |
| increase pitching velocity | — | — | — | — | P1 |
| how to throw a curveball | — | — | — | — | P2 |
| pitcher arm care | — | — | — | — | P2 |
| youth pitching drills | — | — | — | — | P2 |
| long toss program | — | — | — | — | P3 |

### Cluster B — Inside-MLB / athlete-life (question-style, uniquely answerable)

| Seed keyword | Volume | Competition | Score | Est. monthly | Priority |
|---|---|---|---|---|---|
| what mlb players do in the offseason | — | — | — | — | P1 |
| how much do mlb players make | — | — | — | — | P1 |
| mlb minor league life | — | — | — | — | P2 |
| what is it like to face [star hitter] | — | — | — | — | P2 |
| mlb spring training explained | — | — | — | — | P2 |
| tommy john surgery recovery | — | — | — | — | P2 |
| how do mlb players train | — | — | — | — | P2 |
| baseball unwritten rules | — | — | — | — | P3 |

### Cluster C — Analysis / reaction (seasonal, news-cycle)

| Seed keyword | Volume | Competition | Score | Est. monthly | Priority |
|---|---|---|---|---|---|
| mlb trade deadline | — | — | — | — | P1 (Jul) |
| mlb playoffs predictions | — | — | — | — | P1 (Sep–Oct) |
| world series reaction | — | — | — | — | P2 (Oct–Nov) |
| mlb free agency | — | — | — | — | P2 (Nov–Jan) |
| pitcher breakdown [player name] | — | — | — | — | P2 |
| torpedo bats / bat technology | — | — | — | — | P3 (news-dependent) |

### Cluster D — Baseball training gear & adjacent (commerce intent)

| Seed keyword | Volume | Competition | Score | Est. monthly | Priority |
|---|---|---|---|---|---|
| best baseball training equipment | — | — | — | — | P2 |
| weighted ball program | — | — | — | — | P2 |
| pitching machine review | — | — | — | — | P3 |
| baseball strength training | — | — | — | — | P2 |

---

## 4. Question-style & evergreen topics a retired MLB pitcher is uniquely credible for

Ranked by (a) durability of search demand, (b) how few credible answers exist from actual MLB players:

1. **"What does an MLB bullpen actually talk about?"** — insider access no coach channel has.
2. **"How hard is it REALLY to hit an MLB fastball?"** — perennial search + demonstrable on camera.
3. **"What separates AAA from MLB pitchers?"** — 9 seasons of firsthand data.
4. **"How I threw 98 mph — and what ruined my arm"** — velocity searches + injury cautionary authority (Trevor's actual TJ/injury history).
5. **"What MLB players eat / travel / get paid per diem"** — high-curiosity lifestyle questions.
6. **"How to know if your kid throws hard enough for D1/pro"** — parent-search goldmine, evergreen.
7. **"Reading a hitter: what pitchers look for"** — strategy content generic channels can't fake.
8. **"What getting called up / DFA'd / released feels like"** — emotional insider stories, zero competition.

---

## 5. Seasonal keyword calendar

| Window | Search wave | Keyword clusters to publish against | Lead time |
|---|---|---|---|
| **Nov–Jan** (offseason) | Training, free agency, "get better this winter" | Cluster A (velocity, drills, arm care), Cluster C free agency | Publish training content early Nov; it compounds all winter |
| **Feb–Mar** (spring training) | "Spring training explained", tryout prep, season previews | Cluster B spring training, Cluster A youth drills (tryout season) | 2–3 wks before pitchers & catchers report |
| **Apr–Jun** (season start) | Player breakdowns, "why is X so good", rules changes | Cluster C breakdowns, Cluster B insider | React within 48h of storylines |
| **Jul** (deadline / dog days) | Trade deadline, All-Star, HR Derby | Cluster C deadline | Deadline week = daily shorts window |
| **Aug** (pennant races) | Rookie callups, September roster rules | Cluster B callup stories | Evergreen "called up" story re-promotable here |
| **Sep–Nov** (playoffs/WS) | Predictions, reactions, "pressure" content | Cluster C playoffs + Cluster B "closing a playoff game" insider | Highest-RPM window; plan series in Aug |
| **Year-round** | Grips, mechanics, "how to pitch" | Cluster A | Backbone uploads between seasonal spikes |

---

## 6. Ranked video/short ideas (23) — re-rank after metric refresh

| # | Idea | Format | Target keyword | Season | Pre-validation rank rationale |
|---|---|---|---|---|---|
| 1 | Every pitch grip I threw in the MLB (with slo-mo) | Long + shorts series | pitching grips | Evergreen | Highest-volume evergreen cluster; infinitely clippable |
| 2 | How I went from 88 to 98 mph (honest version) | Long | increase pitching velocity | Nov–Jan | Velocity is the #1 youth search intent |
| 3 | How to throw a slider that actually breaks | Long | how to throw a slider | Evergreen | Signature-pitch tutorial, P1 keyword |
| 4 | What MLB players ACTUALLY do in the offseason | Long | what mlb players do in the offseason | Nov–Dec | Question-style, insider-only answer |
| 5 | The truth about MLB money (salary, per diem, taxes) | Long | how much do mlb players make | Evergreen | Massive curiosity search; firsthand credibility |
| 6 | Arm care routine that would've saved my career | Long | pitcher arm care | Nov–Jan | Injury authority + parent audience |
| 7 | Facing [current star] as a pitcher: my actual game plan | Long | pitcher breakdown [player] | In-season | News-cycle hook + insider strategy |
| 8 | 5 pitching drills I'd give every 12-year-old | Long | youth pitching drills | Feb–Mar | Tryout-season parent search |
| 9 | What getting called up to the MLB feels like | Long/short | mlb call up story | Aug–Sep | Zero-competition emotional story |
| 10 | Tommy John: what recovery is really like | Long | tommy john surgery recovery | Evergreen | High-anxiety search, credible answer |
| 11 | Ranking every MLB stadium I pitched in | Long | mlb stadium rankings | Apr–Jun | Listicle format, broad appeal |
| 12 | Trade deadline winners/losers — from a player's view | Long + shorts | mlb trade deadline | Jul | Annual spike; player POV differentiates |
| 13 | My playoff predictions (as someone who's pitched in them) | Long | mlb playoffs predictions | Sep–Oct | Highest seasonal volume window |
| 14 | Closing a playoff game: what the pressure does to you | Long | playoff pressure baseball | Oct | Unique closer credential |
| 15 | Grip short series: one pitch per short, 60s each | Shorts (8–10) | how to throw a [pitch] | Evergreen | Shorts-search now surfaces how-to queries |
| 16 | "Can a normal person hit 95 mph?" experiment | Long | hit a 95 mph fastball | Evergreen | Proven viral format in niche |
| 17 | AAA vs MLB: the real difference | Long | aaa vs mlb | Evergreen | Question-style, low competition |
| 18 | Bullpen secrets: what we talk about out there | Short → long | mlb bullpen | In-season | Curiosity hook, clippable |
| 19 | What I'd tell parents spending $$$ on travel ball | Long | travel baseball worth it | Feb–Mar | Parent search + contrarian angle |
| 20 | Weighted balls: do they work or wreck arms? | Long | weighted ball program | Nov–Jan | Debate keyword, both-sides authority |
| 21 | Reacting to my own MLB highlights (and failures) | Long | trevor may highlights | Evergreen | Owns branded search; low effort |
| 22 | Unwritten rules I broke (and paid for) | Long/short | baseball unwritten rules | In-season | Story-driven evergreen |
| 23 | Spring training day-in-the-life (what fans never see) | Long | mlb spring training | Feb–Mar | Seasonal + insider access |

**Re-rank rule after refresh:** promote any idea whose target keyword shows vidIQ overall score ≥ 60 (volume high, competition low); demote below-30 scores unless seasonal timing is <6 weeks away.

---

## 7. Competitor set to configure (currently empty in vidIQ)

The competitor list for `UCXnWH_cIChvXGhLPIJGoiBg` is empty. On refresh, resolve these candidates via `vidiq_channel_search` and follow 5–10 via `vidiq_update_competitors` so future outlier pulls have a benchmark set: Foolish Baseball, Baseball Doesn't Exist, Made The Cut, Fuzzy (Baseball), Jomboy Media, Eric Sim (King of JUCO), Antonelli Baseball, Tread Athletics, Driveline Baseball, Trevor Bauer / Momentum. (Candidates from niche knowledge — verify size/activity with live data before following.)

---

## 8. Refresh — exact calls to re-run (after 2026-07-25 credit reset)

Budget: ~26 five-credit calls = 130 credits (fits the 150 free-plan allowance; leave headroom).

1. `vidiq_user_channels` (0 cr) — confirm authorized channel(s); connect the second channel in vidIQ first if both are wanted.
2. `vidiq_get_channels_by_ids` — `{"channelIds":["UCXnWH_cIChvXGhLPIJGoiBg"]}` — resolve which channel is connected.
3. `vidiq_channel_search` — `{"handle":"@TrevorMayBaseball"}` and `{"channelTitle":"More Mayday"}` — resolve both channel IDs + niche metadata. (2 calls)
4. `vidiq_channel_stats` — both channel IDs, default 30d window. (2 calls)
5. `vidiq_channel_videos` — both channels, `videoFormat:"long", popular:true`, then `popular:false`; plus `videoFormat:"short", popular:true` for the shorts-heavy channel. (4–5 calls)
6. `vidiq_keyword_research` — `mode:"research", country:"US"` for P1/P2 seeds: `how to pitch faster`, `pitching grips`, `how to throw a slider`, `how to throw a changeup`, `increase pitching velocity`, `pitcher arm care`, `youth pitching drills`, `what mlb players do in the offseason`, `how much do mlb players make`, `mlb trade deadline`, `mlb playoffs predictions`, `tommy john surgery recovery`. (12 calls; each returns related keywords — mine those before spending more)
7. `vidiq_outliers` — `{"keyword":"pitching", "publishedWithin":"threeMonths", "minOutlierScore":3}` and `{"keyword":"mlb", "contentType":"short", "publishedWithin":"thisMonth"}`. (2 calls)
8. `vidiq_similar_channels` — `{"niche":"baseball pitching instruction and MLB insider content", "country":"US", "language":"en"}`. (1 call)
9. `vidiq_update_competitors` (0 cr) — follow the best 5–10 channels found in steps 7–8.
10. Fill every "—" cell in sections 3, re-rank section 6, update `data_pulled`/`last_updated`, and delete the DATA AVAILABILITY WARNING block once real numbers are in.

If credit-constrained, priority order: step 6 (keyword metrics) > step 5 (channel videos) > step 7 (outliers) > everything else.
