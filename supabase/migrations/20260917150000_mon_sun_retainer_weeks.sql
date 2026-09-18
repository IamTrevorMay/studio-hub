-- Retainer / overtime windows become real Monday–Sunday weeks.
--
-- MONEY-CRITICAL.
--
-- Was: fl_retainer_window() bucketed by day of the month — [1–7], [8–15],
-- [16–22], [23–EOM]. Those buckets are 6 to 9 days long and never line up with
-- a real week, which produced two bugs:
--
--   1. A burst of work was split or merged by an arbitrary date boundary. The
--      8-day [8–15] bucket in particular swallows the Monday of the following
--      week, so steady 20h weeks showed up as a 28.5h window (billing 8.5h of
--      overtime that never happened) followed by a 15h window.
--   2. Four windows a month = 48 a year, not 52. Every hourly person lost four
--      retainer floors and four 20h pre-overtime allowances per year, which
--      pushed genuine work into the overtime multiplier early.
--
-- Now: a window is the Mon–Sun week containing the date, and a week is PAID IN
-- THE PAY PERIOD THAT CONTAINS ITS SUNDAY. Periods stay semi-monthly (1–15,
-- 16–EOM) and every week lands in exactly one of them, so nothing is dropped or
-- double-counted — but a period now holds 2 OR 3 weeks instead of always 2.
--
-- Consequence to expect: a pay period's window hours no longer equal the hours
-- logged between period_start and period_end, because a straddling week is paid
-- whole in the period holding its Sunday. That is the point of the rule.

-- ── A window is the Mon–Sun week containing d ───────────────────────────────
-- date_trunc('week', …) is ISO: Monday is day 1.
create or replace function public.fl_retainer_window(d date, out ws date, out we date)
language plpgsql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $$
begin
  ws := date_trunc('week', d::timestamp)::date;
  we := ws + 6;
end;
$$;

comment on function public.fl_retainer_window(date) is
  'The Mon-Sun retainer week containing d. Replaced the day-of-month buckets on 2026-09-17.';

-- ── The weeks a pay period pays for ─────────────────────────────────────────
-- Every week whose SUNDAY falls inside [p_start, p_end]. Semi-monthly periods
-- partition the calendar, so each week qualifies for exactly one period.
-- Returns 2 or 3 rows for a normal period, never 0.
create or replace function public.fl_retainer_windows_in_period(p_start date, p_end date)
returns table (ws date, we date)
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $$
  select g::date, g::date + 6
    from generate_series(
           date_trunc('week', p_start::timestamp),
           date_trunc('week', p_end::timestamp),
           interval '7 days'
         ) g
   -- The week holding p_start always ends on/after p_start, so it always
   -- qualifies; the week holding p_end qualifies only if p_end IS its Sunday
   -- (otherwise that week belongs to the next period).
   where (g::date + 6) between p_start and p_end
   order by 1;
$$;

comment on function public.fl_retainer_windows_in_period(date, date) is
  'Mon-Sun weeks paid in a pay period: those whose Sunday falls in [p_start, p_end].';

-- ── Pay computation over a variable number of weeks ─────────────────────────
-- Identical math (retainer floor, marginal overtime, approval gate); only the
-- window set changed from a hard-coded pair to whatever the period covers.
create or replace function public.compute_freelancer_pay(p_freelancer uuid, p_start date, p_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  fp record;
  w record;
  windows jsonb := '[]'::jsonb;
  wstart date; wend date;
  a numeric; r numeric; m numeric; x numeric; rate numeric;
  base_hours numeric; ot_hours numeric; pay numeric;
  floor_applied boolean; approved boolean;
  total_hours numeric := 0; total_pay numeric := 0;
  n_windows int := 0;
begin
  if not (public.is_admin(auth.uid()) or auth.uid() = p_freelancer) then
    raise exception 'not authorized';
  end if;

  select * into fp from public.hourly_pay_config(p_freelancer);
  rate := coalesce(fp.rate, 0);
  x    := coalesce(fp.overtime_multiplier, 1.5);

  for w in select ws, we from public.fl_retainer_windows_in_period(p_start, p_end) loop
    wstart := w.ws; wend := w.we;

    a := public.hourly_hours_in_window(p_freelancer, wstart, wend);
    r := case when fp.retainer_enabled then coalesce(fp.retainer_min_hours, 0) else 0 end;
    m := fp.overtime_max_hours;

    select exists (
      select 1 from public.contractor_overtime_approvals
       where contractor_id = p_freelancer
         and retainer_start = wstart and retainer_end = wend
         and status = 'approved'
    ) into approved;

    if fp.overtime_enabled and approved and m is not null and a > m then
      base_hours := greatest(m, r); ot_hours := a - m;
      pay := base_hours * rate + ot_hours * rate * x;
    else
      base_hours := greatest(a, r); ot_hours := 0;
      pay := base_hours * rate;
    end if;

    floor_applied := (r > a);
    windows := windows || jsonb_build_object(
      'window_start', wstart, 'window_end', wend, 'hours', a,
      'retainer_min', r, 'overtime_max', m, 'overtime_multiplier', x,
      'approved', approved, 'base_hours', base_hours, 'overtime_hours', ot_hours,
      'floor_applied', floor_applied, 'pay', round(pay, 2));
    total_hours := total_hours + a;
    total_pay := total_pay + pay;
    n_windows := n_windows + 1;
  end loop;

  return jsonb_build_object(
    'freelancer_id', p_freelancer, 'period_start', p_start, 'period_end', p_end,
    'payment_type', case when fp.is_hourly then 'hourly' else 'other' end,
    'rate', rate, 'retainer_enabled', fp.retainer_enabled,
    'overtime_enabled', fp.overtime_enabled, 'overtime_multiplier', x,
    'window_rule', 'mon_sun_week_paid_in_period_of_its_sunday',
    'window_count', n_windows,
    -- First Monday / last Sunday actually paid here. The UI reads these to
    -- explain why the weeks can reach outside the pay period.
    'covered_start', (windows -> 0 ->> 'window_start'),
    'covered_end',   (windows -> (n_windows - 1) ->> 'window_end'),
    'windows', windows, 'total_hours', total_hours, 'total_pay', round(total_pay, 2));
end;
$$;

revoke all on function public.compute_freelancer_pay(uuid, date, date) from anon, public;
grant execute on function public.compute_freelancer_pay(uuid, date, date) to authenticated;

-- ── Carry existing overtime approvals onto the new weeks ────────────────────
-- An approval is keyed by its window bounds, so the old day-of-month rows can
-- never match a week and every past approval would silently evaporate — which
-- would REDUCE already-paid historical pay on screen.
--
-- Each approved row is re-issued for the weeks whose Sunday falls inside the
-- window an admin actually approved. Only 'approved' rows migrate: there are no
-- pending rows today, and a pending one must keep pointing at the approval id
-- its confirm_overtime task carries. The originals are left in place as the
-- audit trail of what was approved and when; nothing reads them any more.
insert into public.contractor_overtime_approvals
  (contractor_id, retainer_start, retainer_end, status, trigger_assignment_id,
   approved_by, approved_at, created_at)
select a.contractor_id, w.ws, w.we, a.status, a.trigger_assignment_id,
       a.approved_by, a.approved_at, a.created_at
  from public.contractor_overtime_approvals a
  cross join lateral public.fl_retainer_windows_in_period(a.retainer_start, a.retainer_end) w
 where a.status = 'approved'
on conflict (contractor_id, retainer_start, retainer_end) do nothing;
