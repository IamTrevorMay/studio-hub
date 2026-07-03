-- CRITICAL security fix: stop unauthenticated (anon) access to revenue data.
--
-- daily_platform_rollups is a MATERIALIZED VIEW (cannot enforce RLS) that holds
-- 730 days of per-account revenue_cents, revenue_transactions, followers and
-- views. Migrations 20260629000000 / 20260629000001 granted it to `anon`, so any
-- caller holding the public anon key could read all business financials via
-- PostgREST. get_kpi_summary was likewise EXECUTE-granted to anon.
--
-- Fix: revoke anon. `authenticated` is intentionally retained — the admin-only
-- Analytics pages (PlatformView / CompareView / Analytics.js) read the matview
-- directly as the authenticated role, and get_kpi_summary is SECURITY INVOKER so
-- revenue_events RLS already returns 0 to non-admins. The residual (a non-admin
-- authenticated user reading the rollup matview directly) is tracked separately;
-- this migration closes the unauthenticated hole.

REVOKE ALL ON public.daily_platform_rollups FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_kpi_summary(date, date, uuid[]) FROM anon;
