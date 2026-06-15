create table public.stats_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  query_text text not null,
  tool_name text not null default 'query_database',
  tool_args jsonb not null default '{}'::jsonb,
  summary text,
  result_data jsonb,
  row_count integer,
  error_message text,
  created_at timestamptz not null default now()
);

create index idx_stats_queries_created_at on public.stats_queries(created_at desc);
create index idx_stats_queries_user_id on public.stats_queries(user_id, created_at desc);

alter table public.stats_queries enable row level security;

-- All authenticated users can read all queries (global history)
create policy "Authenticated users can read all stats_queries"
  on public.stats_queries for select
  using (auth.uid() is not null);

-- Users can only insert their own queries
create policy "Authenticated users can insert own stats_queries"
  on public.stats_queries for insert
  with check (auth.uid() = user_id);
