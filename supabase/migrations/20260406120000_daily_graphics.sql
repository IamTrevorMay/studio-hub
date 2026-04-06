-- Table to cache daily graphics metadata from Triton
create table if not exists public.daily_graphics (
  id bigint generated always as identity primary key,
  date date not null,
  type text not null,
  url text not null,
  fetched_at timestamptz not null default now(),
  unique (date, type)
);

-- RLS: read for authenticated, write via service role only
alter table public.daily_graphics enable row level security;

create policy "Authenticated users can read daily_graphics"
  on public.daily_graphics for select
  to authenticated
  using (true);

-- Index for date lookups
create index if not exists idx_daily_graphics_date on public.daily_graphics (date desc);

-- Cron: fetch daily graphics at 5am PST (13:00 UTC)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'daily-fetch-graphics',
  '0 13 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/fetch-daily-graphics?secret=300897BA-1E26-4328-97E8-FFB11BCF2C6D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);
