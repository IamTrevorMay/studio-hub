-- Harbor: Shows and Meetings as the two first-class things you can make.
--
--   Show    — a reusable room with a permanent guest link. Recording it creates
--             a session underneath, so a show accumulates a recording history.
--             4 seats, full video recording, quality tiers on download.
--   Meeting — a one-off gathering. Video call, but only audio is recorded.
--             6 seats (the documented ceiling for the P2P mesh; 8 would need
--             an SFU — see src/lib/harbor/mesh.js).
--
-- Legacy sessions keep mode='recording' and behave exactly as before, so
-- nothing already on disk or in flight changes meaning.

-- ── Shows ──────────────────────────────────────────────────────────────
create table if not exists public.harbor_shows (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled show',

  -- Permanent join credentials. Unlike a session's, these are meant to be
  -- handed out once and reused every week, so rotation is an explicit act.
  guest_token text not null unique
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  channel_secret text not null
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),

  -- Video on a full mesh: every client sends to every other. 4 is the
  -- supported cap.
  max_participants smallint not null default 4 check (max_participants between 2 and 4),

  -- What each browser is asked to capture. 'best' requests the highest the
  -- camera offers and downscales what goes over the mesh; the recording keeps
  -- the full-resolution track so the HQ download is real rather than upscaled.
  capture_quality text not null default 'best'
    check (capture_quality in ('best', '1080p', '720p')),

  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.harbor_shows is
  'A reusable Harbor room. Sessions with mode=''show'' hang off it, one per recording, so a show carries its own recording history.';
comment on column public.harbor_shows.capture_quality is
  'Requested getUserMedia ceiling. The mesh always sends downscaled video; only the local recording keeps full resolution.';

create index if not exists harbor_shows_active_idx
  on public.harbor_shows (created_at desc) where archived_at is null;

-- ── Sessions belong to a show (or to nothing, for meetings) ────────────
alter table public.harbor_sessions
  add column if not exists show_id uuid references public.harbor_shows(id) on delete cascade;

create index if not exists harbor_sessions_show_idx
  on public.harbor_sessions (show_id, created_at desc) where show_id is not null;

-- mode gains 'show'. 'recording' stays for the pre-existing standalone
-- sessions so their behaviour and their archiver lifecycle are untouched.
alter table public.harbor_sessions drop constraint if exists harbor_sessions_mode_check;
alter table public.harbor_sessions
  add constraint harbor_sessions_mode_check
  check (mode in ('recording', 'meeting', 'show'));

-- A show session must belong to a show; a meeting or legacy session must not.
-- Without this, "which view does this row appear in" becomes ambiguous.
alter table public.harbor_sessions drop constraint if exists harbor_sessions_show_link_check;
alter table public.harbor_sessions
  add constraint harbor_sessions_show_link_check
  check (
    (mode = 'show' and show_id is not null)
    or (mode <> 'show' and show_id is null)
  );

-- Seat caps per mode. Meetings get 6 — the mesh ceiling with video on.
alter table public.harbor_sessions drop constraint if exists harbor_sessions_seats_check;
alter table public.harbor_sessions
  add constraint harbor_sessions_seats_check
  check (
    case mode
      when 'meeting' then max_participants between 2 and 6
      when 'show'    then max_participants between 2 and 4
      else                max_participants between 2 and 16
    end
  );

comment on column public.harbor_sessions.mode is
  'show = one recording of a reusable harbor_shows room (video). meeting = one-off gathering, video call but audio-only recording, up to 6. recording = legacy standalone session.';

-- ── Tracks: audio-only meetings need the kind to mean something ────────
-- kind was already free text used as 'video'. Pin the vocabulary now that
-- meetings produce audio tracks and the archiver picks a container from it.
alter table public.harbor_tracks drop constraint if exists harbor_tracks_kind_check;
alter table public.harbor_tracks
  add constraint harbor_tracks_kind_check
  check (kind in ('video', 'audio', 'screen'));

-- ── Renditions: the 720p / 1080p / HQ downloads ────────────────────────
-- One row per derived file. The master is the track's own nas_path; these are
-- transcodes made from it on the always-on Mac. Separate table rather than
-- columns because a rendition can fail or be regenerated on its own.
create table if not exists public.harbor_track_renditions (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.harbor_tracks(id) on delete cascade,

  quality text not null check (quality in ('master', '1080p', '720p')),
  nas_path text,                       -- relative to ASSETS_ROOT, as everywhere
  bytes bigint,
  width int,
  height int,

  status text not null default 'pending'
    check (status in ('pending', 'encoding', 'ready', 'failed')),
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (track_id, quality)
);

comment on table public.harbor_track_renditions is
  'Derived download files per track. master mirrors the archived original; 1080p/720p are ffmpeg transcodes produced on the always-on Mac. Never upscales — a rendition above the captured resolution is simply not created.';

create index if not exists harbor_track_renditions_track_idx
  on public.harbor_track_renditions (track_id);
create index if not exists harbor_track_renditions_pending_idx
  on public.harbor_track_renditions (status) where status in ('pending', 'encoding');

-- ── RLS: same shape as the rest of harbor_* ────────────────────────────
alter table public.harbor_shows enable row level security;
alter table public.harbor_track_renditions enable row level security;

drop policy if exists "harbor staff all shows" on public.harbor_shows;
create policy "harbor staff all shows" on public.harbor_shows
  for all to authenticated
  using (public.is_harbor_staff(auth.uid()))
  with check (public.is_harbor_staff(auth.uid()));

drop policy if exists "harbor staff all renditions" on public.harbor_track_renditions;
create policy "harbor staff all renditions" on public.harbor_track_renditions
  for all to authenticated
  using (public.is_harbor_staff(auth.uid()))
  with check (public.is_harbor_staff(auth.uid()));

drop policy if exists "service role shows" on public.harbor_shows;
create policy "service role shows" on public.harbor_shows
  for all to service_role using (true) with check (true);
drop policy if exists "service role renditions" on public.harbor_track_renditions;
create policy "service role renditions" on public.harbor_track_renditions
  for all to service_role using (true) with check (true);

-- updated_at maintenance, matching the other harbor tables.
drop trigger if exists harbor_shows_touch on public.harbor_shows;
create trigger harbor_shows_touch
  before update on public.harbor_shows
  for each row execute function public.set_updated_at();

drop trigger if exists harbor_track_renditions_touch on public.harbor_track_renditions;
create trigger harbor_track_renditions_touch
  before update on public.harbor_track_renditions
  for each row execute function public.set_updated_at();
