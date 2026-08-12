-- handle_new_user(): fall back to the invite's user_metadata role.
--
-- The trigger resolved the new profile's role only from `invitations`, but
-- invite-user inserted that row *after* calling inviteUserByEmail — so the
-- lookup could miss and quietly drop the user to the 'member' fallback.
-- invite-user now writes the invitation first; this adds belt-and-braces by
-- honoring the role that inviteUserByEmail already carries in user_metadata.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  invited_role text;
  invited_sub_role text;
  meta_role text;
  final_role text;
begin
  select i.role, i.sub_role
    into invited_role, invited_sub_role
  from public.invitations i
  where lower(i.email) = lower(NEW.email)
    and i.role is not null
  order by i.created_at desc
  limit 1;

  -- Only accept a metadata role we recognize: it originates from invite-user's
  -- service-role call, but this keeps an unexpected value from becoming a role.
  meta_role := NULLIF(NEW.raw_user_meta_data->>'role', '');
  if meta_role is not null
     and meta_role not in ('admin', 'director', 'member', 'contractor', 'client') then
    meta_role := null;
  end if;

  final_role := COALESCE(invited_role, meta_role, 'member');

  insert into public.profiles (
    id, full_name, nickname, email, role, title, sub_role,
    assigned_drive_folder_id, assigned_drive_folder_name
  )
  values (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'nickname', ''),
    NEW.email,
    final_role,
    NULLIF(NEW.raw_user_meta_data->>'title', ''),
    COALESCE(
      invited_sub_role,
      NULLIF(NEW.raw_user_meta_data->>'sub_role', ''),
      case when final_role = 'contractor'
           then NULLIF(NEW.raw_user_meta_data->>'title', '') end
    ),
    NULLIF(NEW.raw_user_meta_data->>'assigned_drive_folder_id', ''),
    NULLIF(NEW.raw_user_meta_data->>'assigned_drive_folder_name', '')
  )
  on conflict (id) do update
    set email    = EXCLUDED.email,
        nickname = COALESCE(EXCLUDED.nickname, public.profiles.nickname),
        title    = COALESCE(EXCLUDED.title, public.profiles.title),
        sub_role = COALESCE(EXCLUDED.sub_role, public.profiles.sub_role),
        assigned_drive_folder_id   = COALESCE(EXCLUDED.assigned_drive_folder_id, public.profiles.assigned_drive_folder_id),
        assigned_drive_folder_name = COALESCE(EXCLUDED.assigned_drive_folder_name, public.profiles.assigned_drive_folder_name);
  return NEW;
end;
$function$;
