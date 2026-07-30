-- Lock down the Client Portal SECURITY DEFINER functions properly.
-- The earlier `revoke ... from anon` calls were no-ops: functions get an
-- implicit GRANT EXECUTE TO PUBLIC, and anon's access flows through PUBLIC.
-- Revoke from PUBLIC + anon, then grant back to authenticated (RLS policies
-- and portal RPCs run as authenticated) and service_role. Trigger functions
-- need no caller EXECUTE at all — revoke without re-granting.

-- Callable helpers / RPCs
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.is_client(uuid)',
    'public.is_client()',
    'public.is_staff(uuid)',
    'public.is_client_editor(uuid, uuid)',
    'public.editor_client_drive_folder(uuid)',
    'public.client_editor_options()',
    'public.client_can_message(uuid, uuid)',
    'public.client_message_recipients()',
    'public.client_calendar_events()',
    'public.submit_review_verdict(uuid, text)',
    'public.claim_client_contract()',
    'public.review_client_id(uuid)',
    'public.review_contractor_id(uuid)',
    'public.can_view_review(uuid, uuid)',
    'public.review_id_for_comment(uuid)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

-- Trigger functions (never invoked via RPC)
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.client_editors_validate()',
    'public.client_profile_lock_admin_fields()',
    'public.client_assignment_sanitize()',
    'public.client_assignment_lock_fields()',
    'public.client_assignment_status_notify()',
    'public.client_assignment_new_notify()',
    'public.client_assignment_comment_notify()',
    'public.review_lock_assignment_link()',
    'public.review_version_verdict_guard()',
    'public.review_version_notify_client()',
    'public.client_doc_lock_fields()'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
