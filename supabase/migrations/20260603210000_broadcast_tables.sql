-- Mayday Broadcast (port of Triton's /broadcast tool). Phase 5.
-- New `producer` role gets Broadcast + member-tier pages but is NOT
-- treated as admin elsewhere. Per-project ACL via email-matched
-- broadcast_project_members rows (Q35 — Triton's user IDs aren't ours).

-- ── Producer role ─────────────────────────────────────────────────
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (
    role in ('admin', 'assistant', 'member', 'partner', 'freelancer',
             'director_creative', 'director_comms', 'producer')
  );

create or replace function public.is_producer_or_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and role in ('admin', 'producer', 'director_creative', 'director_comms')
  );
$$;

-- ── broadcast_projects ────────────────────────────────────────────
create table public.broadcast_projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  name         text not null,
  description  text,
  fps          integer not null default 30,
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index broadcast_projects_user_id_idx on public.broadcast_projects (user_id);
alter table public.broadcast_projects enable row level security;

-- ── broadcast_project_members ─────────────────────────────────────
-- email-keyed per Q35. Lower(email) matches against profiles.email.
create table public.broadcast_project_members (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.broadcast_projects(id) on delete cascade,
  email        text not null,
  role         text not null default 'viewer' check (role in ('producer','viewer')),
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index broadcast_project_members_proj_email_idx
  on public.broadcast_project_members (project_id, lower(email));
create index broadcast_project_members_email_idx
  on public.broadcast_project_members (lower(email));
alter table public.broadcast_project_members enable row level security;

-- ── Access level helper ──────────────────────────────────────────
-- Returns 'owner' | 'producer' | 'viewer' | 'none' for a user against a
-- project. Admins (incl. director_*) always get 'producer'. The owner is
-- the project.user_id; everyone else is matched via lowercase email.
create or replace function public.broadcast_project_access_level(p_project_id uuid, p_uid uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_email text;
  v_role text;
begin
  if public.is_admin(p_uid) then
    return 'producer';
  end if;
  select user_id into v_owner from public.broadcast_projects where id = p_project_id;
  if v_owner is null then return 'none'; end if;
  if v_owner = p_uid then return 'owner'; end if;

  select email into v_email from public.profiles where id = p_uid;
  if v_email is null then return 'none'; end if;

  select role into v_role
  from public.broadcast_project_members
  where project_id = p_project_id and lower(email) = lower(v_email);
  if v_role is null then return 'none'; end if;
  return v_role;
end;
$$;

create or replace function public.broadcast_can_edit(p_project_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.broadcast_project_access_level(p_project_id, p_uid)
    in ('owner','producer');
$$;

create or replace function public.broadcast_can_read(p_project_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.broadcast_project_access_level(p_project_id, p_uid)
    in ('owner','producer','viewer');
$$;

-- RLS for projects + members
create policy bp_select on public.broadcast_projects
  for select using (public.broadcast_can_read(id, auth.uid()));
create policy bp_insert on public.broadcast_projects
  for insert with check (public.is_producer_or_admin(auth.uid()) and user_id = auth.uid());
create policy bp_update on public.broadcast_projects
  for update using (public.broadcast_can_edit(id, auth.uid()))
  with check (public.broadcast_can_edit(id, auth.uid()));
create policy bp_delete on public.broadcast_projects
  for delete using (public.is_admin(auth.uid()) or user_id = auth.uid());

create policy bpm_select on public.broadcast_project_members
  for select using (public.broadcast_can_read(project_id, auth.uid()));
create policy bpm_write on public.broadcast_project_members
  for all using (public.broadcast_can_edit(project_id, auth.uid()))
  with check (public.broadcast_can_edit(project_id, auth.uid()));

-- ── broadcast_scenes ─────────────────────────────────────────────
create table public.broadcast_scenes (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.broadcast_projects(id) on delete cascade,
  name                text not null default 'Scene',
  sort_order          integer not null default 0,
  hotkey_key          text,
  hotkey_color        text,
  enter_transition    text,
  exit_transition     text,
  transition_override text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index broadcast_scenes_project_idx on public.broadcast_scenes (project_id, sort_order);
alter table public.broadcast_scenes enable row level security;
create policy bs_read on public.broadcast_scenes
  for select using (public.broadcast_can_read(project_id, auth.uid()));
create policy bs_write on public.broadcast_scenes
  for all using (public.broadcast_can_edit(project_id, auth.uid()))
  with check (public.broadcast_can_edit(project_id, auth.uid()));

-- ── broadcast_assets ─────────────────────────────────────────────
create table public.broadcast_assets (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.broadcast_projects(id) on delete cascade,
  name               text not null default 'Asset',
  asset_type         text not null,
  storage_path       text,
  template_id        text,
  template_data      jsonb not null default '{}'::jsonb,
  slideshow_config   jsonb not null default '{}'::jsonb,
  scene_config       jsonb not null default '{}'::jsonb,
  ad_config          jsonb not null default '{}'::jsonb,
  canvas_x           integer not null default 0,
  canvas_y           integer not null default 0,
  canvas_width       integer,
  canvas_height      integer,
  layer              integer not null default 0,
  opacity            numeric not null default 1.0,
  enter_transition   text,
  exit_transition    text,
  hotkey_key         text,
  hotkey_color       text,
  hotkey_label       text,
  trigger_duration   integer,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index broadcast_assets_project_idx on public.broadcast_assets (project_id, sort_order);
alter table public.broadcast_assets enable row level security;
create policy ba_read on public.broadcast_assets
  for select using (public.broadcast_can_read(project_id, auth.uid()));
create policy ba_write on public.broadcast_assets
  for all using (public.broadcast_can_edit(project_id, auth.uid()))
  with check (public.broadcast_can_edit(project_id, auth.uid()));

-- ── broadcast_scene_assets (link) ────────────────────────────────
create table public.broadcast_scene_assets (
  id               uuid primary key default gen_random_uuid(),
  scene_id         uuid not null references public.broadcast_scenes(id) on delete cascade,
  asset_id         uuid not null references public.broadcast_assets(id) on delete cascade,
  is_visible       boolean not null default true,
  override_x       integer,
  override_y       integer,
  override_width   integer,
  override_height  integer,
  override_layer   integer,
  override_opacity numeric,
  created_at       timestamptz not null default now()
);
create index broadcast_scene_assets_scene_idx on public.broadcast_scene_assets (scene_id);
create index broadcast_scene_assets_asset_idx on public.broadcast_scene_assets (asset_id);
alter table public.broadcast_scene_assets enable row level security;
create policy bsa_read on public.broadcast_scene_assets
  for select using (
    exists (select 1 from public.broadcast_scenes s
            where s.id = scene_id and public.broadcast_can_read(s.project_id, auth.uid()))
  );
create policy bsa_write on public.broadcast_scene_assets
  for all using (
    exists (select 1 from public.broadcast_scenes s
            where s.id = scene_id and public.broadcast_can_edit(s.project_id, auth.uid()))
  ) with check (
    exists (select 1 from public.broadcast_scenes s
            where s.id = scene_id and public.broadcast_can_edit(s.project_id, auth.uid()))
  );

-- ── broadcast_sessions ───────────────────────────────────────────
-- One live show instance. channel_name is the URL slug for the overlay page.
create table public.broadcast_sessions (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.broadcast_projects(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  channel_name  text not null unique,
  is_live       boolean not null default false,
  active_state  jsonb not null default '{}'::jsonb,
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index broadcast_sessions_project_idx on public.broadcast_sessions (project_id, created_at desc);
alter table public.broadcast_sessions enable row level security;
-- Sessions are readable by anyone (overlay page is public). Writes require edit.
create policy bsess_read on public.broadcast_sessions
  for select using (true);
create policy bsess_write on public.broadcast_sessions
  for all using (public.broadcast_can_edit(project_id, auth.uid()))
  with check (public.broadcast_can_edit(project_id, auth.uid()));

-- ── broadcast_widget_state ───────────────────────────────────────
-- One row per project. Realtime channel keys off this table for the
-- producer-overlay sync.
create table public.broadcast_widget_state (
  project_id  uuid primary key references public.broadcast_projects(id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.broadcast_widget_state enable row level security;
create policy bws_read on public.broadcast_widget_state
  for select using (true);
create policy bws_write on public.broadcast_widget_state
  for all using (public.broadcast_can_edit(project_id, auth.uid()))
  with check (public.broadcast_can_edit(project_id, auth.uid()));

-- ── broadcast_clip_markers ───────────────────────────────────────
create table public.broadcast_clip_markers (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.broadcast_sessions(id) on delete cascade,
  project_id   uuid not null references public.broadcast_projects(id) on delete cascade,
  title        text,
  start_time   numeric,
  end_time     numeric,
  clip_type    text,
  sort_order   integer not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index broadcast_clip_markers_session_idx on public.broadcast_clip_markers (session_id, sort_order);
alter table public.broadcast_clip_markers enable row level security;
create policy bcm_read on public.broadcast_clip_markers
  for select using (public.broadcast_can_read(project_id, auth.uid()));
create policy bcm_write on public.broadcast_clip_markers
  for all using (public.broadcast_can_edit(project_id, auth.uid()))
  with check (public.broadcast_can_edit(project_id, auth.uid()));

-- ── broadcast_chat_messages ──────────────────────────────────────
-- Live chat replay buffer. provider = twitch / youtube (we'll only feed
-- twitch from Mayday side — YouTube chat was dropped per decisions Q).
create table public.broadcast_chat_messages (
  id                bigint generated always as identity primary key,
  session_id        uuid not null references public.broadcast_sessions(id) on delete cascade,
  provider          text not null,
  display_name      text,
  content           text,
  profile_image_url text,
  message_type      text,
  color             text,
  plan              text,
  months            integer,
  amount            numeric,
  created_at        timestamptz not null default now()
);
create index broadcast_chat_messages_session_idx on public.broadcast_chat_messages (session_id, created_at desc);
alter table public.broadcast_chat_messages enable row level security;
create policy bcc_read on public.broadcast_chat_messages
  for select using (true);
create policy bcc_write on public.broadcast_chat_messages
  for insert with check (
    exists (select 1 from public.broadcast_sessions s
            where s.id = session_id and public.broadcast_can_edit(s.project_id, auth.uid()))
  );

-- ── updated_at trigger ───────────────────────────────────────────
create or replace function public.broadcast_touch_updated_at()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin NEW.updated_at = now(); return NEW; end;
$$;
do $$
declare t text;
begin
  for t in select unnest(array[
    'broadcast_projects','broadcast_scenes','broadcast_assets',
    'broadcast_sessions','broadcast_widget_state'
  ]) loop
    execute format(
      'drop trigger if exists %I_touch on public.%I; '
      'create trigger %I_touch before update on public.%I '
      'for each row execute function public.broadcast_touch_updated_at();',
      t, t, t, t
    );
  end loop;
end $$;

-- ── Storage bucket (broadcast-assets) ───────────────────────────
-- 5 GB / file cap is the Supabase Pro platform max — set in dashboard;
-- can't be enforced via SQL. All MIME allowed. Public read for overlay
-- consumption; writes only from authenticated producers/admins.
insert into storage.buckets (id, name, public, file_size_limit)
values ('broadcast-assets', 'broadcast-assets', true, null)
on conflict (id) do update set public = excluded.public;

create policy "broadcast-assets read" on storage.objects
  for select using (bucket_id = 'broadcast-assets');
create policy "broadcast-assets write" on storage.objects
  for insert with check (
    bucket_id = 'broadcast-assets'
    and public.is_producer_or_admin(auth.uid())
  );
create policy "broadcast-assets update" on storage.objects
  for update using (
    bucket_id = 'broadcast-assets'
    and public.is_producer_or_admin(auth.uid())
  );
create policy "broadcast-assets delete" on storage.objects
  for delete using (
    bucket_id = 'broadcast-assets'
    and public.is_producer_or_admin(auth.uid())
  );

-- Realtime broadcast: enable on widget_state + chat_messages so the
-- overlay page can subscribe directly via Supabase Realtime.
alter publication supabase_realtime add table public.broadcast_widget_state;
alter publication supabase_realtime add table public.broadcast_chat_messages;
alter publication supabase_realtime add table public.broadcast_sessions;
