-- Monthly accounting report snapshots. Three rows per month (scopes:
-- combined / mayday_media / neptune_performance), generated on the 3rd of
-- each month by the generate-monthly-report edge function (covering the
-- prior calendar month). `data` holds the computed P&L (totals + per-category
-- with MoM / trailing-3-month / YoY deltas and YTD totals), sponsor pipeline,
-- and vendor-level subscriptions audit; `narrative` holds the Claude-written
-- headline / wins / watch-outs / recommendations.

create table if not exists public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  month_start date not null,
  month_end date not null,
  scope text not null check (scope in ('combined', 'mayday_media', 'neptune_performance')),
  data jsonb not null default '{}'::jsonb,
  narrative jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One report per month per scope (re-running upserts rather than duplicating).
create unique index if not exists monthly_reports_month_scope_uniq
  on public.monthly_reports (month_start, scope);

alter table public.monthly_reports enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'monthly_reports_admin_all' and tablename = 'monthly_reports') then
    create policy "monthly_reports_admin_all" on public.monthly_reports
      for all using (
        exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      );
  end if;
end $$;

-- Generate on the 3rd of each month at 15:00 UTC (8am PT) — a couple of days
-- after month end so late-posting Tiller transactions have settled.
select cron.schedule(
  'generate-monthly-report',
  '0 15 3 * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/generate-monthly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$$
);
