# Ashley in Analytics — Implementation Spec

**Status:** approved for build (Trevor, 2026-07-14). Decisions locked (see §0).
**Author:** Carl (design consult) — spec grounded in the actual codebase, not assumptions.
**Scope of this doc:** DDL, prompt text, interface signatures, phasing. No production code.

This build surfaces an Ashley-style tactical read inside the Analytics page. It **clones the existing
`generate-weekly-report` pipeline** and **absorbs** the current Weekly Report wins/watch-outs/
recommendations block into one tactical voice, with each point carrying a "→ task / log as decision"
action.

---

## 0. Locked decisions (do not relitigate)

1. **Trigger:** AUTO weekly, piggybacking the Saturday `generate-weekly-report` cron; read stored as a
   VERSIONED row. Admin **Refresh** inserts a new working version; admin **Save** pins a version
   (freezing its action state). **Never fire Claude on page mount.**
2. **Scope: YouTube + TikTok, three DISTINCT surfaces:**
   - **`yt_long`** — full CTR × AVD × retention × new/returning diagnostics.
   - **`yt_short`** — YouTube Shorts, its own short-form read (views/velocity/subs-per-view; **no CTR**
     — Shorts have no impressions/CTR in `analytics_youtube_daily`, that is channel-level daily).
   - **`tiktok`** — reach/engagement ONLY (views / followers / likes / shares). **NO CTR, NO AVD, NO
     retention.** Ashley must not fabricate TikTok retention. Reads = shares-per-reach, outlier
     multiple, follower conversion.
3. **Voice:** Ashley **absorbs** the existing `wins / watch_outs / recommendations` narrative block —
   ONE tactical voice. The three-column `NarrativeBlock` row in `WeeklyReport.js` is **replaced** by the
   Ashley points list (see §5).
4. **Action:** INSIGHT → ACTION. Every point carries a button that either (a) creates a `tasks` row via
   the existing `assign-task` edge fn, or (b) creates a `bd_tasks` row under a chosen initiative
   ("log as decision"). Data model leaves room from day one (§3 `action_*` fields).

---

## 1. The pattern being cloned (verified)

`supabase/functions/generate-weekly-report/index.ts` is the exact template. Verified facts:

- **Auth (lines 189–208):** cron path via `CRON_SECRET` — accepts `?secret=`, `X-Cron-Secret` header,
  or `Authorization: Bearer <cron_secret>`. Admin path via JWT → `profiles.role === 'admin'`. Rejects
  otherwise (401).
- **Model (line 28):** `const MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6";` — reuse
  verbatim.
- **Claude call (lines 76–129):** direct `fetch` to `https://api.anthropic.com/v1/messages`,
  `x-api-key: ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`, `max_tokens`, single user message,
  one retry with 3s backoff, regex-extract the JSON object `text.match(/\{[\s\S]*\}/)`.
- **Aggregation:** reads `platform_accounts`, `platform_daily_metrics`, `audience_snapshots`,
  `revenue_events`, `analytics_youtube_daily`, `content_items` + `content_metrics`,
  `tracking_post_goals`. PT-day bucketing via `ptDayString` for timestamptz columns. Week window =
  Sat..Fri; also computes prev-7d and trailing-28d baselines with `pctChange`/`delta` helpers.
- **Storage (lines 500–511):** upsert into `weekly_reports` on `week_start` conflict; `data` (jsonb) +
  `narrative` (jsonb).
- **Notify path (lines 513–553):** only on cron-first-generation or `body.send === true`.
- **Cron (migration `20260624000001_cron_weekly_report.sql`):** `cron.schedule('generate-weekly-report',
  '0 15 * * 6', …net.http_post(url, X-Cron-Secret from vault.decrypted_secrets 'cron_secret', body '{}'))`.
- **Deploy:** `supabase functions deploy generate-weekly-report --no-verify-jwt`.

**Design choice — separate function, not extend:** build a NEW `generate-ashley-read` edge fn rather
than bolting Ashley onto `generate-weekly-report`. Reasons: (a) different aggregation shape (per-surface
diagnostics vs. money/cadence), (b) the Ashley Refresh button must regenerate the read WITHOUT re-sending
the weekly email, (c) failure isolation — a Claude timeout on Ashley must not block the KPI snapshot the
weekly report already produces reliably.

---

## 2. Source tables & columns Ashley reads (verified names)

All columns below are confirmed against `constants.js` `AVAILABLE_METRICS`, `generate-weekly-report`,
`PlatformView.js`, `FormatPerformance.js`, `BestPostTimes.js`, and migration grep.

### 2.1 `analytics_youtube_daily` (channel-level daily; keyed by `platform_account_id`, also `channel_id`)
Columns used: `date`, `platform_account_id`, `impressions`, `impressions_ctr`, `watch_time_hours`,
`average_view_duration`, `average_view_percentage`, `subscribers`, `subscribers_gained`,
`subscribers_lost`, `unique_viewers`, `new_viewers`, `returning_viewers`, `views`,
`estimated_revenue`, `ad_revenue`, `cpm`, `rpm`.
→ **`yt_long` surface** uses `impressions`, `impressions_ctr`, `average_view_percentage`,
`average_view_duration`, `watch_time_hours`, `new_viewers`, `returning_viewers`, `subscribers_gained`.
CTR only becomes non-null when the monthly YouTube Studio CSV is uploaded (`YouTubeCSVUpload.js`) — the
prompt must treat null CTR as "not measured this period," never invent it.

### 2.2 `platform_daily_metrics` (per-account per-day; used for TikTok reach/engagement)
Columns: `platform_account_id`, `date`, `views`, `likes`, `comments`, `shares`.
Engagement = `likes + comments + shares` (matches `engOf` in weekly-report line 245).
→ **`tiktok` surface** reach/engagement source.

### 2.3 `audience_snapshots` (followers)
Columns: `platform_account_id`, `date`, `followers_total`, `followers_gained`.
→ follower totals + gained per surface (TikTok follower conversion; YT subs cross-check).

### 2.4 `content_items` + `content_metrics` (per-post → outlier multiples, format splits)
- `content_items`: `id`, `title`, `url`, `platform_account_id`, `published_at` (timestamptz, PT-bucketed),
  `content_type`.
- `content_metrics`: `content_item_id`, `captured_at`, `views`, `likes`, `comments`, `shares`,
  `engagement_rate`. Use LATEST snapshot per item (weekly-report lines 375–393).
- **Format derivation (`utils.deriveFormat`):** `content_type === 'short'` → Shorts;
  `'video'`/`'long'` → Long-form; `'podcast'` → Podcast; `'article'`/`'editorial'` → Editorial;
  `'stream'`/`'vod'` → Streams. This is how a YouTube item is split into `yt_long` vs `yt_short`.
- **`content_type` is authoritative for the YT split (DB-verified 2026-07-14, project
  ytfjkoxowfskuibdsfea):** 586 `short` / 538 `video`, populated on all YouTube items. **Split purely on
  `content_type`** — `'video'` → `yt_long`, `'short'` → `yt_short`. **Do NOT add a duration fallback:**
  only 239 of 586 Shorts are ≤60s; the other 347 are legitimate 61–180s new-format Shorts, and a 60s
  cutoff would misclassify them as long-form.
- **Outlier multiple** = item views ÷ trailing median of the last N same-surface items (Ashley's
  `outlier_score`; her band: 2x noteworthy, 3x+ significant, 20x+ fluke — see
  `Ashley/audit/*` and `organic-marketing/12-analytics-experimentation.md §7`).

### 2.5 Best-post-times (already computed client-side)
`BestPostTimes.js` reads `content_items(platform_account_id, published_at, latest_metrics:content_metrics(views))`
and buckets by PT daypart. The edge fn re-derives the same dayparts server-side (median views per
daypart per surface) so Ashley can say "your Shorts land best 6–9pm PT."

**Surface → account mapping:** resolve via `platform_accounts.platform`. YouTube channels
(More Mayday, Trevor May Baseball) are `platform='youtube'`; split each channel's items into `yt_long`
/ `yt_short` by `content_type` (§2.4). TikTok = `platform='tiktok'` (IamTrevorMay). Pass account
`account_name` so Ashley names the channel.

**TikTok is ACCOUNT-LEVEL ONLY (DB-verified 2026-07-14):** `content_items` has ZERO TikTok rows, and
there is NO TikTok per-post table in Postgres (the "TikTok per-post analytics capture tool" is the
local file-based `tools/tiktok-scraper/`, not wired to the DB). Therefore the `tiktok` surface **cannot**
compute a per-video outlier multiple, per-post ranking, or any per-video read in-app. TikTok is sourced
entirely from `platform_daily_metrics` (account-level daily). `shares` IS stored there (verified — used
by `generate-weekly-report` line 240: `select … views, likes, comments, shares`), so shares-per-reach is
computable.

---

## 3. Data model — `ashley_reads` table (VERSIONED reads + explicit Save)

**Decision: NEW table `ashley_reads`, not reuse `weekly_reports`.** Justification: the read is
per-surface + per-point with per-point action targets; jamming that into `weekly_reports.narrative`
(one row/week, single jsonb blob) blocks the action-linking data model, couples Ashley's lifecycle to
the KPI report, and prevents an admin Refresh from regenerating Ashley without touching the KPI row.

**Decision (Trevor): VERSIONED reads, NOT upsert-one-row-per-week.** `ashley_reads` keeps MULTIPLE rows
per `week_start`, versioned — mirroring the existing `script_review_versions` pattern (see migration
`20260620130000_script_review_versions_unique.sql`: unique `(parent_id, version_number)`, next version
computed by read-max-then-insert, loser retries on 23505). Refresh = INSERT a new working version, never
overwrite. A "Save" button pins a version (`is_saved = true`), freezing its per-point action state.
So actioning a point and then hitting Refresh can NEVER destroy the actioned read — Save it and the fresh
working version spins up alongside it. Points live in the `points` jsonb array with `action_*` fields
reserved from day one.

**Migration filename:** `supabase/migrations/20260715000000_ashley_reads.sql`
(bump the date if a later migration already claims it; keep it after `20260624000001`).

```sql
-- Ashley analytics reads. VERSIONED — many rows per week_start; Refresh inserts a
-- new working version, never overwrites. `points` holds the tactical, per-surface
-- diagnostics as a JSON array; each point carries a benchmark date-stamp and
-- reserved action-target fields so a point can be turned into a task or logged as
-- a Business Dev decision. "Save" (is_saved=true) pins a version and freezes its
-- per-point action state so a later Refresh can't clobber an actioned read.
create table if not exists public.ashley_reads (
  id             uuid primary key default gen_random_uuid(),
  week_start     date not null,
  week_end       date not null,
  version_number int not null,           -- 1-based, per week_start (see unique index)
  is_saved       boolean not null default false,  -- pinned by admin "Save"
  label          text,                   -- optional human label for a saved version
  -- Which surfaces this read covers, e.g. ['yt_long','yt_short','tiktok'].
  surfaces       text[] not null default '{}',
  headline       text,                   -- one punchy sentence for the whole week
  -- points: array of objects — schema below (§4.4). Kept as jsonb (not a child
  -- table) because points are read/rendered as a unit and never queried individually.
  points         jsonb not null default '[]'::jsonb,
  -- coverage/quality flags so the UI can render honesty banners like weekly-report.
  meta           jsonb not null default '{}'::jsonb,  -- { generation_failed?, ctr_available?, data_completeness_pct }
  model          text,                   -- CLAUDE_MODEL used, for auditability
  generated_by   text not null default 'cron' check (generated_by in ('cron','admin')),
  generated_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- Unique version per week — mirrors script_review_versions_review_version_uniq.
-- Next version_number is computed read-max-then-insert; the racing loser fails
-- with 23505 and the caller recomputes + retries (see edge-fn storage-write §4.5).
create unique index if not exists ashley_reads_week_version_uniq
  on public.ashley_reads (week_start, version_number);

-- Fast "latest working version for this week" and "saved versions" lookups.
create index if not exists ashley_reads_week_idx
  on public.ashley_reads (week_start, version_number desc);
create index if not exists ashley_reads_saved_idx
  on public.ashley_reads (week_start) where is_saved;

alter table public.ashley_reads enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'ashley_reads_admin_all' and tablename = 'ashley_reads'
  ) then
    create policy "ashley_reads_admin_all" on public.ashley_reads
      for all using (
        exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      );
  end if;
end $$;
```

**Version selection semantics (used by edge fn + frontend):**
- **Latest working read** for a week = row with MAX `version_number` for that `week_start`. Shown by default.
- **Refresh** = INSERT `version_number = (max for week) + 1`, `generated_by='admin'`, `is_saved=false`.
- **Cron** = INSERT the next version too (usually version 1 for a fresh week), `generated_by='cron'`.
- **Save** = UPDATE the selected version `set is_saved=true` (+ optional `label`). Saved versions persist
  with frozen `points`/`action_*`. A version picker lists saved versions + the current working one.

**Per-point action bookkeeping — NO new column needed; store on the point object.** When a point is
actioned, the frontend PATCHes the `points` jsonb of THAT version writing `action_status`, `action_type`,
`action_target_id`, `action_at` back into the point. Because reads are versioned + Save-pinned, action
state is durable: it lives on a specific version and a later Refresh creates a NEW row rather than
overwriting. Reserved point fields are defined in §4.4.

**RLS:** admin-only, identical grammar to `weekly_reports` (verified pattern). Ashley reads are
admin-tier; no member/agency access. Do NOT add to `supabase_realtime` publication — the frontend
fetches on tab open + after Refresh/Save; no live subscription needed (matches WeeklyReport, which polls
nothing and just refetches).

---

## 4. Edge function — `generate-ashley-read`

**Path:** `supabase/functions/generate-ashley-read/index.ts`
**Deploy:** `supabase functions deploy generate-ashley-read --no-verify-jwt`

### 4.1 Auth (clone weekly-report lines 189–208 verbatim)
- Cron: `CRON_SECRET` via `?secret=`, `X-Cron-Secret`, or `Authorization: Bearer <cron_secret>`.
- Admin: JWT → `profiles.role === 'admin'`.
- Else 401.
- Set `generated_by = isCron ? 'cron' : 'admin'`.

### 4.2 Input & window
- Body (optional): `{ week_start?: "YYYY-MM-DD" }`. Same window math as weekly-report (lines 214–225):
  default `week_end = yesterday`, `week_start = week_end - 6`. prev-7d + trailing-28d baselines for
  outlier/velocity context.
- No `send` param — Ashley never emails. (Notifications are optional Phase-later; see §7.)

### 4.3 Per-surface aggregation (build a `summary` object, one block per surface)

Reuse weekly-report's fetch+bucket helpers (`inRange`, `ptDayString`, `pctChange`, latest-metric-per-item).

```
summary = {
  window: { week_start, week_end, prev_start, prev_end, base_start, base_end },
  yt_long:  <SurfaceBlock>,   // per YouTube channel, long-form items + channel-daily CTR/AVD
  yt_short: <SurfaceBlock>,   // per YouTube channel, Shorts items (deriveFormat==='Shorts')
  tiktok:   <SurfaceBlock>,   // reach/engagement only
}
```

`SurfaceBlock` (fields differ by surface — omit what the coverage doesn't allow):

- **`yt_long`** (per channel): `channel`, `views`, `views_wow`, `watch_hours`,
  `impressions` (nullable), `ctr` (nullable — from `impressions_ctr`, avg), `avg_view_pct` (nullable),
  `avg_view_duration_s` (nullable), `subs_gained`, `new_viewers`, `returning_viewers`,
  `new_vs_returning_ratio`, `top_items:[{title,url,views,outlier_multiple,engagement_rate,published_at}]`,
  `median_views`, `best_dayparts_pt`.
- **`yt_short`** (per channel): `channel`, `views`, `views_wow`, `subs_gained`,
  `subs_per_1k_views`, `top_items:[{title,url,views,outlier_multiple,likes,comments,shares,published_at}]`,
  `median_views`, `best_dayparts_pt`. **No CTR/AVD/retention.**
- **`tiktok`** (ACCOUNT-LEVEL ONLY — no per-post data exists, §2.4): `account`, `views`, `views_wow`,
  `followers_total`, `followers_gained`, `likes`, `comments`, `shares`,
  `shares_per_1k_reach` (shares ÷ views × 1000), `follower_conv_per_1k_views`
  (followers_gained ÷ views × 1000). Sourced from `platform_daily_metrics` (reach/engagement) +
  `audience_snapshots` (followers). **NO `top_items`, NO per-post outlier multiple, NO per-video read,
  NO best-dayparts (no per-post timestamps), NO CTR/AVD/retention.**

Compute a `data_completeness_pct` per weekly-report lines 433–444 (expected account-days vs actual) and a
per-surface `ctr_available` boolean (any non-null `impressions_ctr` in window). Put both in `meta`.

### 4.4 Structured output JSON (Claude must return exactly this)

```json
{
  "headline": "one punchy sentence on the week across surfaces",
  "points": [
    {
      "surface": "yt_long | yt_short | tiktok",
      "severity": "win | watch | fix",
      "title": "one-line, ≤120 chars — the glanceable level-1 point",
      "detail": "2–4 sentences — the why + the specific fix (level-2 expand)",
      "metric": "e.g. 'CTR 3.1% (band 4–8%)'  — the number(s) this rests on, or null",
      "source_doc": "Ashley brain doc that grounds it, e.g. 'youtube-longform/02-titles'",
      "benchmark_date": "2026-07-12",
      "suggested_action": {
        "kind": "task | decision",
        "task_title": "actionable imperative, e.g. 'Rewrite TMB title to name a player + add overlay'",
        "task_notes": "context for the assignee",
        "link_url": "content_items.url of the post in question, or null"
      }
    }
  ]
}
```

Frontend augments each point at action-time with reserved fields (written back into `points`):
`action_status` (`'none'|'tasked'|'logged'`), `action_type` (`'task'|'decision'`),
`action_target_id` (the created `tasks.id` or `bd_tasks.id`), `action_at`.

**Limits:** 8–10 points max total, ≤4 per surface. If a surface has no publishable data, emit ONE `watch`
point saying so honestly (never pad). For `tiktok` points, `suggested_action.link_url` is always null
(no per-post URLs exist) and `metric` cites only account-level numbers.

### 4.5 Storage write — INSERT a new version (never upsert/overwrite)
1. Compute next version: `select max(version_number) from ashley_reads where week_start = wkStart`
   (null → 0); `next = max + 1`.
2. INSERT `{ week_start, week_end, version_number: next, is_saved: false, surfaces, headline, points,
   meta, model: MODEL, generated_by, generated_at: now() }`.
3. **Race guard (mirrors `script_review_versions`):** the unique `(week_start, version_number)` index
   makes a concurrent second insert fail with **23505**; on that error, recompute `max` and retry the
   insert (bounded, e.g. 3 attempts). This is the same read-max-then-insert-retry the script-review
   flow uses.
On Claude failure: still INSERT a version with `points: []` and `meta.generation_failed = true` so the UI
shows the "AI unavailable" banner (mirrors weekly-report `narrative_failed`, WeeklyReport.js line 161) —
a failed working version is expected and gets superseded by the next Refresh.

---

## 5. Prompt design

### 5.1 System prompt assembly (concatenate at fn start; cache as a module const)
Concatenate, in order:
1. `Ashley/ASHLEY.md` (persona — voice, funnel, "numbers over adjectives", date-stamp benchmarks).
2. `Ashley/README.md` (brain index — so she cites doc names correctly).
3. **These specific brain docs** (the ones that ground THESE surfaces):
   - `Ashley/applied/youtube-longform-playbook.md` (yt_long benchmarks, title/thumbnail/CTR rules)
   - `Ashley/youtube-shorts/03-shorts-channel-strategy-funnel.md` (yt_short subs-per-view funnel)
   - `Ashley/cross-platform/06-shortform-analytics-benchmarks.md` (short-form king metrics, benchmark bands)
   - `Ashley/tiktok/01-algorithm-distribution.md` (tiktok signal weights, shares/completion)
   - `Ashley/audit/more-mayday-channel-audit.md` + `Ashley/audit/trevor-may-baseball-channel-audit.md`
     (the actual channel baselines/outlier multiples)
4. `Carl/context/mayday-context.md` (business ground truth — the channels, the athlete-creator lane).

> **Bundling note:** edge functions can't read repo files at runtime. Vendor these docs into the fn dir
> (`supabase/functions/generate-ashley-read/brain/*.md`) and `import`/inline them at deploy, OR bake the
> concatenated string into a `const ASHLEY_SYSTEM` at build. Keep a comment pointing back to the source
> paths so the brain and the vendored copy don't silently diverge. (See §8 gotcha.)

### 5.2 System prompt hard rules (append verbatim after the docs)

```
You are Ashley producing this week's tactical Analytics read for Mayday Media.
You are given a JSON summary of THIS WEEK's data for specific surfaces. Rules:

COVERAGE — never exceed the data:
- yt_long: you MAY diagnose CTR, average_view_percentage/duration (retention), watch time,
  new-vs-returning mix — but ONLY when the value is present (non-null). If ctr is null, say
  "CTR not measured this period (upload the YouTube Studio CSV)" — NEVER estimate or invent it.
- yt_short: YouTube Shorts. You have views, velocity, subs-gained, subs-per-1k. You do NOT have
  CTR, AVD, or a retention curve for Shorts. Do not claim any.
- tiktok: ACCOUNT-LEVEL reach/engagement ONLY — total views, followers + follower delta, likes,
  comments, shares, shares-per-reach, follower conversion. You have NO per-post/per-video TikTok data
  in this app: NO per-video outlier multiples, NO top-post ranking, NO best posting times, and NO
  CTR / AVD / retention / watch-time. Diagnose TikTok at the account level only (is reach growing, is
  engagement converting to followers, is share rate healthy vs benchmark). If you catch yourself about
  to name a specific TikTok video, cite a per-video number, or mention TikTok retention/CTR, delete it.

GROUNDING:
- Every quantitative claim cites the actual number from the summary.
- Compare every number to a benchmark from your brain docs and STATE THE BENCHMARK's date in
  `benchmark_date` (platform mechanics age fast; a reader in 2027 must know when this was true).
- `source_doc` = the brain doc that grounds the point.
- Outlier multiple = item views ÷ trailing median for that surface. Bands: 2x noteworthy, 3x+
  significant, 20x+ likely a fluke — don't build advice on 20x+.

VOICE & SHAPE:
- title = one glanceable line. detail = the why + the specific fix (a rewrite, a format, a time).
- Packaging-first, platform-native, diagnosed on click→hook→hold→payoff (only the stages the data
  supports per surface).
- 8–10 points max, ≤4 per surface. If a surface is data-sparse, say so in ONE point. No padding.
- Every point's suggested_action must be a concrete next step someone could do this week.

OUTPUT: return ONLY the JSON object in the schema provided. No prose outside it.
```

### 5.3 User prompt skeleton
```
Here is this week's data. Produce the read.

<<< JSON summary from §4.3 >>>

Coverage flags: ctr_available per surface = {...}; data_completeness_pct = NN.
Return ONLY the JSON object.
```

---

## 6. Cron — piggyback the Saturday job

**Decision: a SECOND cron job, same schedule**, not appending to the weekly-report job body.
Rationale: keeps failure isolation (§1) — if Ashley's HTTP post errors it doesn't affect the weekly
report's post — and lets the two evolve independently. Same `0 15 * * 6` (Sat 8am PT) so Ashley's read
is ready alongside the KPI report.

**Migration:** `supabase/migrations/20260715000100_cron_ashley_read.sql`
```sql
-- Generate Ashley's tactical Analytics read every Saturday 15:00 UTC (8am PT),
-- alongside generate-weekly-report. Same vault cron_secret / X-Cron-Secret pattern.
select cron.schedule(
  'generate-ashley-read',
  '0 15 * * 6',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/generate-ashley-read',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$$
);
```
(URL is the same project ref used by the verified weekly-report cron migration.)

---

## 7. Frontend changes

### 7.1 What changes in `WeeklyReport.js` (the absorption)
Ashley absorbs the narrative block. Concretely:

- **REMOVE** the three-column `NarrativeBlock` row (lines 178–186: `Wins / Watch-outs / Recommendations`).
- **KEEP** everything else in `ReportBody` (completeness badge, KPI cards, audience/reach/revenue/cadence,
  top/bottom content, generated-at).
- **KEEP** `n.headline` render (line 167) — but source it from the Ashley read's `headline` if present,
  else fall back to the weekly `narrative.headline`.
- **INSERT** a new `<AshleyRead />` component where the narrative row was (directly under the KPI grid,
  above the two-column audience/reach cards). This is Ashley's home — one tactical band, the primary
  surface.

`NarrativeBlock` (lines 40–54) can be deleted once no longer referenced, OR kept and reused as the
list-item renderer inside `AshleyRead` for grammar consistency. Prefer reuse: it already renders a
`●`-bulleted list in the app's grammar.

### 7.2 New component `src/pages/analytics/components/AshleyRead.js`

Interface (signatures only):
```
function AshleyRead({ weekStart })   // weekStart from the selected weekly report, to align windows
  // state: versions (ashley_reads rows for this week), selectedId, loading, refreshing, saving,
  //        expandedIdx (which point is open)
  // fetchVersions(): supabase.from('ashley_reads').select('*')
  //   .eq('week_start', weekStart).order('version_number', { ascending: false })
  //   → default select = the latest (versions[0]); a picker lists saved versions + the latest working one
  // handleRefresh(): callEdgeFn('generate-ashley-read', { week_start: weekStart }) then refetch;
  //   auto-select the newly inserted (now-latest) version  [admin only]
  // handleSave():  supabase.from('ashley_reads').update({ is_saved: true /*, label */ })
  //   .eq('id', selectedId) then refetch  [admin only]
  // actionPoint(idx, patch): update the SELECTED version's points[idx] with action_* fields (§7.3),
  //   then PATCH ashley_reads.points for that row
```

**Render — 2-level disclosure (hard cap at 2, per Carl progressive-disclosure doc):**
- Header row: "▸ Ashley — this week's read" + **version indicator**:
  - a compact picker/select of this week's versions labeled `v{n} · {saved ✓ label | working}` +
    `generated_at`, defaulting to the latest; selecting a saved version shows its frozen read.
  - freshness chip (stale flag if the selected version's `generated_at` is older than `week_end + 2d`).
  - admin-gated **Save** button — pins the selected version (`is_saved=true`); shows "✓ Saved" when
    already saved. (Save-then-Refresh is the safe path for an actioned read.)
  - admin-gated **Refresh** button (mirror WeeklyReport's `isAdmin && <button>` at lines 110–114; label
    "Refreshing…"/"Refresh") — inserts a NEW working version and selects it; existing versions untouched.
- Points list, grouped by `surface` with a small surface label chip (`YT Long` / `YT Shorts` / `TikTok`),
  colored by `severity` (win `#34d399`, watch `#fbbf24`, fix `#f87171` — reuse WeeklyReport delta colors).
  - **Level 1:** `point.title` + `point.metric` inline, one line. A `[▼]` affordance.
  - **Level 2 (click to expand — only one open at a time):** `point.detail`, then a footer line:
    `source_doc · benchmark {benchmark_date}` in muted text, then the **action button** (§7.3).
- **States:**
  - loading → `styles.loadingText` "Loading Ashley's read…" (reuse WeeklyReport pattern line 91).
  - empty (`!read`) → muted "No read yet. Generates Saturday, or click Refresh." (admin) / plain (non-admin).
  - `meta.generation_failed` → amber banner "Ashley's read was unavailable for this week." (mirror
    `narrative_failed` banner, line 161).
  - stale → small "⟳ data may be newer than this read" hint next to freshness chip.

Use inline-style objects + tokens per house convention (`src/lib/styleTokens.js`/`styleRecipes.js`);
match `WeeklyReport.js` `styles` object at file bottom. No Tailwind.

### 7.3 The per-point action button (INSIGHT → ACTION)

Each expanded point shows a split control:

**"→ Task"** (default; `suggested_action.kind === 'task'`): opens a tiny inline confirm (assignee select
defaulting to current admin, editable title prefilled from `suggested_action.task_title`, optional
due date), then calls the EXISTING edge fn:
```
callEdgeFn('assign-task', {
  op: 'create',
  title: <task_title>,
  assignee_ids: [<selectedProfileId>],
  notes: <task_notes + ' — via Ashley (' + surface + ')'>,
  due_date: <optional>,
  link_url: <suggested_action.link_url || null>,   // "Go To Work" button on the task card
})
```
`assign-task` (verified, lines 46–114) inserts a `tasks` row (`workflow_instance_id: null`,
`status: 'active'`, `link_url`, `created_by`, notifies assignee) and returns `created_task_ids`. On
success, write back into the point: `action_status:'tasked'`, `action_type:'task'`,
`action_target_id: created_task_ids[0]`, `action_at: now`, and PATCH the `ashley_reads.points` jsonb.

**"⚑ Log as decision"** (`kind === 'decision'` or user toggles): creates a `bd_tasks` row under an
initiative the admin picks. `bd_tasks` (verified DDL, migration `20260503000000_create_business_dev.sql`,
lines 79–94) has **no edge fn** — it's a direct RLS-guarded insert (admin-only policy). Insert:
```
supabase.from('bd_tasks').insert({
  initiative_id: <selected bd_initiatives.id>,   // admin picks from a dropdown of active initiatives
  title: <task_title>,
  notes: <task_notes + ' — logged from Ashley Analytics read, week ' + week_start>,
  owner_id: <current admin>,
  due_date: <optional>,
  // tag: null → inherits initiative tag
})
```
On success: write back `action_status:'logged'`, `action_type:'decision'`,
`action_target_id: <bd_tasks.id>`, `action_at`.

**After action:** the point renders "✓ Tasked" / "✓ Logged" with a link to the target (task card / BD
initiative) instead of the button. Idempotency guard: disable the button while `action_status !== 'none'`.

> The `bd_tasks` dropdown needs a lightweight fetch of active `bd_initiatives` (id, title, workstream)
> — admin RLS already allows it. If none exist, the "Log as decision" path is disabled with a tooltip
> "Create a Business Dev initiative first."

### 7.4 Analytics.js wiring
No new tab. `<AshleyRead weekStart={...} />` is rendered by `WeeklyReport.js`'s `ReportBody`, so it rides
the existing `weekly` view (`usePersistedTab('analytics-view', … ['dashboard','compare','weekly',…])`,
Analytics.js line 129). Nothing changes in the tab list. `WeeklyReport` already selects a week and knows
`report.week_start` — pass it down.

---

## 8. Phasing (each step independently shippable)

1. **Schema** — migration `20260715000000_ashley_reads.sql`. Ship alone; creates table + RLS. Verifiable
   via a manual insert.
2. **Edge fn** — `generate-ashley-read` with aggregation + prompt + storage. Deploy
   `--no-verify-jwt`. Testable by admin-JWT POST; writes an `ashley_reads` row. (Frontend not required.)
3. **Cron** — migration `20260715000100_cron_ashley_read.sql`. Independently shippable once the fn is
   deployed; verify with `select * from cron.job where jobname='generate-ashley-read'`.
4. **Frontend render** — `AshleyRead.js` + the `WeeklyReport.js` absorption (remove narrative row, insert
   component). Read-only display + version picker + Refresh + Save buttons. Ship BEFORE action wiring —
   shows Ashley's read (and versioning) even if action buttons are stubbed/disabled.
5. **Action wiring** — the "→ Task" (`assign-task`) and "⚑ Log as decision" (`bd_tasks` insert) buttons +
   write-back into the selected version's `points`. Ship last; each button independently. (Versioning
   from step 4 already guarantees actioned reads survive Refresh once Saved.)

Recommended order to demo value fastest: 1 → 2 → 4 (render) → 3 (cron) → 5 (actions).

---

## 9. Open risks / gotchas (found while reading the code)

1. **Edge fns can't read `/Ashley` at runtime.** The brain docs must be VENDORED into the function
   directory (or baked into a const at deploy). This creates a divergence risk: update a brain doc,
   forget to re-vendor, Ashley cites stale benchmarks. Mitigation: a comment block listing source paths +
   a note in `Ashley/README.md` maintenance section; consider a small `scripts/sync-ashley-brain.sh` that
   copies the §5.1 doc set into the fn dir before deploy. **This is the single biggest maintenance trap.**

2. **CTR is frequently null.** `analytics_youtube_daily.impressions_ctr` only populates from the manual
   monthly YouTube Studio CSV (`YouTubeCSVUpload.js`). Most weeks CTR will be absent. The prompt handles
   this (say "not measured"), but expect `yt_long` reads to lean on retention/AVD/views more than CTR
   until the CSV habit is regular. Surface `meta.ctr_available` so the UI can hint "upload CSV for CTR."

3. **RESOLVED (DB-verified 2026-07-14) — YT long/short split trusts `content_type`.** 586 `short` /
   538 `video`, `content_type` populated on all YouTube items. Split purely on `content_type`
   (`'video'` → yt_long, `'short'` → yt_short). **No duration fallback** — 347 of 586 Shorts are
   legit 61–180s new-format Shorts, so a ≤60s cutoff would misclassify them as long-form. Not a risk.

4. **RESOLVED — versioned reads + Save (Trevor's model), replaces the old upsert-overwrite risk.**
   `ashley_reads` keeps versioned rows per `week_start`; Refresh INSERTs a new working version and never
   overwrites, and Save (`is_saved=true`) pins a version with its per-point `action_*` state frozen. So
   actioning a point then Refreshing cannot destroy the actioned read — it lives on its own version.
   Build note: default view = latest version; encourage Save before Refresh on any actioned read (the UI
   can nudge). No fuzzy-merge or block-Refresh workaround needed.

5. **`bd_tasks` has no edge fn** — it's a direct client insert under admin RLS. That's fine (admin-only
   page), but it means the "log as decision" path is client-trust for `owner_id`/`created_by`. RLS
   `with check (is_admin(auth.uid()))` gates it; acceptable. No BEFORE-INSERT trigger forces
   `created_by` (unlike `agency_comments`), so set it client-side.

6. **`tasks` table columns referenced by `assign-task` beyond the base DDL** — `assign-task` inserts
   `due_date`, `link_url`, `nav_target`, `created_by`, which are added by later migrations
   (`link_url` confirmed in `20260601100000_create_automations.sql`). `assign-task` is live and working,
   so these columns exist in the deployed DB — but the base `tasks` DDL in `20260528000000_workflow_system.sql`
   does NOT list them. Don't be alarmed reading the base migration; trust the running `assign-task`
   contract, which is the authoritative interface for task creation.

7. **Model default `claude-sonnet-4-6`** (weekly-report line 28) is correct for this — structured
   summarization against provided context, not deep reasoning. Reuse `CLAUDE_MODEL` env so a global
   model bump carries over. Don't hardcode a different model.

8. **No realtime needed** — do NOT add `ashley_reads` to `supabase_realtime`. Fetch on tab open + after
   Refresh. Matches WeeklyReport (which doesn't subscribe).
```
