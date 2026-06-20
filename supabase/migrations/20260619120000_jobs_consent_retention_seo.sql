-- Jobs board hardening: consent capture, retention metadata, listing expiry.
--   job_applications.consent_at / consent_version — applicant consent to data storage
--   job_listings.expires_at — drives JobPosting validThrough + sitemap freshness
-- Plus a daily retention cron that purges old application PII via the
-- jobs-retention edge function (resumes live in storage, so the delete must
-- run service-role inside an edge fn, not pure SQL).

alter table public.job_applications
  add column if not exists consent_at      timestamptz,
  add column if not exists consent_version text;

alter table public.job_listings
  add column if not exists expires_at timestamptz;

-- ─── Retention cron ───────────────────────────────────────────────────────
-- Reads CRON_SECRET from Vault (same pattern as generate-trends et al.) and
-- calls the jobs-retention edge fn daily at 04:30 UTC (after the rate-limit
-- prune at 04:00).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-jobs-retention') then
    perform cron.unschedule('daily-jobs-retention');
  end if;
end $$;

select cron.schedule(
  'daily-jobs-retention',
  '30 4 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/jobs-retention?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$cron$
);
