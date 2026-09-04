# Harbor NAS Archiver (Phase 4)

Moves ended Harbor sessions' recordings off Supabase Storage onto the NAS,
then purges the Supabase chunk objects. Supabase = capture buffer; the NAS
(`ASSETS_ROOT`, default `/Volumes/May Server`) = permanent home.

Runs **inside the api/ Express process on the always-on Mac** — the only
machine that can write the volume. It is a no-op everywhere else.

## Enable it (always-on Mac only)

Add to `api/.env`:

```
HARBOR_ARCHIVE_ENABLED=1        # opt-in — without it the poller never starts
HARBOR_ARCHIVE_DIR=Harbor       # folder under ASSETS_ROOT (default: Harbor)
HARBOR_ARCHIVE_POLL_MS=300000   # poll interval, default 5 min (min 60s)
ASSETS_ROOT=/Volumes/May Server # already set for the nas routes
CLOUD_API_KEY=...               # already set — also gates /api/harbor/archive-status
# SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must already be present
```

Then **restart the API process** (`node api/server.js` / however it's
daemonized) — the archiver starts with the server. `ffmpeg` on PATH is
optional but recommended (`brew install ffmpeg`, already required by
Post-Show): with it, archived files are remuxed `-c copy` (clean
duration/seek metadata for Premiere); without it, raw chunk concat (still a
valid playable file). Never transcodes.

## Verify it's running

- Boot log: `[Harbor] archiver started: root=... poll=300s grace=6h`
  (or `[Harbor] archiver disabled ...` if the env flag is missing).
- `GET /api/harbor/archive-status` with `Authorization: Bearer <CLOUD_API_KEY>`
  → archiver config, last-tick summary, recent ended sessions + track states.
- Dry run (read-only, prints the plan for current DB state):
  `node api/harbor/archiver.js --dry-run`
- One manual real tick: `node api/harbor/archiver.js --once`
  (requires `HARBOR_ARCHIVE_ENABLED=1`).

## State machine

A session is a candidate when `status='ended'`, `archived_at IS NULL`, and
`ended_at` is older than the **6h upload grace** (same constant as
`harbor-track`'s `ENDED_GRACE_MS` — a guest flush may run that long).

Per track:

```
complete   → archived   chunks → <yyyy-mm-dd PT> <title>/<name>-<kind>-<id8>.<ext>,
                        remux/concat, verify (contiguous chunks + size ≥ 95%
                        of bytes_uploaded), then chunks purged from the bucket
complete   → failed     verify shortfall: file kept on NAS for forensics,
                        nas_path set, chunks NOT purged (still downloadable)
recording/ → failed     straggler past grace: finalized 'failed' with
uploading               chunk_count/bytes reset to what actually landed, then
           → archived   salvaged to a -PARTIAL file (no verify) + purged
failed     → (left)     client-finalized failures are untouched — chunks stay
                        downloadable in the app for partial recovery
```

When every track is terminal (`archived`/`failed`): leftover objects under
`<session_id>/` are swept (except under failed tracks' prefixes), and the
session gets `archived_at` — shown as an "Archived" pill in Harbor.

`nas_path` values are **relative to `ASSETS_ROOT`** (same convention as
`nas_access_logs` and `/api/nas/*`). Each archived file also inserts a
`nas_access_logs` row with `action='harbor_archive'`.

Everything is idempotent: writes go to `<file>.partial` and only rename on
success, storage deletes tolerate missing objects, row updates are keyed on
current status — failed attempts retry on the next tick. One session and one
track at a time; a module lock stops overlapping ticks.

## Manual recovery (`rescue.js`)

Break-glass tool for when the archiver can't do its job: the session never
reached `ended`, the always-on Mac was down, a track failed verify, or you
want the files in hand before anything is allowed to purge them.

```bash
node api/harbor/rescue.js <session_id>
node api/harbor/rescue.js <session_id> --track <track_id>   # just one track
```

Does the useful half of the pipeline — download → concat → remux → verify —
and **never deletes**: chunks stay in the bucket, no database row is touched.
Safe to run when those chunks are the only copy of a recording. Output lands
on exactly the path the archiver would have chosen, so a later archive run
overwrites with identical bytes rather than creating a duplicate. Idempotent;
re-running is harmless.

Needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `ASSETS_ROOT`.
`HARBOR_ARCHIVE_ENABLED` is *not* required — this path is manual by
definition.

## Sessions that never end

The archiver only looks at `status='ended'`, and for a long time nothing
guaranteed a session got there:

- Recording works while a session is still `scheduled`, and the UI only
  offered an End control in `live` — so a session could capture gigabytes and
  have no exit. Fixed in `CallStage.js`: End shows whenever the session isn't
  already ended, and starting a recording promotes `scheduled` → `live`.
- A host who closes the tab instead of pressing End strands it the same way.
  No client fix covers that, so `harbor_end_idle_sessions()` runs hourly
  (pg_cron `harbor-end-idle-sessions`) and ends sessions idle past 12h. It
  only considers sessions that **have tracks** — a `scheduled` session with no
  recordings is a future booking and is never touched — and stamps `ended_at`
  at the last real activity, so the NAS folder is named for the day it was
  actually recorded.

Deleting a session with unarchived recordings is now blocked by the
`harbor_sessions_guard_delete` trigger: storage objects aren't foreign-keyed
to the session, so deleting the row orphans them with nothing left to
reference them (exactly how the leftover below became unreachable).

## Known leftovers

- A 19-byte test object sits under bucket prefix
  `18d14b3d-7ea6-4904-885f-04d5e87457f6/…` from Phase 2 smoke testing. Its
  session row was deleted, so the session sweep can never reach it — remove
  it manually (Storage UI → harbor-recordings) or leave it; it costs nothing.
