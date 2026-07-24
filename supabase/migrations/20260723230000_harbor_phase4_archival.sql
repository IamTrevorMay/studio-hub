-- Harbor Phase 4 — NAS archival.
--
-- Ended sessions' recordings move off Supabase Storage onto the NAS (the
-- always-on Mac running the api/ Express server with ASSETS_ROOT mounted),
-- then the Supabase chunk objects are purged. Supabase = capture buffer;
-- NAS = permanent home.
--
-- The archiver (api/harbor/archiver.js) runs ON that machine and drives the
-- track state machine:
--   complete            → archived  (chunks concatenated to NAS, then purged)
--   complete            → failed    (verify shortfall — file kept on NAS for
--                                    forensics, chunks NOT purged)
--   recording|uploading → failed    (straggler past the 6h upload grace;
--                                    whatever landed is archived -PARTIAL)
--
-- nas_path is relative to ASSETS_ROOT (same convention as nas_access_logs
-- and the /api/nas/* routes), e.g.
--   Harbor/2026-07-23 test test/Trevor-video-c39d565e.webm
--
-- harbor_sessions.archived_at stamps when every track in the session reached
-- a terminal state (archived or failed) and leftover session objects were
-- swept from the bucket.

alter table public.harbor_tracks
  add column if not exists archived_at timestamptz,
  add column if not exists nas_path text;

alter table public.harbor_sessions
  add column if not exists archived_at timestamptz;

-- Extend the track status set with 'archived'. Existing rows only hold
-- values from the old set, so re-adding the constraint validates cleanly.
alter table public.harbor_tracks
  drop constraint if exists harbor_tracks_status_check;

alter table public.harbor_tracks
  add constraint harbor_tracks_status_check
  check (status in ('recording','uploading','complete','failed','archived'));
