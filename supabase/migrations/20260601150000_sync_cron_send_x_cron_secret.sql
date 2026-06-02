-- Reschedule all sync-* cron jobs to send `x-cron-secret` header from vault.
-- After the matching edge fn deploy, each fn validates this header against
-- the CRON_SECRET env var and rejects unauthenticated callers.
--
-- PREREQUISITE: vault secret named `cron_secret` exists
-- (see 20260601140000_cron_secret_via_vault.sql).

select cron.unschedule('sync-tiller');
select cron.schedule(
  'sync-tiller', '0 7 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-tiller',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$cron$
);

select cron.unschedule('sync-metricool');
select cron.schedule(
  'sync-metricool', '0 5 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-metricool',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$cron$
);

select cron.unschedule('sync-youtube');
select cron.schedule(
  'sync-youtube', '0 */6 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-youtube',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$cron$
);

select cron.unschedule('sync-fourthwall');
select cron.schedule(
  'sync-fourthwall', '0 6 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-fourthwall',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$cron$
);

select cron.unschedule('sync-twitch');
select cron.schedule(
  'sync-twitch', '0 6 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-twitch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$cron$
);

select cron.unschedule('sync-stripe');
select cron.schedule(
  'sync-stripe', '0 3 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-stripe',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$cron$
);

select cron.unschedule('sync-substack');
select cron.schedule(
  'sync-substack', '0 4 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-substack',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$cron$
);
