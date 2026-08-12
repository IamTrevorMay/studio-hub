-- Hourly becomes a third pay type alongside per_period and yearly.
--
-- A member is on exactly one type, so the rate lives on the same payroll_salaries
-- row as a salary would (amount_cents = cents per hour). That replaces the
-- member_hourly_rates table added earlier today, which modelled an hourly rate
-- stacked ON TOP of a salary — dropped here, it never held data.

alter table public.payroll_salaries
  drop constraint if exists payroll_salaries_salary_type_check;

alter table public.payroll_salaries
  add constraint payroll_salaries_salary_type_check
  check (salary_type = any (array['per_period'::text, 'yearly'::text, 'hourly'::text]));

comment on column public.payroll_salaries.amount_cents is
  'Cents. Per period, per year, or per hour depending on salary_type.';

drop table if exists public.member_hourly_rates;
