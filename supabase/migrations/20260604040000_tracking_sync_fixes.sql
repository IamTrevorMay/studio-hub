-- Tracking + sync hygiene.
-- 1. Substack platform_account pointed at the wrong publication ("mayday"
--    = a French vegan newsletter). Repoint to Trevor's "Mayday" via the
--    iamtrevormay slug + the mayday.show custom domain that sync-substack
--    prefers when present.
-- 2. Delete the leftover 2020 row that came from the wrong publication so
--    the Tracking page doesn't surface it.
-- 3. Reclassify YouTube content_items where duration <= 180s as 'short'.
--    YouTube Shorts cap moved to 3 minutes in 2024; the old 60s threshold
--    in sync-youtube under-counted shorts and skewed the Goals filters.
-- 4. Unschedule the stale every-5-minute sync-youtube cron (jobid 32). Its
--    Authorization header relied on a never-populated GUC, so every call
--    failed with 401 and spammed the edge-function logs.

UPDATE public.platform_accounts
SET external_id = 'iamtrevormay',
    config = COALESCE(config, '{}'::jsonb)
             || jsonb_build_object('custom_domain', 'https://www.mayday.show')
WHERE platform = 'substack';

DELETE FROM public.content_items
WHERE platform_account_id = 'c46338e3-d923-43c7-a6ca-8dac8d53abf7'
  AND published_at < '2025-01-01';

UPDATE public.content_items
SET content_type = 'short'
WHERE platform_account_id IN (
  '4e7f34a3-acf8-4cae-9023-0bfa04280c14',  -- More Mayday
  '3b68a43a-4967-4b00-8572-296077721ebb'   -- Trevor May Baseball
)
  AND content_type = 'video'
  AND duration_seconds IS NOT NULL
  AND duration_seconds <= 180;

DO $$
DECLARE
  stale_job_id bigint;
BEGIN
  SELECT jobid INTO stale_job_id FROM cron.job
  WHERE command LIKE '%sync-youtube?mode=content%'
    AND command LIKE '%app.settings.service_role_key%';
  IF stale_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(stale_job_id);
  END IF;
END $$;
