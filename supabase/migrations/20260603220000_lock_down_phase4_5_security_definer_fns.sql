-- Lock down SECURITY DEFINER functions added in Phase 4 (Mailer) +
-- Phase 5 (Broadcast) + Phase 3 (Report Cards). Advisor flagged these
-- as exposed to anon/authenticated.
--
-- touch_updated_at triggers: only triggers call them; revoke from
--   anon, authenticated, public.
-- broadcast access helpers: called by RLS USING clauses with the
--   authenticated user as caller; keep grant for authenticated but
--   revoke anon + public so they're not exposed via PostgREST /rpc to
--   unauthenticated requests.

revoke execute on function public.email_touch_updated_at() from anon, authenticated, public;
revoke execute on function public.broadcast_touch_updated_at() from anon, authenticated, public;
revoke execute on function public.report_card_templates_touch_updated_at() from anon, authenticated, public;

revoke execute on function public.broadcast_project_access_level(uuid, uuid) from anon, public;
revoke execute on function public.broadcast_can_edit(uuid, uuid) from anon, public;
revoke execute on function public.broadcast_can_read(uuid, uuid) from anon, public;
-- authenticated keeps EXECUTE on the access helpers so RLS policies still resolve.
grant execute on function public.broadcast_project_access_level(uuid, uuid) to authenticated;
grant execute on function public.broadcast_can_edit(uuid, uuid) to authenticated;
grant execute on function public.broadcast_can_read(uuid, uuid) to authenticated;
