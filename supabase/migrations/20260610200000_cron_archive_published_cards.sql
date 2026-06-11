-- Unified Content Kanban — Phase 6
-- Schedule weekly archive of Publish-column cards.
-- Fires Monday 08:00 UTC (= Mon 00:00 PST / Mon 01:00 PDT).
-- Edge fn computes the exact PT-week boundary internally so DST drift
-- only affects when the run starts, not which cards get caught.

select cron.schedule(
  'archive-published-cards',
  '0 8 * * 1',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/archive-published-cards',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$cron$
);
