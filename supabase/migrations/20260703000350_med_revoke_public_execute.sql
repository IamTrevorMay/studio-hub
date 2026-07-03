-- Postgres functions are created with GRANT EXECUTE TO PUBLIC by default, and
-- anon is a member of PUBLIC — so revoking EXECUTE from anon alone (as the
-- earlier CRITICAL/MED migrations did) left anon still able to execute via the
-- PUBLIC grant. Revoke from PUBLIC and grant back only the roles that call these
-- (the authenticated analytics/dashboard surfaces; each function self-gates).
revoke execute on function public.get_kpi_summary(date, date, uuid[]) from public, anon;
grant execute on function public.get_kpi_summary(date, date, uuid[]) to authenticated, service_role;

revoke execute on function public.get_sync_health() from public, anon;
grant execute on function public.get_sync_health() to authenticated, service_role;

revoke execute on function public.get_notification_summary(uuid, text, timestamptz) from public, anon;
grant execute on function public.get_notification_summary(uuid, text, timestamptz) to authenticated, service_role;
