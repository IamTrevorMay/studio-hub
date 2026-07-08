-- Analytics ingest cleanup (2026-07-08 ingest audit — see PLANNING.md)

-- 1) Drop redundant matview refresh cron. hourly-refresh-rollups already
--    refreshes daily_platform_rollups every hour at :15 via
--    refresh_daily_platform_rollups(); this 6-hourly job did the same refresh.
select cron.unschedule(jobid) from cron.job where jobname = 'refresh-daily-rollups';

-- 2) Deactivate the Twitter platform account. Metricool dropped Twitter
--    (X API restrictions), the account has zero metric/snapshot rows ever,
--    and the nightly integrity checker was enqueuing unfixable backfills
--    for it. daily_platform_rollups and the Analytics account selector
--    both filter on is_active.
update platform_accounts set is_active = false where platform = 'twitter';
