-- Harbor Phase 3b — per-participant resume_key (re-join hijack fix).
--
-- Presence meta broadcasts every participant's participant_id to the whole
-- channel (the producer's admit/remove UI needs the clientId → row mapping),
-- and harbor-join's re-join path + every harbor-track action accepted
-- token + participant_id as full credentials. That let any link-holder
-- lurking in the lobby read an admitted guest's pid from presence and (a)
-- re-join as them — skipping the green room — or (b) drive harbor-track
-- against their track (finalize 'failed', overwrite chunks via signed URLs).
--
-- resume_key is a per-participant secret returned ONLY in harbor-join's
-- direct response to the joining client (never in presence, broadcasts, or
-- any channel-visible payload). Re-join, leave, and all harbor-track actions
-- now require it. Same entropy trick as guest_token / channel_secret (two v4
-- UUIDs → 64 hex chars); the VOLATILE default rewrites the table so existing
-- rows each get a distinct key. Staff participants get keys too but never
-- use them (staff ride direct RLS, not the edge functions).

alter table public.harbor_participants
  add column if not exists resume_key text not null
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
