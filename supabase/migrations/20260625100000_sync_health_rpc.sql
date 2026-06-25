-- Sync health overview: one row per active platform_accounts entry with
-- staleness indicators, failure counts, and yesterday's data presence.
create or replace function public.get_sync_health()
returns table (
  platform_account_id uuid,
  platform text,
  account_name text,
  last_synced_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  consecutive_failures int,
  token_status text,
  hours_since_success double precision,
  yesterday_row_count bigint,
  expected_row_count bigint
)
language sql security definer set search_path = public, pg_temp
as $$
  select
    pa.id as platform_account_id,
    pa.platform,
    pa.account_name,
    pa.last_synced_at,
    pa.last_success_at,
    pa.last_error_at,
    pa.last_error_message,
    pa.consecutive_failures,
    pa.token_status,
    extract(epoch from (now() - pa.last_success_at)) / 3600.0 as hours_since_success,
    coalesce(pdm.cnt, 0) as yesterday_row_count,
    1::bigint as expected_row_count
  from platform_accounts pa
  left join (
    select platform_account_id, count(*) as cnt
    from platform_daily_metrics
    where date = (current_date - interval '1 day')::date
    group by platform_account_id
  ) pdm on pdm.platform_account_id = pa.id
  where pa.is_active = true
  order by pa.platform, pa.account_name;
$$;
