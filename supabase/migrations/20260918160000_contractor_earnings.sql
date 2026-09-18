-- Contractor portal "Earnings": what the signed-in contractor completed in a
-- pay period and what it comes to, computed the way Payroll computes it.
--
--   hourly   → compute_freelancer_pay() (Mon–Sun retainer weeks paid in the
--              period holding their Sunday, retainer floor, approved overtime)
--   project  → sum of pay_amount on assignments completed in the period
--
-- Also reports whether Payroll has marked the period paid (payroll_paid is
-- admin-only, so this is the contractor's only window onto it). Admin one-off
-- items are keyed by free-text payee and are not attributable — excluded.
create or replace function public.contractor_earnings(p_start date, p_end date)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  fp record;
  cfp jsonb;
  completed jsonb;
  n_completed int;
  project_cents bigint;
  amount_cents bigint;
  hours numeric := 0;
  floor_applied boolean := false;
  overtime_applied boolean := false;
  is_paid boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select role into v_role from public.profiles where id = v_uid;
  if v_role <> 'contractor' then
    raise exception 'contractors only';
  end if;

  -- Completed in the period, attributed by the PT calendar day of completion
  -- (matches Payroll's ptDateToUtcISO window).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'title', a.title, 'completed_at', a.completed_at,
           'hours_spent', a.hours_spent,
           'pay_cents', case when a.pay_amount is not null then round(a.pay_amount * 100)::bigint else null end
         ) order by a.completed_at desc), '[]'::jsonb),
         count(*),
         coalesce(sum(case when a.pay_amount is not null then round(a.pay_amount * 100)::bigint else 0 end), 0)
    into completed, n_completed, project_cents
  from public.contractor_assignments a
  where a.contractor_id = v_uid
    and a.status = 'completed'
    and a.declined_at is null
    and a.completed_at is not null
    and (a.completed_at at time zone 'America/Los_Angeles')::date between p_start and p_end;

  select * into fp from public.hourly_pay_config(v_uid);

  if fp.is_hourly then
    cfp := public.compute_freelancer_pay(v_uid, p_start, p_end);
    amount_cents := round(coalesce((cfp->>'total_pay')::numeric, 0) * 100)::bigint;
    hours := coalesce((cfp->>'total_hours')::numeric, 0);
    select coalesce(bool_or((w->>'floor_applied')::boolean), false),
           coalesce(bool_or(coalesce((w->>'overtime_hours')::numeric, 0) > 0), false)
      into floor_applied, overtime_applied
    from jsonb_array_elements(coalesce(cfp->'windows', '[]'::jsonb)) w;
  else
    amount_cents := project_cents;
  end if;

  select exists (select 1 from public.payroll_paid
                  where profile_id = v_uid and period_start = p_start)
    into is_paid;

  return jsonb_build_object(
    'period_start', p_start,
    'period_end', p_end,
    'payment_type', case when fp.is_hourly then 'hourly' else 'project' end,
    'rate', fp.rate,
    'completed_count', n_completed,
    'completed', completed,
    'hours', hours,
    'floor_applied', floor_applied,
    'overtime_applied', overtime_applied,
    'amount_cents', amount_cents,
    'paid', is_paid
  );
end;
$$;

revoke all on function public.contractor_earnings(date, date) from public, anon;
grant execute on function public.contractor_earnings(date, date) to authenticated;
