-- Harbor Phase 2 — local recording + progressive chunked upload.
--
-- Each participant records locally (MediaRecorder, ~5s timeslice) and uploads
-- chunks to the private harbor-recordings bucket as they are produced.
--
-- Access model (mirrors Phase 1):
--   * Staff upload/download directly with supabase-js under storage RLS.
--   * Guests NEVER touch storage under their own identity — the harbor-track
--     edge function (service role) validates the session guest_token and
--     mints signed upload URLs for exact chunk paths. No anon policies.
--
-- Chunk layout (Phase 4 NAS archival walks this tree, then purges):
--   <session_id>/<participant_id>/<track_id>/<chunk_index 6-padded>.webm

-- ── harbor_tracks: recording metadata ──────────────────────────
alter table public.harbor_tracks
  add column if not exists chunk_count integer not null default 0,
  add column if not exists mime_type text,
  add column if not exists duration_ms bigint,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_harbor_tracks_updated_at on public.harbor_tracks;
create trigger set_harbor_tracks_updated_at
  before update on public.harbor_tracks
  for each row execute function public.set_updated_at();

-- Live tracks panel (HarborRoom) subscribes via postgres_changes; staff RLS
-- read on harbor_tracks makes the events visible to staff only.
alter publication supabase_realtime add table public.harbor_tracks;

-- ── Storage bucket (private) ───────────────────────────────────
-- 50MB per-object cap: a 5s webm chunk at ~2.6Mbps is ~1.6MB, so this is
-- generous headroom rather than a limit we expect to hit. No mime allowlist:
-- the bucket is private and every write path is staff-RLS or a
-- service-role-minted signed URL.
insert into storage.buckets (id, name, public, file_size_limit)
values ('harbor-recordings', 'harbor-recordings', false, 52428800)
on conflict (id) do nothing;

-- ── Storage RLS: staff full access, zero anon ──────────────────
create policy "harbor_recordings_staff_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'harbor-recordings' and public.is_harbor_staff(auth.uid()));

create policy "harbor_recordings_staff_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'harbor-recordings' and public.is_harbor_staff(auth.uid()));

-- Update needed for upsert retries (re-PUT of a chunk that half-landed).
create policy "harbor_recordings_staff_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'harbor-recordings' and public.is_harbor_staff(auth.uid()))
  with check (bucket_id = 'harbor-recordings' and public.is_harbor_staff(auth.uid()));

create policy "harbor_recordings_staff_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'harbor-recordings' and public.is_harbor_staff(auth.uid()));
