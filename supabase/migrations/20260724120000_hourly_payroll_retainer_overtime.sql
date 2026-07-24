-- Hourly-contractor payroll: retainer floor, marginal overtime, gated overtime
-- approval, and a single-source-of-truth pay-computation function.
--
-- MONEY-CRITICAL. The authoritative pay math lives in
-- public.compute_freelancer_pay(...) so the client display and any future
-- payroll export share one implementation that a human can review.
--
-- Model summary (per RETAINER period; two per bi-weekly pay period):
--   A = sum(hours_spent) of assignments completed (by completed_at, PT) in window
--   R = retainer_min_hours if retainer_enabled else 0   (a FLOOR)
--   M = overtime_max_hours   x = overtime_multiplier   rate = hourly rate
--   - overtime OFF or NOT approved: pay = max(A,R) * rate            (no multiplier)
--   - overtime ON + approved + A>M: pay = max(M,R)*rate + (A-M)*rate*x (marginal)
--   - overtime ON + approved + A<=M: pay = max(A,R) * rate
-- Assumes R <= M.
--
-- Retainer-period boundaries (PT calendar days of the month):
--   pay period 1–15  -> [1–7] and [8–15]
--   pay period 16–EOM-> [16–22] and [23–EOM]
-- Overtime cap resets per retainer period (twice per pay period).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Settings columns on freelancer_profiles (1:1 with the contractor; no
--    history needed, admin-overwritten — columns beat a join table here).
-- ─────────────────────────────────────────────────────────────────────────
alter table public.freelancer_profiles
  add column if not exists retainer_enabled   boolean not null default false,
  add column if not exists retainer_min_hours numeric,
  add column if not exists overtime_enabled   boolean not null default false,
  add column if not exists overtime_max_hours numeric,
  add column if not exists overtime_multiplier numeric not null default 1.5;

-- Extend the existing column-lock trigger so a contractor cannot raise their
-- own retainer/overtime settings via "freelancer update own profile" RLS.
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
    or NEW.retainer_enabled is distinct from OLD.retainer_enabled
    or NEW.retainer_min_hours is distinct from OLD.retainer_min_hours
    or NEW.overtime_enabled is distinct from OLD.overtime_enabled
    or NEW.overtime_max_hours is distinct from OLD.overtime_max_hours
    or NEW.overtime_multiplier is distinct from OLD.overtime_multiplier
  then
    raise exception 'rate / payment / retainer / overtime are admin-only fields';
  end if;
  return NEW;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Overtime-approval ledger (one row per contractor per retainer window).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.freelancer_overtime_approvals (
  id uuid primary key default gen_random_uuid(),
  freelancer_id uuid not null references public.profiles(id) on delete cascade,
  retainer_start date not null,
  retainer_end   date not null,
  status text not null default 'pending'
    check (status in ('pending','approved','declined','cancelled')),
  trigger_assignment_id uuid references public.freelancer_assignments(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (freelancer_id, retainer_start, retainer_end)
);

alter table public.freelancer_overtime_approvals enable row level security;

-- Admin-tier (is_admin covers admin + both directors) manages approvals.
drop policy if exists "admin full access on ot approvals" on public.freelancer_overtime_approvals;
create policy "admin full access on ot approvals"
  on public.freelancer_overtime_approvals for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Contractors can read (not write) their own approval rows.
drop policy if exists "freelancer read own ot approvals" on public.freelancer_overtime_approvals;
create policy "freelancer read own ot approvals"
  on public.freelancer_overtime_approvals for select
  using (freelancer_id = auth.uid());

create index if not exists idx_ot_approvals_freelancer_window
  on public.freelancer_overtime_approvals (freelancer_id, retainer_start, retainer_end);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. PT-aware retainer-window helper. Given a PT calendar date, returns the
--    [start,end] of the retainer period that contains it.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fl_retainer_window(d date, out ws date, out we date)
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  dd int := extract(day from d)::int;
  y  int := extract(year from d)::int;
  mo int := extract(month from d)::int;
  eom date := (date_trunc('month', d) + interval '1 month - 1 day')::date;
begin
  if dd <= 7 then
    ws := make_date(y, mo, 1);  we := make_date(y, mo, 7);
  elsif dd <= 15 then
    ws := make_date(y, mo, 8);  we := make_date(y, mo, 15);
  elsif dd <= 22 then
    ws := make_date(y, mo, 16); we := make_date(y, mo, 22);
  else
    ws := make_date(y, mo, 23); we := eom;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Authoritative pay computation. SECURITY DEFINER; admins (any contractor)
--    or the contractor themselves (own row only) may call it.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.compute_freelancer_pay(
  p_freelancer uuid, p_start date, p_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  fp record;
  w1s date; w1e date; w2s date; w2e date;
  windows jsonb := '[]'::jsonb;
  wstart date; wend date;
  a numeric; r numeric; m numeric; x numeric; rate numeric;
  base_hours numeric; ot_hours numeric; pay numeric;
  floor_applied boolean; approved boolean;
  total_hours numeric := 0; total_pay numeric := 0;
  i int;
begin
  if not (public.is_admin(auth.uid()) or auth.uid() = p_freelancer) then
    raise exception 'not authorized';
  end if;

  select fpr.payment_type,
         coalesce(fpr.rate,0)               as rate,
         coalesce(fpr.retainer_enabled,false) as retainer_enabled,
         fpr.retainer_min_hours,
         coalesce(fpr.overtime_enabled,false) as overtime_enabled,
         fpr.overtime_max_hours,
         coalesce(fpr.overtime_multiplier,1.5) as overtime_multiplier
    into fp
    from public.freelancer_profiles fpr
   where fpr.id = p_freelancer;

  rate := coalesce(fp.rate, 0);
  x    := coalesce(fp.overtime_multiplier, 1.5);

  select ws, we into w1s, w1e from public.fl_retainer_window(p_start);
  select ws, we into w2s, w2e from public.fl_retainer_window(w1e + 1);

  for i in 1..2 loop
    if i = 1 then wstart := w1s; wend := w1e; else wstart := w2s; wend := w2e; end if;

    select coalesce(sum(hours_spent), 0) into a
      from public.freelancer_assignments
     where freelancer_id = p_freelancer
       and hours_spent is not null
       and completed_at is not null
       and (completed_at at time zone 'America/Los_Angeles')::date between wstart and wend;

    r := case when fp.retainer_enabled then coalesce(fp.retainer_min_hours, 0) else 0 end;
    m := fp.overtime_max_hours;

    select exists (
      select 1 from public.freelancer_overtime_approvals
       where freelancer_id = p_freelancer
         and retainer_start = wstart and retainer_end = wend
         and status = 'approved'
    ) into approved;

    if fp.overtime_enabled and approved and m is not null and a > m then
      base_hours := greatest(m, r);
      ot_hours   := a - m;
      pay        := base_hours * rate + ot_hours * rate * x;
    else
      base_hours := greatest(a, r);
      ot_hours   := 0;
      pay        := base_hours * rate;
    end if;
    floor_applied := (r > a);

    windows := windows || jsonb_build_object(
      'window_start',   wstart,
      'window_end',     wend,
      'hours',          a,
      'retainer_min',   r,
      'overtime_max',   m,
      'overtime_multiplier', x,
      'approved',       approved,
      'base_hours',     base_hours,
      'overtime_hours', ot_hours,
      'floor_applied',  floor_applied,
      'pay',            round(pay, 2)
    );
    total_hours := total_hours + a;
    total_pay   := total_pay + pay;
  end loop;

  return jsonb_build_object(
    'freelancer_id',       p_freelancer,
    'period_start',        p_start,
    'period_end',          p_end,
    'payment_type',        fp.payment_type,
    'rate',                rate,
    'retainer_enabled',    fp.retainer_enabled,
    'overtime_enabled',    fp.overtime_enabled,
    'overtime_multiplier', x,
    'windows',             windows,
    'total_hours',         total_hours,
    'total_pay',           round(total_pay, 2)
  );
end;
$$;

revoke all on function public.compute_freelancer_pay(uuid, date, date) from anon, public;
grant execute on function public.compute_freelancer_pay(uuid, date, date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Overtime-approval TRIGGER: when an hourly contractor STARTS an assignment
--    (status -> in_progress) and their accumulated hours in the current
--    retainer window are within 5h of the overtime cap, open an approval and
--    task all admins + director_creative users. Fail-open: any error is
--    swallowed so starting work is never blocked (missing approval only ever
--    means normal-rate pay, never overpay).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fl_overtime_check_on_start()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fp record;
  pt_today date;
  r_start date; r_end date;
  a numeric;
  appr_id uuid;
  fl_name text;
  rec record;
  desc_text text;
begin
  if NEW.status <> 'in_progress' or OLD.status is not distinct from NEW.status
     or OLD.status = 'in_progress' then
    return NEW;
  end if;

  begin
    select payment_type, coalesce(overtime_enabled,false) as overtime_enabled,
           overtime_max_hours, coalesce(overtime_multiplier,1.5) as overtime_multiplier
      into fp
      from public.freelancer_profiles
     where id = NEW.freelancer_id;

    if fp.payment_type is distinct from 'hourly'
       or not fp.overtime_enabled
       or fp.overtime_max_hours is null then
      return NEW;
    end if;

    pt_today := (now() at time zone 'America/Los_Angeles')::date;
    select ws, we into r_start, r_end from public.fl_retainer_window(pt_today);

    select coalesce(sum(hours_spent), 0) into a
      from public.freelancer_assignments
     where freelancer_id = NEW.freelancer_id
       and hours_spent is not null
       and completed_at is not null
       and (completed_at at time zone 'America/Los_Angeles')::date between r_start and r_end;

    if a < fp.overtime_max_hours - 5 then
      return NEW;
    end if;

    -- Idempotent per retainer window: only open one approval.
    if exists (
      select 1 from public.freelancer_overtime_approvals
       where freelancer_id = NEW.freelancer_id
         and retainer_start = r_start and retainer_end = r_end
    ) then
      return NEW;
    end if;

    insert into public.freelancer_overtime_approvals
      (freelancer_id, retainer_start, retainer_end, status, trigger_assignment_id)
      values (NEW.freelancer_id, r_start, r_end, 'pending', NEW.id)
      returning id into appr_id;

    select full_name into fl_name from public.profiles where id = NEW.freelancer_id;
    fl_name := coalesce(fl_name, 'A contractor');

    desc_text :=
      fl_name || ' has ' || round(a, 2) || 'h logged this retainer period ('
      || to_char(r_start, 'Mon DD') || '–' || to_char(r_end, 'Mon DD')
      || '), within 5h of their ' || fp.overtime_max_hours || 'h overtime cap. '
      || 'Completing this task APPROVES overtime pay (' || fp.overtime_multiplier
      || 'x rate) for hours above the cap in this window. '
      || 'If no one approves, all hours are paid at the normal rate.';

    for rec in
      select id from public.profiles
       where role in ('admin', 'director_creative')
         and coalesce(status, 'active') <> 'archived'
    loop
      insert into public.tasks
        (step_key, title, description, assignee_id, status, position,
         related_entity_type, related_entity_id, nav_target, dedup_key)
      values
        ('confirm_overtime',
         'Approve overtime: ' || fl_name,
         desc_text,
         rec.id, 'active', 0,
         'overtime_approval', appr_id, 'freelancers',
         'ot_' || appr_id::text || '_' || rec.id::text);

      insert into public.notifications
        (user_id, type, title, body, link_tab)
      values
        (rec.id, 'fl_overtime_approval', 'Overtime approval needed',
         fl_name || ' is nearing their overtime cap — review in My Tasks.',
         'freelancers');
    end loop;
  exception when others then
    -- Never block the contractor's status change on a side-effect failure.
    raise warning 'fl_overtime_check_on_start failed for assignment %: %', NEW.id, sqlerrm;
    return NEW;
  end;

  return NEW;
end;
$$;

drop trigger if exists fl_overtime_check_on_start on public.freelancer_assignments;
create trigger fl_overtime_check_on_start
  after update on public.freelancer_assignments
  for each row execute function public.fl_overtime_check_on_start();

-- Trigger functions run as table owner via the trigger; they must not be
-- callable directly over the REST RPC surface.
revoke execute on function public.fl_overtime_check_on_start() from anon, authenticated, public;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Approval TRIGGER: completing any confirm_overtime task approves the
--    linked window and clears the sibling tasks from everyone else's queue.
--    Bounded recursion: siblings flip to 'complete' but the approval is then
--    no longer 'pending', so the guard short-circuits.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fl_overtime_task_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  appr record;
begin
  if NEW.related_entity_type is distinct from 'overtime_approval'
     or NEW.related_entity_id is null then
    return NEW;
  end if;
  if NEW.status <> 'complete' or OLD.status = 'complete' then
    return NEW;
  end if;

  select * into appr
    from public.freelancer_overtime_approvals
   where id = NEW.related_entity_id
   for update;
  if not found or appr.status <> 'pending' then
    return NEW;
  end if;

  update public.freelancer_overtime_approvals
     set status = 'approved',
         approved_by = NEW.assignee_id,
         approved_at = now()
   where id = appr.id;

  update public.tasks
     set status = 'complete', completed_at = now()
   where related_entity_type = 'overtime_approval'
     and related_entity_id = appr.id
     and id <> NEW.id
     and status in ('pending', 'active', 'on_hold');

  return NEW;
end;
$$;

drop trigger if exists fl_overtime_task_completed on public.tasks;
create trigger fl_overtime_task_completed
  after update on public.tasks
  for each row execute function public.fl_overtime_task_completed();

revoke execute on function public.fl_overtime_task_completed() from anon, authenticated, public;
