-- Hourly safety-net refresh of the daily_platform_rollups materialized view.
-- Sync functions refresh after each run; this catches any that missed.
select cron.schedule(
  'hourly-refresh-rollups',
  '15 * * * *',
  $$select refresh_daily_platform_rollups()$$
);
