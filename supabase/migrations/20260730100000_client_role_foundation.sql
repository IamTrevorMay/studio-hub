-- Client role foundation: widen role check, helpers, client_editors mapping,
-- client_profiles, and the read-only RPCs the client portal needs.
-- Part 1 of the Client Portal series (see 20260730110000..140000).

-- 1. Allow 'client' as a top-level role.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin','director','member','contractor','client']::text[]));

-- 2. Role helpers (SECURITY DEFINER so RLS policies can use them without recursion).
create or replace function public.is_client(uid uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from profiles where id = uid and role = 'client');
$$;

create or replace function public.is_client()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.is_client(auth.uid());
$$;

-- Internal team (admin + director + member). Deliberately excludes contractor
-- and client — used by the reviews RLS rewrite to preserve staff behavior.
create or replace function public.is_staff(uid uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from profiles where id = uid
                 and role in ('admin','director','member'));
$$;

revoke execute on function public.is_client(uuid) from anon;
revoke execute on function public.is_client() from anon;
revoke execute on function public.is_staff(uuid) from anon;

-- 3. client_editors: which contractor editors a client may assign work to.
create table public.client_editors (
  client_id     uuid not null references public.profiles(id) on delete cascade,
  contractor_id uuid not null references public.profiles(id) on delete cascade,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  primary key (client_id, contractor_id)
);
create index client_editors_contractor_idx on public.client_editors(contractor_id);

alter table public.client_editors enable row level security;

-- is_admin covers admin + director, i.e. the Creative Director too.
create policy "admin manage client_editors" on public.client_editors
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "client reads own editor links" on public.client_editors
  for select using (client_id = auth.uid());
create policy "contractor reads own client links" on public.client_editors
  for select using (contractor_id = auth.uid());

-- Only real client -> editor-contractor pairs are mappable.
create or replace function public.client_editors_validate()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not exists (select 1 from profiles where id = NEW.client_id and role = 'client') then
    raise exception 'client_id must be a client profile';
  end if;
  if not exists (
    select 1 from profiles where id = NEW.contractor_id and role = 'contractor'
      and sub_role in ('Long Form Editor','Short Form Editor','Podcast Editor')
  ) then
    raise exception 'contractor_id must be a contractor with an editor sub-role';
  end if;
  return NEW;
end;
$$;

create trigger client_editors_validate_trg
  before insert on public.client_editors
  for each row execute function public.client_editors_validate();

-- Recursion-free membership check used by policies on other tables.
create or replace function public.is_client_editor(p_client uuid, p_contractor uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from client_editors
                 where client_id = p_client and contractor_id = p_contractor);
$$;
revoke execute on function public.is_client_editor(uuid, uuid) from anon;

-- 4. client_profiles: portal profile data. drive_folder_url is the LINK-ONLY
-- delivery target the client pastes themselves (no programmatic upload).
create table public.client_profiles (
  id                uuid primary key references public.profiles(id) on delete cascade,
  company_name      text,
  phone             text,
  bio               text,
  drive_folder_url  text,
  admin_notes       text,
  tour_completed_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.client_profiles enable row level security;

create policy "admin full access on client_profiles" on public.client_profiles
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "client select own profile" on public.client_profiles
  for select using (id = auth.uid());
create policy "client insert own profile" on public.client_profiles
  for insert with check (id = auth.uid() and public.is_client(auth.uid()));
create policy "client update own profile" on public.client_profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Clients must not edit admin_notes (admin-only field).
create or replace function public.client_profile_lock_admin_fields()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if public.is_admin(auth.uid()) then
    return NEW;
  end if;
  if NEW.admin_notes is distinct from OLD.admin_notes then
    raise exception 'admin_notes is an admin-only field';
  end if;
  return NEW;
end;
$$;

create trigger client_profile_lock_admin_fields_trg
  before update on public.client_profiles
  for each row execute function public.client_profile_lock_admin_fields();

-- 5. Editors (and admins) read a client's delivery folder link.
create or replace function public.editor_client_drive_folder(p_client uuid)
returns text
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select cp.drive_folder_url
  from client_profiles cp
  where cp.id = p_client
    and (public.is_admin(auth.uid()) or public.is_client_editor(p_client, auth.uid()));
$$;
revoke execute on function public.editor_client_drive_folder(uuid) from anon;

-- 6. Editor options for the client's assignment form (read-only rates).
create or replace function public.client_editor_options()
returns table (id uuid, full_name text, nickname text, avatar_url text,
               sub_role text, payment_type text, rate numeric)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select p.id, p.full_name, p.nickname, p.avatar_url, p.sub_role,
         fp.payment_type, fp.rate
  from client_editors ce
  join profiles p on p.id = ce.contractor_id
  left join contractor_profiles fp on fp.id = ce.contractor_id
  where ce.client_id = auth.uid();
$$;
revoke execute on function public.client_editor_options() from anon;

notify pgrst, 'reload schema';
