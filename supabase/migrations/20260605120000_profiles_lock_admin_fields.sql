-- Lock admin-controlled profile columns (role, posting_allowed, title,
-- assigned_drive_folder_*) so a non-admin can't self-promote or grant
-- themselves Drive folder access via the existing self-update RLS on
-- profiles. Closes the CRIT self-promotion vector found 2026-06-05.
--
-- Pattern mirrors profiles_lock_pay_method (20260602130000) and
-- fl_profile_lock_admin_fields (20260601160000).

create or replace function public.profiles_lock_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin(auth.uid()) then
    return NEW;
  end if;
  if NEW.role is distinct from OLD.role then
    raise exception 'role is admin-only';
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
$$;

drop trigger if exists profiles_lock_admin_fields on public.profiles;
create trigger profiles_lock_admin_fields
  before update on public.profiles
  for each row execute function public.profiles_lock_admin_fields();
