-- Admin-confirmation gate for automations.
-- When automations.requires_confirmation = true, run-automations does NOT execute
-- the actions on trigger. Instead it logs a pending_confirmation run and creates
-- a confirmation task for the chosen admin (or all admins if none chosen).
-- approve-automation edge fn then either executes the actions (success) or
-- cancels (error).

alter table public.automations
  add column if not exists requires_confirmation boolean not null default false,
  add column if not exists confirmation_admin_id uuid references public.profiles(id) on delete set null;

-- Allow pending_confirmation status on automation_runs
alter table public.automation_runs
  drop constraint if exists automation_runs_status_check;
alter table public.automation_runs
  add constraint automation_runs_status_check
    check (status in ('success', 'skipped', 'error', 'pending_confirmation'));

-- Track which automation_run a confirmation task belongs to
alter table public.tasks
  add column if not exists confirmation_run_id uuid references public.automation_runs(id) on delete set null;

create index if not exists idx_tasks_confirmation_run_id
  on public.tasks(confirmation_run_id)
  where confirmation_run_id is not null;
