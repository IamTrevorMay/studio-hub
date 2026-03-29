-- Research Inbox State: tracks read/archived status for inbox items
create table if not exists research_inbox_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('brief', 'cards', 'trends')),
  item_date date not null,
  read boolean not null default false,
  archived_at timestamptz,
  unique (user_id, item_type, item_date)
);

alter table research_inbox_state enable row level security;

create policy "Users can view own inbox state"
  on research_inbox_state for select
  using (auth.uid() = user_id);

create policy "Users can insert own inbox state"
  on research_inbox_state for insert
  with check (auth.uid() = user_id);

create policy "Users can update own inbox state"
  on research_inbox_state for update
  using (auth.uid() = user_id);

create policy "Users can delete own inbox state"
  on research_inbox_state for delete
  using (auth.uid() = user_id);

-- Research Trends: stores daily trend reports
create table if not exists research_trends (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  summary text,
  current_events jsonb default '[]'::jsonb,
  evergreen jsonb default '[]'::jsonb,
  source_count integer default 0,
  created_at timestamptz not null default now()
);

alter table research_trends enable row level security;

create policy "Authenticated users can read trends"
  on research_trends for select
  to authenticated
  using (true);
