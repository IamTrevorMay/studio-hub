-- Lock profiles.pay_method + pay_method_detail so a freelancer can't bump
-- their own payment routing via the existing self-update RLS on profiles.
-- Admins keep full control via the regular admin path. Trigger pattern
-- mirrors fl_profile_lock_admin_fields on freelancer_profiles.

create or replace function public.profiles_lock_pay_method()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin(auth.uid()) then
    return NEW;
  end if;
  if NEW.pay_method is distinct from OLD.pay_method
    or NEW.pay_method_detail is distinct from OLD.pay_method_detail
  then
    raise exception 'pay_method / pay_method_detail are admin-only fields';
  end if;
  return NEW;
end;
$$;

drop trigger if exists profiles_lock_pay_method on public.profiles;
create trigger profiles_lock_pay_method
  before update on public.profiles
  for each row execute function public.profiles_lock_pay_method();
