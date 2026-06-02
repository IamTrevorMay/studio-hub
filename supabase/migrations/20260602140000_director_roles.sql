-- Director-tier roles. Treated as admin for DB access (UI hides specific
-- pages per role via src/lib/rolePermissions.js). Adding a new role:
--   1. Append to the role check below.
--   2. Append to is_admin / is_admin_or_assistant if they should pass.
--   3. Add an entry in src/lib/rolePermissions.js with restricted nav keys.
--   4. Add a <option> in src/pages/AdminPanel.js role selects.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (
    role in ('admin', 'assistant', 'member', 'partner', 'freelancer',
             'director_creative', 'director_comms')
  );

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and role in ('admin', 'director_creative', 'director_comms')
  );
$$;

create or replace function public.is_admin_or_assistant(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and role in ('admin', 'assistant', 'director_creative', 'director_comms')
  );
$$;
