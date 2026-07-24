-- Harbor Phase 3 — green room, producer moderation, guest-link rotation.
--
-- channel_secret: decouples the Realtime signaling channel name from
-- guest_token so the guest link can be rotated (new token, old links 404)
-- without moving the live channel or disturbing connected peers. Same
-- entropy trick as guest_token (two v4 UUIDs → 64 hex chars, ~244 bits);
-- the channel name uses only the first 16 chars
-- (harbor:<session_id>:<channel_secret[0:16]>).
--
-- Backfill note: the default is VOLATILE, so Postgres rewrites the table and
-- evaluates it once per existing row — every pre-existing session gets its
-- own distinct secret (verified post-apply). This is NOT the PG11 fast-path
-- (that only applies to non-volatile defaults, where all rows would share
-- one value).
--
-- Participants: the green-room flow inserts guests as 'lobby' (harbor-join
-- sets state explicitly). Flipping the column default to 'lobby' is a
-- fail-closed net: any future insert that forgets state lands in the lobby,
-- never in the call. Staff joins (HarborRoom.js) set 'admitted' explicitly.

alter table public.harbor_sessions
  add column if not exists channel_secret text not null
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

alter table public.harbor_participants
  alter column state set default 'lobby';
