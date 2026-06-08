-- Authenticated rate limiting table for edge functions
create table if not exists public.authenticated_rate_limits (
  id bigint generated always as identity primary key,
  bucket text not null,
  user_id uuid not null,
  created_at timestamptz not null default now()
);

create index idx_auth_rate_limits_lookup
  on authenticated_rate_limits (bucket, user_id, created_at desc);

alter table authenticated_rate_limits enable row level security;

-- No RLS policies needed — only service role accesses this table from edge functions

-- Prune entries older than 1 day
create or replace function public.prune_authenticated_rate_limits()
returns void language sql security definer set search_path = public, pg_temp
as $$ delete from authenticated_rate_limits where created_at < now() - interval '1 day'; $$;

-- Schedule daily prune at 3am UTC
select cron.schedule(
  'prune-auth-rate-limits',
  '0 3 * * *',
  $$select public.prune_authenticated_rate_limits()$$
);
