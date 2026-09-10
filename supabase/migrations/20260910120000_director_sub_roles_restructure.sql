-- Director sub-role restructure (2026-09-10):
--   communications -> unchanged value, label now "Director of Communication"
--   creative       -> renamed to 'production' (keeps client-management powers)
--   content_strategy -> new sub-role ("Director of Content & Strategy")
--
-- The client RPCs below keep accepting the legacy 'creative' value during the
-- deploy window; safe to prune once the frontend rename is live everywhere.

-- 1. Data rename (lock trigger has a service-role bypass, so this passes).
update public.profiles
  set sub_role = 'production'
  where sub_role = 'creative'
    and role in ('director', 'director_creative', 'director_comms');

update public.profiles
  set title = 'Director of Production'
  where title in ('Director of Creative', 'Creative Director')
    and role in ('director', 'director_creative', 'director_comms');

update public.profiles
  set title = 'Director of Communication'
  where title = 'Director of Communications'
    and role in ('director', 'director_creative', 'director_comms');

update public.invitations
  set sub_role = 'production'
  where sub_role = 'creative' and role = 'director';

-- 2. client_can_message: 'creative' -> production (+legacy accept).
create or replace function public.client_can_message(p_client uuid, p_other uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from profiles p where p.id = p_other and
           (p.role = 'admin' or (p.role = 'director' and p.sub_role in ('production', 'creative'))))
      or public.is_client_editor(p_client, p_other);
$$;
revoke execute on function public.client_can_message(uuid, uuid) from anon;

-- 3. client_message_recipients: same swap, on the latest (deactivation-aware)
-- body from 20260908120000.
create or replace function public.client_message_recipients()
returns table (id uuid, full_name text, nickname text, title text, avatar_url text,
               role text, sub_role text)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select p.id, p.full_name, p.nickname, p.title, p.avatar_url, p.role, p.sub_role
  from profiles p
  where public.is_client(auth.uid())
    and p.id <> auth.uid()
    and p.deactivated_at is null
    and (p.role = 'admin'
      or (p.role = 'director' and p.sub_role in ('production', 'creative'))
      or public.is_client_editor(auth.uid(), p.id));
$$;
revoke execute on function public.client_message_recipients() from anon;

notify pgrst, 'reload schema';
