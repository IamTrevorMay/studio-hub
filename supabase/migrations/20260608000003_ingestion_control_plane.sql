-- Add health tracking columns to platform_accounts
alter table platform_accounts
  add column if not exists token_status text not null default 'unknown'
    check (token_status in ('valid', 'expired', 'revoked', 'unknown')),
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_error_message text,
  add column if not exists consecutive_failures int not null default 0;

-- Backfill last_success_at from most recent successful ingestion_log per account
update platform_accounts pa
set last_success_at = sub.latest
from (
  select platform_account_id, max(completed_at) as latest
  from ingestion_logs
  where status = 'success'
  group by platform_account_id
) sub
where pa.id = sub.platform_account_id
  and pa.last_success_at is null;

-- Atomic increment for consecutive_failures
create or replace function public.increment_consecutive_failures(p_account_id uuid)
returns void language sql security definer set search_path = public, pg_temp
as $$
  update platform_accounts
  set consecutive_failures = consecutive_failures + 1
  where id = p_account_id;
$$;

-- RPC to read cron job status (admin only, security definer)
create or replace function public.get_cron_status()
returns table (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  last_run_at timestamptz,
  last_status text,
  last_return_message text
)
language sql security definer set search_path = public, pg_temp
as $$
  select
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    d.start_time as last_run_at,
    d.status as last_status,
    d.return_message as last_return_message
  from cron.job j
  left join lateral (
    select start_time, status, return_message
    from cron.job_run_details
    where jobid = j.jobid
    order by start_time desc
    limit 1
  ) d on true
  order by j.jobname;
$$;
