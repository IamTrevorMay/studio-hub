-- Automations system: trigger→action rules that replace single-step "code" workflows.
-- Supports schedule-based (cron-like) and event-based triggers.

-- ─── automations table ───────────────────────────────────────────
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_enabled boolean not null default true,
  trigger_type text not null check (trigger_type in ('schedule', 'event')),
  trigger_config jsonb not null default '{}'::jsonb,
  conditions jsonb,
  actions jsonb not null default '[]'::jsonb,
  dedup_key text,
  last_run_at timestamptz,
  last_error text,
  run_count integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Updated_at trigger
create trigger set_automations_updated_at
  before update on public.automations
  for each row execute function public.set_updated_at();

-- RLS: admin-only
alter table public.automations enable row level security;

create policy "Admins can do everything on automations"
  on public.automations for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ─── automation_runs table (audit log) ───────────────────────────
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  trigger_payload jsonb,
  actions_taken jsonb,
  status text not null check (status in ('success', 'skipped', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

-- RLS: admin-only read
alter table public.automation_runs enable row level security;

create policy "Admins can read automation_runs"
  on public.automation_runs for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can insert automation_runs"
  on public.automation_runs for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Index for fetching recent runs per automation
create index idx_automation_runs_automation_id on public.automation_runs(automation_id, created_at desc);

-- ─── Add automation_id to tasks ──────────────────────────────────
alter table public.tasks add column if not exists automation_id uuid references public.automations(id) on delete set null;
alter table public.tasks add column if not exists link_url text;

-- Index for dedup checks
create index idx_tasks_automation_dedup on public.tasks(automation_id) where automation_id is not null;

-- ─── RPC: increment run_count atomically ─────────────────────────
create or replace function public.increment_automation_run_count(automation_uuid uuid)
returns void
language sql
security definer
as $$
  update public.automations
  set run_count = run_count + 1
  where id = automation_uuid;
$$;

-- ─── Cron: run-automations hourly ────────────────────────────────
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'hourly-run-automations',
  '0 * * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/run-automations?secret=300897BA-1E26-4328-97E8-FFB11BCF2C6D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);
