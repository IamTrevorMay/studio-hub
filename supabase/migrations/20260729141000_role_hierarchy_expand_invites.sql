-- Role hierarchy restructure — EXPAND (invite plumbing).
-- Carry sub_role through the invitation → signup flow.

alter table public.invitations add column if not exists sub_role text;

create or replace function public.handle_new_user()
 returns trigger language plpgsql security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  invited_role text;
  invited_sub_role text;
begin
  select i.role, i.sub_role
    into invited_role, invited_sub_role
  from public.invitations i
  where lower(i.email) = lower(NEW.email)
    and i.role is not null
  order by i.created_at desc
  limit 1;

  insert into public.profiles (
    id, full_name, nickname, email, role, title, sub_role,
    assigned_drive_folder_id, assigned_drive_folder_name
  )
  values (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'nickname', ''),
    NEW.email,
    COALESCE(invited_role, 'member'),
    NULLIF(NEW.raw_user_meta_data->>'title', ''),
    COALESCE(
      invited_sub_role,
      NULLIF(NEW.raw_user_meta_data->>'sub_role', ''),
      case when COALESCE(invited_role, 'member') = 'contractor'
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
