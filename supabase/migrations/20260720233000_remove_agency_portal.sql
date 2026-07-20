-- Remove the Agency Portal entirely: the 'agency' role, the 1026 Ventures
-- account, agency comment threads + proposal plumbing, the trimmed views, and
-- every RLS `is_agency()` exclusion. Reverts the additions from
-- 20260709190000_agency_portal.sql (plus the later `canvases` policies that
-- also adopted is_agency()).
--
-- SEQUENCING: this migration drops `agency_comments`, which the OLD frontend
-- subscribes to via realtime. It MUST run AFTER the agency-free frontend is
-- deployed. Order within the file: strip policy references first, recreate the
-- notification summary without the agency block, then drop the views/table/
-- functions, then delete the account, then tighten the role constraint.

-- 1. Revert the ~30 staff-wide policies to their pre-agency form (drop the
--    `NOT is_agency(auth.uid())` term). Must precede DROP FUNCTION is_agency.

-- sponsor_deliverables
ALTER POLICY "Authenticated users can view deliverables" ON public.sponsor_deliverables USING (true);
ALTER POLICY "Authenticated users can insert deliverables" ON public.sponsor_deliverables WITH CHECK (true);
ALTER POLICY "Authenticated users can update deliverables" ON public.sponsor_deliverables USING (true);
ALTER POLICY "Authenticated users can delete deliverables" ON public.sponsor_deliverables USING (true);

-- sponsors
ALTER POLICY "Authenticated users can view sponsors" ON public.sponsors USING (true);
ALTER POLICY "Authenticated users can insert sponsors" ON public.sponsors WITH CHECK (true);
ALTER POLICY "Authenticated users can update sponsors" ON public.sponsors USING (true);
ALTER POLICY "Authenticated users can delete sponsors" ON public.sponsors USING (true);

-- sponsor_campaigns
ALTER POLICY "Allow all for authenticated" ON public.sponsor_campaigns USING (true) WITH CHECK (true);

-- campaign_briefs
ALTER POLICY "Authenticated users can read campaign_briefs" ON public.campaign_briefs USING (true);
ALTER POLICY "Authenticated users can insert campaign_briefs" ON public.campaign_briefs WITH CHECK (true);
ALTER POLICY "Authenticated users can update campaign_briefs" ON public.campaign_briefs USING (true);
ALTER POLICY "Authenticated users can delete campaign_briefs" ON public.campaign_briefs USING (true);
ALTER POLICY "Public read onepager briefs" ON public.campaign_briefs USING (onepager_md IS NOT NULL);

-- revenue_events / read_slot_limits / beat_sheets / calendar_events
ALTER POLICY "Authenticated users can view revenue" ON public.revenue_events USING (true);
ALTER POLICY "Authenticated users can view slot limits" ON public.read_slot_limits USING (true);
ALTER POLICY "All users can manage all beat sheets" ON public.beat_sheets
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
ALTER POLICY "calendar_events_select" ON public.calendar_events USING (true);

-- canvases (added is_agency in a later migration than the original agency one)
ALTER POLICY "canvases: select staff" ON public.canvases USING (auth.role() = 'authenticated');
ALTER POLICY "canvases: insert staff" ON public.canvases WITH CHECK (auth.role() = 'authenticated');
ALTER POLICY "canvases: update staff" ON public.canvases
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
ALTER POLICY "canvases: delete staff" ON public.canvases USING (auth.role() = 'authenticated');

-- ad_read_proposals: revert to pre-agency (all authenticated view; own-row insert)
ALTER POLICY "Authenticated users can view proposals" ON public.ad_read_proposals USING (true);
ALTER POLICY "Users create their own proposals" ON public.ad_read_proposals WITH CHECK (auth.uid() = created_by);

-- ad_read_proposal_items: revert to pre-agency (any authenticated full access)
ALTER POLICY "Authenticated users can view proposal items" ON public.ad_read_proposal_items USING (true);
ALTER POLICY "Authenticated users can create proposal items" ON public.ad_read_proposal_items WITH CHECK (true);
ALTER POLICY "Authenticated users can update proposal items" ON public.ad_read_proposal_items USING (true) WITH CHECK (true);
ALTER POLICY "Authenticated users can delete proposal items" ON public.ad_read_proposal_items USING (true);

-- 2. Recreate get_notification_summary WITHOUT the agency-unresolved block.
--    (Preserves the later `count_in_badge` task filter.) The
--    agency_unresolved_count key is KEPT and hard-returned as 0 this release so
--    a not-yet-updated client can't crash; drop the key in a later cleanup.
CREATE OR REPLACE FUNCTION public.get_notification_summary(p_user_id uuid, p_role text, p_dashboard_last_seen timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  result jsonb;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_announcement_count int := 0; v_notification_count int := 0; v_proposal_count int := 0;
  v_unsigned_doc_count int := 0; v_stuck_comment_count int := 0; v_fl_comment_count int := 0;
  v_task_count int := 0; v_assignment_count int := 0;
begin
  p_user_id := auth.uid();
  if p_user_id is null then
    return jsonb_build_object('unread_announcement_count',0,'unread_notification_count',0,'pending_proposal_count',0,'unsigned_doc_count',0,'stuck_comment_count',0,'fl_comment_count',0,'my_task_count',0,'new_assignment_count',0,'agency_unresolved_count',0);
  end if;
  select role into p_role from public.profiles where id = p_user_id;
  select count(*) into v_announcement_count from announcements a
    where a.target_date = v_today and not exists (select 1 from announcement_reads ar where ar.announcement_id = a.id and ar.user_id = p_user_id);
  select count(*) into v_notification_count from notifications where user_id = p_user_id and is_read = false;
  select count(*) into v_proposal_count from ad_read_proposals where status = 'pending';
  if p_role = 'freelancer' then
    select count(*) into v_unsigned_doc_count from freelancer_documents where freelancer_id = p_user_id and doc_type = 'signing' and signed_at is null;
  end if;
  if p_role = 'admin' then
    select count(*) into v_stuck_comment_count from notifications where user_id = p_user_id and type = 'fl_stuck' and is_read = false;
    select count(*) into v_fl_comment_count from notifications where user_id = p_user_id and type = 'fl_comment' and is_read = false;
  end if;
  select count(*) into v_task_count from tasks
    where assignee_id = p_user_id
      and status in ('pending','active','on_hold')
      and (snoozed_until is null or snoozed_until < now())
      and coalesce(count_in_badge, true) = true;
  if p_role = 'freelancer' then
    select count(*) into v_assignment_count from freelancer_assignments where freelancer_id = p_user_id and status = 'assigned';
  end if;
  result := jsonb_build_object('unread_announcement_count',v_announcement_count,'unread_notification_count',v_notification_count,'pending_proposal_count',v_proposal_count,'unsigned_doc_count',v_unsigned_doc_count,'stuck_comment_count',v_stuck_comment_count,'fl_comment_count',v_fl_comment_count,'my_task_count',v_task_count,'new_assignment_count',v_assignment_count,'agency_unresolved_count',0);
  return result;
end; $function$;

-- 3. Drop the trimmed agency views (they reference is_agency()).
DROP VIEW IF EXISTS public.agency_deliverables;
DROP VIEW IF EXISTS public.agency_briefs;

-- 4. Drop the comment thread table (+ its policies, index, realtime membership)
--    and its author trigger function.
DROP TABLE IF EXISTS public.agency_comments CASCADE;
DROP FUNCTION IF EXISTS public.set_agency_comment_author();

-- 5. Drop the role helper now that nothing references it.
DROP FUNCTION IF EXISTS public.is_agency(uuid);

-- 6. Delete the agency account's data + the account itself.
--    (1026 Ventures posted 0 comments / 0 proposals — these are defensive.)
DELETE FROM public.ad_read_proposals WHERE created_by = '36c698a3-31ca-43b2-8a1b-9fd1d639afa7';
-- profiles.id -> auth.users(id) is ON DELETE CASCADE, and notifications.user_id
-- -> profiles(id) is ON DELETE CASCADE, so deleting the auth user removes the
-- profile row and its lone notification cleanly.
DELETE FROM auth.users WHERE id = '36c698a3-31ca-43b2-8a1b-9fd1d639afa7';

-- 7. Remove 'agency' from the allowed roles (no such row remains after step 6).
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'assistant'::text, 'member'::text, 'partner'::text, 'freelancer'::text, 'director_creative'::text, 'director_comms'::text, 'producer'::text]));
