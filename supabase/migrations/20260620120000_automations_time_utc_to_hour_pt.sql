-- Migrate schedule automations from the legacy `time_utc` field to `hour_pt`.
--
-- Background: the Workflows UI used to store the schedule time as a UTC HH:MM
-- string, converting PT->UTC with a hardcoded -7 offset (PDT only). That made
-- the minute portion meaningless (cron fires at minute 0) and drifted one hour
-- every winter (PST is -8). run-automations now reads `hour_pt` (the user's PT
-- hour intent) and converts to UTC live per the current America/Los_Angeles
-- offset, so DST is handled correctly.
--
-- The original PT hour the user picked is recoverable from the stored UTC hour:
-- the UI computed  utc = pt + 7  =>  pt = (utc - 7 + 24) % 24.
-- Minutes are dropped (schedules are hour-granular).

update public.automations
set trigger_config =
  (trigger_config - 'time_utc')
  || jsonb_build_object(
       'hour_pt',
       ((split_part(trigger_config->>'time_utc', ':', 1)::int - 7) % 24 + 24) % 24
     )
where trigger_type = 'schedule'
  and trigger_config ? 'time_utc';

-- Verification (no-op on success): the seeded Payroll Reminder ('15:00' UTC)
-- should now read hour_pt = 8 (8am PT).
