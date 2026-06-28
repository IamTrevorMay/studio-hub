-- Schedule sync-simplecast daily at 06:30 UTC (offset from the 06:00 cluster).
-- Sends the `x-cron-secret` header from vault; the edge fn validates it against
-- the CRON_SECRET env var. Mirrors the other sync-* cron jobs
-- (see 20260601150000_sync_cron_send_x_cron_secret.sql).
--
-- PREREQUISITE: vault secret named `cron_secret` exists, edge fn deployed:
--   supabase functions deploy sync-simplecast --no-verify-jwt
-- and an active platform_accounts row (platform='simplecast') with
-- credentials.api_token + external_id (podcast id) configured.

-- Idempotent: drop any prior schedule before recreating.
do $$
begin
  perform cron.unschedule('sync-simplecast');
exception when others then null;
end $$;

select cron.schedule(
  'sync-simplecast', '30 6 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-simplecast',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$cron$
);
