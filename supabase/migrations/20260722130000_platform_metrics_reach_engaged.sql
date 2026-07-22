-- Content Health short-form buildout: richer account-level metrics for the
-- non-YouTube platforms (TikTok / Instagram / Facebook), sourced from Metricool.
--
-- Probed live 2026-07-22 against the connected accounts: of the candidate
-- Metricool account metrics, only Instagram returns usable reach + engaged-
-- accounts data (TikTok/Facebook return 0 for both). Facebook views were
-- separately fixed to source from page_media_view (see sync-metricool).
--
-- Additive + nullable, so existing rows and `select('*')` are unaffected. Values
-- stay NULL for platforms/days where Metricool doesn't surface them.

ALTER TABLE public.platform_daily_metrics
  ADD COLUMN IF NOT EXISTS reach bigint,
  ADD COLUMN IF NOT EXISTS engaged_accounts bigint;

COMMENT ON COLUMN public.platform_daily_metrics.reach IS
  'Unique accounts reached that day (Metricool account/reach). IG-only today.';
COMMENT ON COLUMN public.platform_daily_metrics.engaged_accounts IS
  'Unique accounts that engaged that day (Metricool account/accounts_engaged). IG-only today.';
