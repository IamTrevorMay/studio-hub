-- Recurring campaign support for the Mailer, used to port the daily "Mayday
-- Daily" digest off the Triton Tools sender into this project's mailer_* system.
--
-- Model: a campaign flagged is_template = true is a reusable blueprint that is
-- never sent directly. A daily cron (mailer-arm-daily) clones each active
-- template into a fresh dated campaign (status = 'scheduled'), which the existing
-- mailer-cron-tick then sends via mailer-send-now — giving every day its own
-- campaign row with its own mailer_sends + stats (opens/clicks/bounces).
ALTER TABLE mailer_campaigns
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE,
  -- Recurrence config on a template, e.g. {"skipMonths":[12,1]}. The daily
  -- cadence itself is driven by the pg_cron that pings mailer-arm-daily.
  ADD COLUMN IF NOT EXISTS recurrence JSONB,
  -- On a cloned send: the template it came from (for grouping stats across days).
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES mailer_campaigns(id) ON DELETE SET NULL,
  -- On a cloned send: the ET digest date it covers (yesterday, matching the
  -- bindings), used for once-per-day idempotency.
  ADD COLUMN IF NOT EXISTS digest_date DATE;

-- One armed clone per template per digest date — the arm cron relies on this
-- to stay idempotent if it runs (or is retried) more than once in a day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mailer_campaigns_template_digest
  ON mailer_campaigns(template_id, digest_date)
  WHERE template_id IS NOT NULL AND digest_date IS NOT NULL;
