# TikTok per-post analytics capture

Local tool that grabs the deep per-video metrics TikTok won't let a Creator account
export — completion %, avg watch time, traffic-source split, demographics — by
listening to the JSON the TikTok Studio web app fetches while **you** click through
your own videos.

**Personal data, your own account, run on your Mac only.** Nothing goes to the cloud;
your login session stays in `.session/` (gitignored). Note TikTok's ToS discourages
automated access — this runs a real human-driven session at human pace to stay clean,
but it's your account and your call.

## One-time setup

Already done if Claude set this up. Otherwise:

```bash
cd tools/tiktok-scraper
npm install
npx playwright install chromium
```

## Capture a session (the normal way)

```bash
npm run capture
```

1. A Chromium window opens. **Log into TikTok** if it isn't already (first run only —
   the session persists after that).
2. Go to **Analytics → Content**, and open each video's analytics **one at a time**.
   Everything each page loads is captured automatically as you click — you don't touch
   the terminal.
3. **Two clicks per video:** after the Overview loads, also click the video's
   **Viewers** tab — that's the only thing that fires the follower/non-follower split,
   new-vs-returning %, and age/gender/location demographics. (Skip the Engagement tab:
   its data already arrives with the Overview payloads.)
4. When you've gone through the videos you want, return to the terminal and press
   **Ctrl-C**. The CSV is written on exit.

Take it slow and human — a few seconds per video. No need to rush.

## Output (all under `output/`, gitignored)

| File | What |
|---|---|
| `raw/<time>__<endpoint>.json` | Full intercepted payloads — the source of truth |
| `endpoints.log` | Every JSON endpoint URL seen, `CAPTURE` = saved |
| `captured-<runstamp>.csv` | Best-effort flattened metrics, union of all fields |

## Parse to a clean table

```bash
npm run parse
```

Reads everything in `output/raw/` and writes `output/videos-<time>.csv` — one row per
video with Ashley's scorecard columns: views / unique viewers / rewatch ratio, finish
rate + avg watch time (hold), shares+saves per 1k (amplify), new followers per 1k
(convert), follower vs non-follower split, traffic sources, demographics, and search
terms. It merges every capture session's raw files, so re-running after each session
gives you the freshest cumulative table. Videos missing Viewers-tab data are flagged.

The original `captured-<runstamp>.csv` (raw union of every field) still gets written on
Ctrl-C as the source-of-truth fallback. Phase 2 (per the plan): a Supabase push into
`content_items` so these metrics land in the app.

## Why there's no automated mode

We built one and removed it. TikTok's edge flags the *automated browser session* itself —
independent of how human the clicks are (real cursor paths, physical mouse events, randomized
pacing all still got the IP an "Access Denied"). Chasing it just burns IP reputation for no
real gain, and TikTok meters your own analytics back to you on purpose.

Manual capture is the supported path and it's genuinely quick: a couple of minutes covers
your recent videos, `parse.js` merges every session, so history accrues incrementally without
ever needing a bulk walk. Do a handful of videos whenever you think of it.
