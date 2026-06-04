-- Per-column monthly post goals for the Tracking page.
-- column_key matches POSTS_COLUMNS keys (e.g. 'tiktok', 'mm_yt_shorts', 'mm_yt_videos').
create table if not exists tracking_post_goals (
  id uuid primary key default gen_random_uuid(),
  column_key text not null,
  year int not null,
  month int not null,        -- 0-indexed (0 = Jan, 11 = Dec)
  goal int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (column_key, year, month)
);

alter table tracking_post_goals enable row level security;

create policy "Admins can read tracking_post_goals"
  on tracking_post_goals for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "Admins can insert tracking_post_goals"
  on tracking_post_goals for insert
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "Admins can update tracking_post_goals"
  on tracking_post_goals for update
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
