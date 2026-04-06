-- Track posted daily graphics to prevent duplicates
create table if not exists public.daily_graphics_posts (
  id bigint generated always as identity primary key,
  date date not null unique,
  post_id text,
  format_used text,
  media_ids text[],
  posted_at timestamptz not null default now()
);

alter table public.daily_graphics_posts enable row level security;

create policy "Authenticated users can read daily_graphics_posts"
  on public.daily_graphics_posts for select
  to authenticated
  using (true);

-- Cron: post daily graphics carousel at 5:15am PST (13:15 UTC)
select cron.schedule(
  'daily-post-graphics',
  '15 13 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/post-daily-graphics?secret=300897BA-1E26-4328-97E8-FFB11BCF2C6D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);
