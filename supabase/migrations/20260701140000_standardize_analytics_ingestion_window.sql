-- Standardize the Analytics-page ingestion crons into a single 15-minute
-- nightly window: 01:00–01:15 UTC = 6:00–6:15 PM PT (PDT). Previously each
-- platform sync ran at a different hour (01:00–06:30 UTC), so "data freshness"
-- was uneven across platforms and hard to monitor.
--
-- Jobs are spread 2 minutes apart within the window to keep freshness uniform
-- without a concurrency spike. sync-youtube stays on its 6-hour cadence but is
-- shifted to 01/07/13/19 UTC so its evening pull lands inside the window.
--
-- Untouched: check-data-integrity (10 AM PT), the rollup refreshers
-- (hourly at :15 already runs just after this window), and sync-tiller
-- (finance/Accounting, not an Analytics feeder).
--
-- Note: cron runs on fixed UTC, so during PST (winter) the window lands at
-- 5:00–5:15 PM PT — same DST drift as the rest of the app's schedules.
do $$
declare
  r record;
  jid bigint;
begin
  for r in select * from (values
    ('sync-youtube',            '0 1,7,13,19 * * *'),  -- 6h cadence, evening pull at 6:00 PM PT
    ('sync-youtube-dimensions', '1 1 * * *'),          -- 6:01 PM PT
    ('sync-metricool',          '3 1 * * *'),          -- 6:03 PM PT
    ('sync-stripe',             '5 1 * * *'),          -- 6:05 PM PT
    ('sync-fourthwall',         '7 1 * * *'),          -- 6:07 PM PT
    ('sync-twitch',             '9 1 * * *'),          -- 6:09 PM PT
    ('sync-substack',           '11 1 * * *'),         -- 6:11 PM PT
    ('sync-simplecast',         '13 1 * * *')          -- 6:13 PM PT
  ) as x(jobname, sched)
  loop
    select jobid into jid from cron.job where jobname = r.jobname;
    if jid is not null then
      perform cron.alter_job(jid, schedule => r.sched);
    end if;
  end loop;
end $$;
