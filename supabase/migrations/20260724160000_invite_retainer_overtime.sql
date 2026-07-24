-- Carry the hourly retainer/overtime settings through the contractor invite
-- flow so they can be set at invite time, not only after the contractor exists.
--
-- Flat columns on `invitations` mirror the existing `payment_type`/`rate`
-- columns (which the invite-user edge fn writes and the setup flow reads), so
-- the same read path and RLS cover them — no jsonb needed.
alter table public.invitations
  add column if not exists retainer_enabled    boolean,
  add column if not exists retainer_min_hours  numeric,
  add column if not exists overtime_enabled    boolean,
  add column if not exists overtime_max_hours  numeric,
  add column if not exists overtime_multiplier numeric;

-- Extend the BEFORE INSERT trigger so a contractor's freelancer_profiles row
-- gets its retainer/overtime settings from the *invitation* (admin-set),
-- server-side — never trusted from the setup client. Mirrors how payment_type
-- and rate are already hard-set here. Admins (is_admin) still bypass.
create or replace function public.fl_profile_set_payment_from_invitation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv record;
  user_email text;
begin
  if public.is_admin(auth.uid()) then
    return NEW;
  end if;

  select email into user_email from auth.users where id = NEW.id;

  if user_email is not null then
    select payment_type, rate,
           retainer_enabled, retainer_min_hours,
           overtime_enabled, overtime_max_hours, overtime_multiplier
      into inv
      from public.invitations
      where lower(email) = lower(user_email)
      order by created_at desc
      limit 1;
  end if;

  -- Hard-set from invitation; ignore whatever client sent.
  NEW.payment_type   := inv.payment_type;
  NEW.rate           := inv.rate;
  NEW.hourly_rate    := null;
  NEW.payment_method := null;
  NEW.payment_details:= null;
  -- Retainer / overtime: default to disabled + 1.5x when the invitation
  -- didn't set them (non-hourly or older invitations), satisfying the
  -- NOT NULL defaults on freelancer_profiles.
  NEW.retainer_enabled    := coalesce(inv.retainer_enabled, false);
  NEW.retainer_min_hours  := case when coalesce(inv.retainer_enabled, false) then inv.retainer_min_hours else null end;
  NEW.overtime_enabled    := coalesce(inv.overtime_enabled, false);
  NEW.overtime_max_hours  := case when coalesce(inv.overtime_enabled, false) then inv.overtime_max_hours else null end;
  NEW.overtime_multiplier := coalesce(inv.overtime_multiplier, 1.5);
  return NEW;
end;
$$;
