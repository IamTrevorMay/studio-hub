-- Final hardening from the security advisor sweep: several SECURITY DEFINER
-- functions are directly callable by anon via /rest/v1/rpc. The channel RLS
-- helpers are only ever invoked by policies scoped `to authenticated`, so anon
-- never needs EXECUTE (and authenticated keeps it, so RLS still evaluates).
-- create_group_conversation is a mutation that already raises without auth.uid(),
-- and refresh_daily_platform_rollups is an expensive matview refresh anon should
-- not be able to trigger.
-- Revoke from PUBLIC (anon inherits via PUBLIC, so anon-only revoke is a no-op),
-- then grant back only the roles that need it. The channel RLS helpers must stay
-- executable by authenticated (RLS policies scoped `to authenticated` call them);
-- refresh also runs from sync edge functions as service_role.
revoke execute on function public.can_view_channel(uuid) from public, anon;
grant execute on function public.can_view_channel(uuid) to authenticated, service_role;

revoke execute on function public.is_channel_admin() from public, anon;
grant execute on function public.is_channel_admin() to authenticated, service_role;

revoke execute on function public.create_group_conversation(uuid[], text) from public, anon;
grant execute on function public.create_group_conversation(uuid[], text) to authenticated, service_role;

revoke execute on function public.refresh_daily_platform_rollups() from public, anon;
grant execute on function public.refresh_daily_platform_rollups() to authenticated, service_role;
