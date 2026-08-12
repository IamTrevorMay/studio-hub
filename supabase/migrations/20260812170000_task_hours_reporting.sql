-- "Report Hours to Complete" for member assignment tasks.
--
-- An admin can flag a one-off task so its assignee must report the hours they
-- spent before it can be marked complete. Those hours roll up per pay period in
-- Payroll and are paid at the member's hourly rate ON TOP of their salary.

-- ── tasks: the flag + the reported number ──────────────────────────
alter table public.tasks
  add column if not exists requires_hours boolean not null default false,
  add column if not exists hours_spent numeric(6,2),
  add column if not exists hours_reported_at timestamptz;

comment on column public.tasks.requires_hours is
  'Assignee must report hours_spent before this task can be completed.';
comment on column public.tasks.hours_spent is
  'Hours reported at completion. Paid at the assignee hourly rate in Payroll.';

alter table public.tasks
  drop constraint if exists tasks_hours_spent_range;
alter table public.tasks
  add constraint tasks_hours_spent_range
  check (hours_spent is null or (hours_spent > 0 and hours_spent <= 500));

-- Payroll reads completed hour-reporting tasks by period.
create index if not exists tasks_hours_payroll_idx
  on public.tasks (assignee_id, completed_at)
  where requires_hours and hours_spent is not null;

-- ── Member hourly rates ────────────────────────────────────────────
-- Separate from payroll_salaries: this rate only prices reported task hours,
-- and a member can have one without a salary row (or vice versa).
create table if not exists public.member_hourly_rates (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  rate_cents  integer not null check (rate_cents >= 0),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.member_hourly_rates is
  'Hourly rate used to pay reported task hours (tasks.requires_hours). Added on top of any salary.';

alter table public.member_hourly_rates enable row level security;

drop policy if exists "Admins manage member hourly rates" on public.member_hourly_rates;
create policy "Admins manage member hourly rates"
  on public.member_hourly_rates
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Members may read their own rate (so the hours prompt can show what it's worth).
drop policy if exists "Members read own hourly rate" on public.member_hourly_rates;
create policy "Members read own hourly rate"
  on public.member_hourly_rates
  for select
  to authenticated
  using (profile_id = auth.uid());
