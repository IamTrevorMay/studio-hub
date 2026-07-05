-- Phase 1: surface "stale data" in get_sync_health.
--
-- The widget previously showed an account GREEN whenever it synced recently and
-- had yesterday's row — but a platform API serving cached/identical data (the
-- TikTok cumulative flat-line and YouTube "same 167 video IDs" symptoms) passes
-- both of those checks while the numbers are silently frozen. We add a
-- conservative cached-response detector: if an account's daily views are
-- byte-identical and > 0 across the last 3 consecutive days, it's almost
-- certainly stale rather than genuinely flat, so we flag it.
--
-- Adds two columns (stale, stale_reason); the rest of the signature is unchanged.
-- CREATE OR REPLACE can't change a function's return type, so we DROP + CREATE.

DROP FUNCTION IF EXISTS public.get_sync_health();

CREATE FUNCTION public.get_sync_health()
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
  expected_row_count bigint,
  stale boolean,
  stale_reason text
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
    1::bigint as expected_row_count,
    coalesce(flat.is_stale, false) as stale,
    case when coalesce(flat.is_stale, false)
         then 'Views identical for 3+ days — likely cached/stale API data'
         else null end as stale_reason
  from platform_accounts pa
  left join (
    select platform_account_id, count(*) as cnt
    from platform_daily_metrics
    where date = (current_date - interval '1 day')::date
    group by platform_account_id
  ) pdm on pdm.platform_account_id = pa.id
  left join lateral (
    -- last 3 days up to yesterday: stale if all three views are equal and > 0
    select (count(*) = 3 and count(distinct views) = 1 and min(views) > 0) as is_stale
    from (
      select views
      from platform_daily_metrics
      where platform_account_id = pa.id
        and date between (current_date - interval '3 day')::date
                     and (current_date - interval '1 day')::date
        and views is not null
      order by date desc
      limit 3
    ) recent
  ) flat on true
  where pa.is_active = true
  order by pa.platform, pa.account_name;
$$;