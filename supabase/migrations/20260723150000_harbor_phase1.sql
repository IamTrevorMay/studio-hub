-- Harbor Phase 1 — foundation + live-call layer for the suite's podcast /
-- remote-recording app. Tables: harbor_sessions, harbor_participants,
-- harbor_tracks (Phase 2 recording fills tracks; schema exists now).
--
-- Access model:
--   * Staff (admin tier + assistant + member) get full read/write via RLS.
--   * Guests have NO auth session and NO anon policies — every guest
--     operation goes through the harbor-join edge function (service role).
--     The guest_token on the session is the guest credential.

-- ── Staff helper ────────────────────────────────────────────────
-- Harbor is an all-staff surface. Admin tier mirrors is_admin()
-- (admin + both directors) plus assistant and member.
create or replace function public.is_harbor_staff(uid uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and role in ('admin','director_creative','director_comms','assistant','member')
  );
$$;

revoke execute on function public.is_harbor_staff(uuid) from anon, public;
grant execute on function public.is_harbor_staff(uuid) to authenticated;

-- ── Sessions ───────────────────────────────────────────────────
-- guest_token: 64 hex chars from two v4 UUIDs (~244 bits of entropy) — the
-- tokenized join-link credential. No extension dependency (pure gen_random_uuid).
create table if not exists public.harbor_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled session',
  status text not null default 'scheduled'
    check (status in ('scheduled','live','ended')),
  guest_token text not null unique
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_by uuid references public.profiles(id) on delete set null,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_harbor_sessions_updated_at on public.harbor_sessions;
create trigger set_harbor_sessions_updated_at
  before update on public.harbor_sessions
  for each row execute function public.set_updated_at();

-- ── Participants ───────────────────────────────────────────────
-- state defaults to 'admitted' for Phase 1. The Phase 3 green-room flow flips
-- the default to 'lobby' and adds an admit action — the enum already allows it.
-- client_id is a random per-tab id used to key WebRTC signaling.
create table if not exists public.harbor_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.harbor_sessions(id) on delete cascade,
  display_name text not null,
  role text not null default 'guest' check (role in ('producer','guest')),
  state text not null default 'admitted' check (state in ('lobby','admitted','removed')),
  user_id uuid references public.profiles(id) on delete set null,
  client_id text not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

create index if not exists harbor_participants_session_idx
  on public.harbor_participants(session_id);

-- ── Tracks (Phase 2: local recording + chunked upload) ─────────
create table if not exists public.harbor_tracks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.harbor_sessions(id) on delete cascade,
  participant_id uuid not null references public.harbor_participants(id) on delete cascade,
  kind text not null check (kind in ('video','audio')),
  storage_prefix text,
  status text not null default 'recording'
    check (status in ('recording','uploading','complete','failed')),
  bytes_uploaded bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists harbor_tracks_session_idx
  on public.harbor_tracks(session_id);

-- ── RLS ────────────────────────────────────────────────────────
alter table public.harbor_sessions enable row level security;
alter table public.harbor_participants enable row level security;
alter table public.harbor_tracks enable row level security;

-- Staff full read/write. Deliberately NO anon policies on any harbor_* table.
create policy "harbor staff all sessions" on public.harbor_sessions
  for all to authenticated
  using (public.is_harbor_staff(auth.uid()))
  with check (public.is_harbor_staff(auth.uid()));

create policy "harbor staff all participants" on public.harbor_participants
  for all to authenticated
  using (public.is_harbor_staff(auth.uid()))
  with check (public.is_harbor_staff(auth.uid()));

create policy "harbor staff all tracks" on public.harbor_tracks
  for all to authenticated
  using (public.is_harbor_staff(auth.uid()))
  with check (public.is_harbor_staff(auth.uid()));

-- Belt-and-suspenders service-role escape hatch (service key bypasses RLS
-- anyway; this documents that harbor-join writes with the service role).
create policy "service role sessions" on public.harbor_sessions
  for all to service_role using (true) with check (true);
create policy "service role participants" on public.harbor_participants
  for all to service_role using (true) with check (true);
create policy "service role tracks" on public.harbor_tracks
  for all to service_role using (true) with check (true);
