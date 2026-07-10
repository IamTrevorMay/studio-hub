-- Agency portal: read-only deliverables view for the ad agency partner.
--
-- Adds an 'agency' profile role (distinct from 'partner', which is the
-- Business Dev roadmap portal). Agency users get:
--   * trimmed read access to deliverables via the agency_deliverables view
--     (no pay, notes, or ad copy)
--   * brief access via the agency_briefs view (no source_text)
--   * comment threads on deliverables and proposals (agency_comments)
--   * ability to submit ad-read proposals (own rows only)
-- and are excluded from the staff-wide policies on sponsor/revenue tables.

-- 1. Allow 'agency' in profiles.role
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'assistant'::text, 'member'::text, 'partner'::text, 'freelancer'::text, 'director_creative'::text, 'director_comms'::text, 'producer'::text, 'agency'::text]));

-- 2. Role helper
CREATE OR REPLACE FUNCTION public.is_agency(uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  select exists (
    select 1 from public.profiles where id = uid and role = 'agency'
  );
$$;

-- 3. Exclude agency accounts from staff-wide policies.
-- These tables previously allowed any authenticated user full access.
ALTER POLICY "Authenticated users can view deliverables" ON public.sponsor_deliverables
  USING (NOT public.is_agency(auth.uid()));
ALTER POLICY "Authenticated users can insert deliverables" ON public.sponsor_deliverables
  WITH CHECK (NOT public.is_agency(auth.uid()));
ALTER POLICY "Authenticated users can update deliverables" ON public.sponsor_deliverables
  USING (NOT public.is_agency(auth.uid()));
ALTER POLICY "Authenticated users can delete deliverables" ON public.sponsor_deliverables
  USING (NOT public.is_agency(auth.uid()));

ALTER POLICY "Authenticated users can view sponsors" ON public.sponsors
  USING (NOT public.is_agency(auth.uid()));
ALTER POLICY "Authenticated users can insert sponsors" ON public.sponsors
  WITH CHECK (NOT public.is_agency(auth.uid()));
ALTER POLICY "Authenticated users can update sponsors" ON public.sponsors
  USING (NOT public.is_agency(auth.uid()));
ALTER POLICY "Authenticated users can delete sponsors" ON public.sponsors
  USING (NOT public.is_agency(auth.uid()));

ALTER POLICY "Allow all for authenticated" ON public.sponsor_campaigns
  USING (NOT public.is_agency(auth.uid()))
  WITH CHECK (NOT public.is_agency(auth.uid()));

ALTER POLICY "Authenticated users can read campaign_briefs" ON public.campaign_briefs
  USING (NOT public.is_agency(auth.uid()));
ALTER POLICY "Authenticated users can insert campaign_briefs" ON public.campaign_briefs
  WITH CHECK (NOT public.is_agency(auth.uid()));
ALTER POLICY "Authenticated users can update campaign_briefs" ON public.campaign_briefs
  USING (NOT public.is_agency(auth.uid()));
ALTER POLICY "Authenticated users can delete campaign_briefs" ON public.campaign_briefs
  USING (NOT public.is_agency(auth.uid()));
-- Public one-pager reads stay open for anonymous share pages, but agency
-- accounts go through the trimmed agency_briefs view instead.
ALTER POLICY "Public read onepager briefs" ON public.campaign_briefs
  USING (onepager_md IS NOT NULL AND NOT public.is_agency(auth.uid()));

ALTER POLICY "Authenticated users can view revenue" ON public.revenue_events
  USING (NOT public.is_agency(auth.uid()));
ALTER POLICY "Authenticated users can view slot limits" ON public.read_slot_limits
  USING (NOT public.is_agency(auth.uid()));
ALTER POLICY "All users can manage all beat sheets" ON public.beat_sheets
  USING (auth.uid() IS NOT NULL AND NOT public.is_agency(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND NOT public.is_agency(auth.uid()));
ALTER POLICY "calendar_events_select" ON public.calendar_events
  USING (NOT public.is_agency(auth.uid()));

-- Proposals: agency sees and manages only its own rows, and can only
-- create them as 'pending'.
ALTER POLICY "Authenticated users can view proposals" ON public.ad_read_proposals
  USING (NOT public.is_agency(auth.uid()) OR created_by = auth.uid());
ALTER POLICY "Users create their own proposals" ON public.ad_read_proposals
  WITH CHECK (auth.uid() = created_by AND (NOT public.is_agency(auth.uid()) OR status = 'pending'));

ALTER POLICY "Authenticated users can view proposal items" ON public.ad_read_proposal_items
  USING (
    NOT public.is_agency(auth.uid())
    OR EXISTS (SELECT 1 FROM public.ad_read_proposals pr WHERE pr.id = proposal_id AND pr.created_by = auth.uid())
  );
ALTER POLICY "Authenticated users can create proposal items" ON public.ad_read_proposal_items
  WITH CHECK (
    NOT public.is_agency(auth.uid())
    OR EXISTS (SELECT 1 FROM public.ad_read_proposals pr WHERE pr.id = proposal_id AND pr.created_by = auth.uid() AND pr.status = 'pending')
  );
ALTER POLICY "Authenticated users can update proposal items" ON public.ad_read_proposal_items
  USING (
    NOT public.is_agency(auth.uid())
    OR EXISTS (SELECT 1 FROM public.ad_read_proposals pr WHERE pr.id = proposal_id AND pr.created_by = auth.uid() AND pr.status = 'pending')
  )
  WITH CHECK (
    NOT public.is_agency(auth.uid())
    OR EXISTS (SELECT 1 FROM public.ad_read_proposals pr WHERE pr.id = proposal_id AND pr.created_by = auth.uid() AND pr.status = 'pending')
  );
ALTER POLICY "Authenticated users can delete proposal items" ON public.ad_read_proposal_items
  USING (
    NOT public.is_agency(auth.uid())
    OR EXISTS (SELECT 1 FROM public.ad_read_proposals pr WHERE pr.id = proposal_id AND pr.created_by = auth.uid() AND pr.status = 'pending')
  );

-- 4. Trimmed read views (security definer: bypass table RLS, gate inside).
CREATE OR REPLACE VIEW public.agency_deliverables
WITH (security_barrier) AS
SELECT d.id, d.title, d.deliverable_type, d.channel, d.platforms,
       d.status, d.review_status, d.film_status,
       d.due_date, d.slot_date, d.delivered, d.completed_at,
       d.created_at, d.updated_at, d.campaign_id, d.sponsor_id,
       c.name AS brand_name, s.name AS sponsor_name
FROM public.sponsor_deliverables d
LEFT JOIN public.sponsor_campaigns c ON c.id = d.campaign_id
LEFT JOIN public.sponsors s ON s.id = d.sponsor_id
WHERE public.is_agency(auth.uid()) OR public.is_admin(auth.uid());

REVOKE ALL ON public.agency_deliverables FROM anon, public;
GRANT SELECT ON public.agency_deliverables TO authenticated;

CREATE OR REPLACE VIEW public.agency_briefs
WITH (security_barrier) AS
SELECT b.id, b.campaign_id, b.type, b.label, b.url, b.position, b.onepager_md
FROM public.campaign_briefs b
WHERE public.is_agency(auth.uid()) OR public.is_admin(auth.uid());

REVOKE ALL ON public.agency_briefs FROM anon, public;
GRANT SELECT ON public.agency_briefs TO authenticated;

-- Advisor hygiene: is_agency stays executable by authenticated (RLS
-- policies evaluate it as the querying role); anon never needs it. The
-- trigger function is only ever fired by its trigger.
REVOKE EXECUTE ON FUNCTION public.is_agency(uuid) FROM anon, public;

-- 5. Comment threads on deliverables and proposals.
CREATE TABLE public.agency_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('deliverable', 'proposal')),
  entity_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Snapshot of the author's role at post time, set by trigger (never
  -- trusted from the client). 'agency' authored threads count as
  -- unresolved until an admin-level user replies.
  author_role text NOT NULL DEFAULT 'member',
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agency_comments_entity_idx
  ON public.agency_comments (entity_type, entity_id, created_at);

ALTER TABLE public.agency_comments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_agency_comment_author()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.author_id := auth.uid();
  END IF;
  SELECT role INTO NEW.author_role FROM public.profiles WHERE id = NEW.author_id;
  NEW.author_role := COALESCE(NEW.author_role, 'member');
  RETURN NEW;
END;
$$;

CREATE TRIGGER agency_comments_set_author
  BEFORE INSERT ON public.agency_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_agency_comment_author();

REVOKE EXECUTE ON FUNCTION public.set_agency_comment_author() FROM anon, authenticated, public;

-- Staff read everything; agency reads deliverable threads plus threads on
-- its own proposals.
CREATE POLICY "Read agency comments" ON public.agency_comments
  FOR SELECT TO authenticated
  USING (
    NOT public.is_agency(auth.uid())
    OR entity_type = 'deliverable'
    OR EXISTS (SELECT 1 FROM public.ad_read_proposals pr WHERE pr.id = entity_id AND pr.created_by = auth.uid())
  );

CREATE POLICY "Post agency comments" ON public.agency_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND (
      NOT public.is_agency(auth.uid())
      OR entity_type = 'deliverable'
      OR EXISTS (SELECT 1 FROM public.ad_read_proposals pr WHERE pr.id = entity_id AND pr.created_by = auth.uid())
    )
  );

CREATE POLICY "Delete own agency comments" ON public.agency_comments
  FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.is_admin(auth.uid()));

-- Realtime events for comment threads.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'agency_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agency_comments;
  END IF;
END;
$$;

-- 6. Badge count: unresolved agency activity for admin-level users.
-- A thread is unresolved when its latest comment was written by the
-- agency; a pending agency proposal with no comments yet is also
-- unresolved. Any admin/director reply (or the thread going quiet after
-- one) clears it for everyone.
CREATE OR REPLACE FUNCTION public.get_notification_summary(p_user_id uuid, p_role text, p_dashboard_last_seen timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  result jsonb;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_announcement_count int := 0; v_notification_count int := 0; v_proposal_count int := 0;
  v_unsigned_doc_count int := 0; v_stuck_comment_count int := 0; v_fl_comment_count int := 0;
  v_task_count int := 0; v_assignment_count int := 0; v_agency_unresolved int := 0;
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
  if p_role in ('admin', 'director_creative', 'director_comms') then
    -- Threads whose latest comment is from the agency (entity must still exist)
    select count(*) into v_agency_unresolved from (
      select distinct on (c.entity_type, c.entity_id) c.entity_type, c.entity_id, c.author_role
      from agency_comments c
      order by c.entity_type, c.entity_id, c.created_at desc
    ) t
    where t.author_role = 'agency'
      and (
        (t.entity_type = 'deliverable' and exists (select 1 from sponsor_deliverables d where d.id = t.entity_id))
        or (t.entity_type = 'proposal' and exists (select 1 from ad_read_proposals pr where pr.id = t.entity_id))
      );
    -- Pending agency proposals nobody has replied to yet
    select v_agency_unresolved + count(*) into v_agency_unresolved
    from ad_read_proposals pr
    where pr.status = 'pending'
      and exists (select 1 from profiles p where p.id = pr.created_by and p.role = 'agency')
      and not exists (select 1 from agency_comments c where c.entity_type = 'proposal' and c.entity_id = pr.id);
  end if;
  select count(*) into v_task_count from tasks where assignee_id = p_user_id and status in ('pending','active','on_hold') and (snoozed_until is null or snoozed_until < now());
  if p_role = 'freelancer' then
    select count(*) into v_assignment_count from freelancer_assignments where freelancer_id = p_user_id and status = 'assigned';
  end if;
  result := jsonb_build_object('unread_announcement_count',v_announcement_count,'unread_notification_count',v_notification_count,'pending_proposal_count',v_proposal_count,'unsigned_doc_count',v_unsigned_doc_count,'stuck_comment_count',v_stuck_comment_count,'fl_comment_count',v_fl_comment_count,'my_task_count',v_task_count,'new_assignment_count',v_assignment_count,'agency_unresolved_count',v_agency_unresolved);
  return result;
end; $function$;
