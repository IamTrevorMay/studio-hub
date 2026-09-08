-- User deactivation (2026-09-08).
-- profiles.deactivated_at marks an account as deactivated without deleting it.
-- The deactivate-user edge function (strict-admin only) sets/clears it and
-- bans/unbans the auth user, so a deactivated account cannot log in. Live
-- pickers and rosters filter on `deactivated_at is null`; historical content
-- (messages, comments, reviews) stays attributed via single-row lookups.

alter table public.profiles
  add column if not exists deactivated_at timestamptz;

comment on column public.profiles.deactivated_at is
  'Set when a strict admin deactivates the account (deactivate-user edge function). Auth user is banned while set; live UI surfaces hide the profile.';

-- Lock the new column: only a strict admin (or the service role) may change
-- deactivated_at — directors and self-service updates cannot touch it, since
-- flipping it is the account-disable path. Also adds a service-role bypass
-- (auth.uid() is null) so edge functions and migrations aren't blocked by the
-- admin-field checks.
create or replace function public.profiles_lock_admin_fields()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Service role / SQL contexts carry no JWT — trusted, skip all checks.
  if auth.uid() is null then
    return NEW;
  end if;
  if public.is_strict_admin() then
    return NEW;
  end if;
  -- Strict-admin-only field: even directors (admin-tier) can't flip it.
  if NEW.deactivated_at is distinct from OLD.deactivated_at then
    raise exception 'deactivated_at is strict-admin-only';
  end if;
  if public.is_admin(auth.uid()) then
    return NEW;
  end if;
  if NEW.role is distinct from OLD.role then
    raise exception 'role is admin-only';
  end if;
  if NEW.sub_role is distinct from OLD.sub_role then
    raise exception 'sub_role is admin-only';
  end if;
  if NEW.posting_allowed is distinct from OLD.posting_allowed then
    raise exception 'posting_allowed is admin-only';
  end if;
  if NEW.title is distinct from OLD.title then
    raise exception 'title is admin-only';
  end if;
  if NEW.assigned_drive_folder_id is distinct from OLD.assigned_drive_folder_id then
    raise exception 'assigned_drive_folder_id is admin-only';
  end if;
  if NEW.assigned_drive_folder_name is distinct from OLD.assigned_drive_folder_name then
    raise exception 'assigned_drive_folder_name is admin-only';
  end if;
  return NEW;
end;
$function$;

-- Client-facing RPCs: deactivated editors/staff drop out of the client's
-- pickers (existing assignments keep their attribution).
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
  where ce.client_id = auth.uid()
    and p.deactivated_at is null;
$$;

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
      or (p.role = 'director' and p.sub_role = 'creative')
      or public.is_client_editor(auth.uid(), p.id));
$$;

notify pgrst, 'reload schema';
