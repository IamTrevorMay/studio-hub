-- Generic rate-limit log table for public (unauthenticated) edge fns. Used
-- by jobs-apply to throttle submissions by email and source IP, but is
-- intentionally generic so future public endpoints can reuse it.

create table if not exists public.public_rate_limits (
  id bigint generated always as identity primary key,
  bucket text not null,
  key text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_public_rate_limits_bucket_key_created
  on public.public_rate_limits (bucket, key, created_at desc);

alter table public.public_rate_limits enable row level security;
-- No policies = deny for client roles; service role bypasses RLS.

create or replace function public.prune_public_rate_limits()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.public_rate_limits
  where created_at < now() - interval '7 days';
$$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'prune-public-rate-limits') then
    perform cron.schedule(
      'prune-public-rate-limits',
      '0 4 * * *',
      $cron$select public.prune_public_rate_limits();$cron$
    );
  end if;
end $$;
