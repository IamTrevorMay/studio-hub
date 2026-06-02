-- Lock admin-set columns on freelancer_profiles so a freelancer cannot
-- raise their own rate / change payment_type via the existing
-- "freelancer update own profile" or "freelancer insert own profile" RLS.
--
-- Implementation: BEFORE INSERT/UPDATE triggers that block non-admin
-- mutations to (rate, payment_type, hourly_rate, payment_method,
-- payment_details). On INSERT, the trigger also overwrites
-- payment_type + rate from the matching invitation row (looked up by the
-- new row's auth.users.email), so the AuthPage.js client-side upsert
-- cannot lie about its own payment terms.

-- ─── Block non-admin updates to locked columns ───────────────────────────
create or replace function public.fl_profile_lock_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin(auth.uid()) then
    return NEW;
  end if;
  if NEW.rate is distinct from OLD.rate
    or NEW.payment_type is distinct from OLD.payment_type
    or NEW.hourly_rate is distinct from OLD.hourly_rate
    or NEW.payment_method is distinct from OLD.payment_method
    or NEW.payment_details is distinct from OLD.payment_details
  then
    raise exception 'rate / payment_type / hourly_rate / payment_method / payment_details are admin-only fields';
  end if;
  return NEW;
end;
$$;

drop trigger if exists fl_profile_lock_admin_fields on public.freelancer_profiles;
create trigger fl_profile_lock_admin_fields
  before update on public.freelancer_profiles
  for each row execute function public.fl_profile_lock_admin_fields();

-- ─── On insert, overwrite payment fields from the user's invitation ──────
create or replace function public.fl_profile_set_payment_from_invitation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv_payment_type text;
  inv_rate numeric(10,2);
  user_email text;
begin
  if public.is_admin(auth.uid()) then
    return NEW;
  end if;

  select email into user_email from auth.users where id = NEW.id;

  if user_email is not null then
    select payment_type, rate
      into inv_payment_type, inv_rate
      from public.invitations
      where lower(email) = lower(user_email)
      order by created_at desc
      limit 1;
  end if;

  -- Hard-set from invitation; ignore whatever client sent.
  NEW.payment_type   := inv_payment_type;
  NEW.rate           := inv_rate;
  NEW.hourly_rate    := null;
  NEW.payment_method := null;
  NEW.payment_details:= null;
  return NEW;
end;
$$;

drop trigger if exists fl_profile_set_payment_from_invitation on public.freelancer_profiles;
create trigger fl_profile_set_payment_from_invitation
  before insert on public.freelancer_profiles
  for each row execute function public.fl_profile_set_payment_from_invitation();

-- ─── Tighten INSERT policy to require freelancer role ────────────────────
drop policy if exists "freelancer insert own profile" on public.freelancer_profiles;
create policy "freelancer insert own profile"
  on public.freelancer_profiles for insert
  with check (
    id = auth.uid()
    and public.is_freelancer(auth.uid())
  );
