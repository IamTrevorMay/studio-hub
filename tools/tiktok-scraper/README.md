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
3. When you've gone through the videos you want, return to the terminal and press
   **Ctrl-C**. The CSV is written on exit.

Take it slow and human — a few seconds per video. No need to rush.

## Output (all under `output/`, gitignored)

| File | What |
|---|---|
| `raw/<time>__<endpoint>.json` | Full intercepted payloads — the source of truth |
| `endpoints.log` | Every JSON endpoint URL seen, `CAPTURE` = saved |
| `captured-<runstamp>.csv` | Best-effort flattened metrics, union of all fields |

## First run is recon

The CSV is auto-built by unioning every field in the captured payloads, so on the first
real run it may be wide and messy. Hand `output/raw/` + `endpoints.log` back to Claude —
once we see TikTok's actual payload shape, the parser gets tightened to clean columns
(Ashley's scorecard: hook / hold / amplify / convert) and, per the plan, a Supabase push
into `content_items` gets added as phase 2.

## `--auto` (experimental)

```bash
npm run auto
```

Attempts to walk the Content list itself. Best-effort — the selectors may need tuning
after we've seen the live DOM. Use `npm run capture` (human-driven) until auto is proven.
