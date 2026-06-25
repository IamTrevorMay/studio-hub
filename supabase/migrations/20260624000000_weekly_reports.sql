-- Weekly KPI report snapshots. One row per reporting week, generated every
-- Saturday by the generate-weekly-report edge function. `data` holds the
-- computed KPIs (totals, per-platform, content, revenue, cadence) with
-- week-over-week and trailing-4-week-average deltas; `narrative` holds the
-- Claude-written wins / watch-outs / recommendations.

create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  data jsonb not null default '{}'::jsonb,
  narrative jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One report per week (re-running upserts rather than duplicating).
create unique index if not exists weekly_reports_week_start_uniq
  on public.weekly_reports (week_start);

alter table public.weekly_reports enable row level security;

create policy "weekly_reports_admin_all" on public.weekly_reports
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
