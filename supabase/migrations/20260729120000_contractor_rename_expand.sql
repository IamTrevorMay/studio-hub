-- ============================================================================
-- EXPAND: Freelancer -> Contractor rename (zero-downtime, non-breaking)
-- ============================================================================
-- Renames the six freelancer_* tables to contractor_* and the freelancer_id
-- column to contractor_id, then recreates all dependent functions/policies to
-- reference the new physical names. Backward-compatibility for the CURRENTLY
-- DEPLOYED prod frontend + old edge functions is provided by auto-updatable
-- compat VIEWS (security_invoker) that keep the old table names and expose the
-- old `freelancer_id` column (aliased from contractor_id).
--
-- NON-GOALS (intentionally left stable, like the fl_* route keys):
--   * role VALUE is NOT flipped here (old deployed frontend hard-checks
--     role === 'freelancer' in JS). Both values are ACCEPTED everywhere.
--     The data migration to 'contractor' happens in the CONTRACT migration,
--     after the new frontend (which accepts both) is live.
--   * FK constraint names, index names, RPC function names
--     (compute_freelancer_pay, is_freelancer, fl_*), the 'freelancer-documents'
--     storage bucket, and notification `type` strings are kept unchanged.
--     The FK constraint names in particular are load-bearing: the old frontend
--     embeds relationships via PostgREST constraint-name hints
--     (e.g. profiles!freelancer_assignments_freelancer_id_fkey), which must keep
--     resolving through the compat views.
-- ============================================================================
-- (Applied via Supabase apply_migration, which runs the file in a single
--  transaction — no explicit BEGIN/COMMIT needed.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rename base tables (FKs, triggers, policies, indexes follow automatically)
-- ---------------------------------------------------------------------------
ALTER TABLE public.freelancer_profiles            RENAME TO contractor_profiles;
ALTER TABLE public.freelancer_assignments         RENAME TO contractor_assignments;
ALTER TABLE public.freelancer_assignment_comments RENAME TO contractor_assignment_comments;
ALTER TABLE public.freelancer_documents           RENAME TO contractor_documents;
ALTER TABLE public.freelancer_hours               RENAME TO contractor_hours;
ALTER TABLE public.freelancer_overtime_approvals  RENAME TO contractor_overtime_approvals;

-- ---------------------------------------------------------------------------
-- 2. Rename freelancer_id -> contractor_id (policy/trigger refs auto-follow)
-- ---------------------------------------------------------------------------
ALTER TABLE public.contractor_assignments        RENAME COLUMN freelancer_id TO contractor_id;
ALTER TABLE public.contractor_documents          RENAME COLUMN freelancer_id TO contractor_id;
ALTER TABLE public.contractor_hours              RENAME COLUMN freelancer_id TO contractor_id;
ALTER TABLE public.contractor_overtime_approvals RENAME COLUMN freelancer_id TO contractor_id;

-- ---------------------------------------------------------------------------
-- 3. Role CHECK constraint: accept BOTH 'freelancer' and 'contractor'
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (
  role = ANY (ARRAY['admin','assistant','member','partner','freelancer','contractor',
                    'director_creative','director_comms','producer'])
);

-- ---------------------------------------------------------------------------
-- 4. Role helper: accept BOTH values (single chokepoint for most RLS policies)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_freelancer(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from profiles where id = uid and role in ('freelancer','contractor'));
$function$;

-- ---------------------------------------------------------------------------
-- 5. Recreate all functions that referenced the old names/column
-- ---------------------------------------------------------------------------

-- get_notification_summary: contractor_* tables + accept both roles
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
  if p_role in ('freelancer','contractor') then
    select count(*) into v_unsigned_doc_count from contractor_documents where contractor_id = p_user_id and doc_type = 'signing' and signed_at is null;
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
  if p_role in ('freelancer','contractor') then
    select count(*) into v_assignment_count from contractor_assignments where contractor_id = p_user_id and status = 'assigned';
  end if;
  result := jsonb_build_object('unread_announcement_count',v_announcement_count,'unread_notification_count',v_notification_count,'pending_proposal_count',v_proposal_count,'unsigned_doc_count',v_unsigned_doc_count,'stuck_comment_count',v_stuck_comment_count,'fl_comment_count',v_fl_comment_count,'my_task_count',v_task_count,'new_assignment_count',v_assignment_count,'agency_unresolved_count',0);
  return result;
end; $function$;

-- compute_freelancer_pay: contractor_* tables + contractor_id (name/param/output keys kept)
CREATE OR REPLACE FUNCTION public.compute_freelancer_pay(p_freelancer uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  fp record;
  w1s date; w1e date; w2s date; w2e date;
  windows jsonb := '[]'::jsonb;
  wstart date; wend date;
  a numeric; r numeric; m numeric; x numeric; rate numeric;
  base_hours numeric; ot_hours numeric; pay numeric;
  floor_applied boolean; approved boolean;
  total_hours numeric := 0; total_pay numeric := 0;
  i int;
begin
  if not (public.is_admin(auth.uid()) or auth.uid() = p_freelancer) then
    raise exception 'not authorized';
  end if;

  select fpr.payment_type,
         coalesce(fpr.rate,0)               as rate,
         coalesce(fpr.retainer_enabled,false) as retainer_enabled,
         fpr.retainer_min_hours,
         coalesce(fpr.overtime_enabled,false) as overtime_enabled,
         fpr.overtime_max_hours,
         coalesce(fpr.overtime_multiplier,1.5) as overtime_multiplier
    into fp
    from public.contractor_profiles fpr
   where fpr.id = p_freelancer;

  rate := coalesce(fp.rate, 0);
  x    := coalesce(fp.overtime_multiplier, 1.5);

  select ws, we into w1s, w1e from public.fl_retainer_window(p_start);
  select ws, we into w2s, w2e from public.fl_retainer_window(w1e + 1);

  for i in 1..2 loop
    if i = 1 then wstart := w1s; wend := w1e; else wstart := w2s; wend := w2e; end if;

    select coalesce(sum(hours_spent), 0) into a
      from public.contractor_assignments
     where contractor_id = p_freelancer
       and hours_spent is not null
       and completed_at is not null
       and (completed_at at time zone 'America/Los_Angeles')::date between wstart and wend;

    r := case when fp.retainer_enabled then coalesce(fp.retainer_min_hours, 0) else 0 end;
    m := fp.overtime_max_hours;

    select exists (
      select 1 from public.contractor_overtime_approvals
       where contractor_id = p_freelancer
         and retainer_start = wstart and retainer_end = wend
         and status = 'approved'
    ) into approved;

    if fp.overtime_enabled and approved and m is not null and a > m then
      base_hours := greatest(m, r);
      ot_hours   := a - m;
      pay        := base_hours * rate + ot_hours * rate * x;
    else
      base_hours := greatest(a, r);
      ot_hours   := 0;
      pay        := base_hours * rate;
    end if;
    floor_applied := (r > a);

    windows := windows || jsonb_build_object(
      'window_start',   wstart,
      'window_end',     wend,
      'hours',          a,
      'retainer_min',   r,
      'overtime_max',   m,
      'overtime_multiplier', x,
      'approved',       approved,
      'base_hours',     base_hours,
      'overtime_hours', ot_hours,
      'floor_applied',  floor_applied,
      'pay',            round(pay, 2)
    );
    total_hours := total_hours + a;
    total_pay   := total_pay + pay;
  end loop;

  return jsonb_build_object(
    'freelancer_id',       p_freelancer,
    'period_start',        p_start,
    'period_end',          p_end,
    'payment_type',        fp.payment_type,
    'rate',                rate,
    'retainer_enabled',    fp.retainer_enabled,
    'overtime_enabled',    fp.overtime_enabled,
    'overtime_multiplier', x,
    'windows',             windows,
    'total_hours',         total_hours,
    'total_pay',           round(total_pay, 2)
  );
end;
$function$;

-- drive_event_to_assignment (trigger fn on drive_events)
CREATE OR REPLACE FUNCTION public.drive_event_to_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile_id uuid;
  v_rate       numeric;
begin
  if NEW.event_type <> 'added' then
    return NEW;
  end if;
  if NEW.mime_type is null or NEW.mime_type not like 'video/%' then
    return NEW;
  end if;

  select p.id, fp.rate
    into v_profile_id, v_rate
  from public.profiles p
  join public.contractor_profiles fp on fp.id = p.id
  where p.id = '6fa98f97-1555-4a73-bfc7-09ff468c94be'
  limit 1;

  if v_profile_id is null then
    return NEW;
  end if;

  insert into public.contractor_assignments
    (contractor_id, title, assignment_type, status, pay_amount,
     completed_at, asset_url, source_drive_event_id)
  values
    (v_profile_id,
     coalesce(NEW.file_name, 'Drive upload'),
     'edit',
     'completed',
     coalesce(v_rate, 0),
     coalesce(NEW.created_time, NEW.created_at),
     NEW.web_view_link,
     NEW.id)
  on conflict (source_drive_event_id) do nothing;

  update public.drive_events set processed_at = now() where id = NEW.id;

  return NEW;
end;
$function$;

-- fl_emit_due_notifications (cron helper) — keep fl_dashboard nav + type strings
CREATE OR REPLACE FUNCTION public.fl_emit_due_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
begin
  for r in
    select id, contractor_id, title
    from public.contractor_assignments
    where status <> 'completed'
      and due_date < current_date
  loop
    if not exists (
      select 1 from public.notifications
      where user_id = r.contractor_id
        and type = 'fl_assignment_overdue'
        and link_target = r.id::text
    ) then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (
        r.contractor_id,
        'fl_assignment_overdue',
        'Overdue Assignment',
        'Assignment "' || r.title || '" is past due.',
        'fl_dashboard',
        r.id::text
      );
    end if;
  end loop;

  for r in
    select id, contractor_id, title
    from public.contractor_assignments
    where status <> 'completed'
      and due_date = current_date
  loop
    if not exists (
      select 1 from public.notifications
      where user_id = r.contractor_id
        and type = 'fl_assignment_due'
        and link_target = r.id::text
    ) then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (
        r.contractor_id,
        'fl_assignment_due',
        'Assignment Due Today',
        'Assignment "' || r.title || '" is due today.',
        'fl_dashboard',
        r.id::text
      );
    end if;
  end loop;
end;
$function$;

-- fl_overtime_check_on_start (trigger fn on contractor_assignments)
CREATE OR REPLACE FUNCTION public.fl_overtime_check_on_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  fp record;
  pt_today date;
  r_start date; r_end date;
  a numeric;
  appr_id uuid;
  fl_name text;
  rec record;
  desc_text text;
begin
  if NEW.status <> 'in_progress' or OLD.status is not distinct from NEW.status
     or OLD.status = 'in_progress' then
    return NEW;
  end if;

  begin
    select payment_type, coalesce(overtime_enabled,false) as overtime_enabled,
           overtime_max_hours, coalesce(overtime_multiplier,1.5) as overtime_multiplier
      into fp
      from public.contractor_profiles
     where id = NEW.contractor_id;

    if fp.payment_type is distinct from 'hourly'
       or not fp.overtime_enabled
       or fp.overtime_max_hours is null then
      return NEW;
    end if;

    pt_today := (now() at time zone 'America/Los_Angeles')::date;
    select ws, we into r_start, r_end from public.fl_retainer_window(pt_today);

    select coalesce(sum(hours_spent), 0) into a
      from public.contractor_assignments
     where contractor_id = NEW.contractor_id
       and hours_spent is not null
       and completed_at is not null
       and (completed_at at time zone 'America/Los_Angeles')::date between r_start and r_end;

    if a < fp.overtime_max_hours - 5 then
      return NEW;
    end if;

    if exists (
      select 1 from public.contractor_overtime_approvals
       where contractor_id = NEW.contractor_id
         and retainer_start = r_start and retainer_end = r_end
    ) then
      return NEW;
    end if;

    insert into public.contractor_overtime_approvals
      (contractor_id, retainer_start, retainer_end, status, trigger_assignment_id)
      values (NEW.contractor_id, r_start, r_end, 'pending', NEW.id)
      returning id into appr_id;

    select full_name into fl_name from public.profiles where id = NEW.contractor_id;
    fl_name := coalesce(fl_name, 'A contractor');

    desc_text :=
      fl_name || ' has ' || round(a, 2) || 'h logged this retainer period ('
      || to_char(r_start, 'Mon DD') || '-' || to_char(r_end, 'Mon DD')
      || '), within 5h of their ' || fp.overtime_max_hours || 'h overtime cap. '
      || 'Completing this task APPROVES overtime pay (' || fp.overtime_multiplier
      || 'x rate) for hours above the cap in this window. '
      || 'If no one approves, all hours are paid at the normal rate.';

    for rec in
      select id from public.profiles
       where role in ('admin', 'director_creative')
         and coalesce(status, 'active') <> 'archived'
    loop
      insert into public.tasks
        (step_key, title, description, assignee_id, status, position,
         related_entity_type, related_entity_id, nav_target, dedup_key)
      values
        ('confirm_overtime',
         'Approve overtime: ' || fl_name,
         desc_text,
         rec.id, 'active', 0,
         'overtime_approval', appr_id, 'freelancers',
         'ot_' || appr_id::text || '_' || rec.id::text);

      insert into public.notifications
        (user_id, type, title, body, link_tab)
      values
        (rec.id, 'fl_overtime_approval', 'Overtime approval needed',
         fl_name || ' is nearing their overtime cap - review in My Tasks.',
         'freelancers');
    end loop;
  exception when others then
    raise warning 'fl_overtime_check_on_start failed for assignment %: %', NEW.id, sqlerrm;
    return NEW;
  end;

  return NEW;
end;
$function$;

-- fl_overtime_task_completed (trigger fn on tasks)
CREATE OR REPLACE FUNCTION public.fl_overtime_task_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  appr record;
begin
  if NEW.related_entity_type is distinct from 'overtime_approval'
     or NEW.related_entity_id is null then
    return NEW;
  end if;
  if NEW.status <> 'complete' or OLD.status = 'complete' then
    return NEW;
  end if;

  select * into appr
    from public.contractor_overtime_approvals
   where id = NEW.related_entity_id
   for update;
  if not found or appr.status <> 'pending' then
    return NEW;
  end if;

  update public.contractor_overtime_approvals
     set status = 'approved',
         approved_by = NEW.assignee_id,
         approved_at = now()
   where id = appr.id;

  update public.tasks
     set status = 'complete', completed_at = now()
   where related_entity_type = 'overtime_approval'
     and related_entity_id = appr.id
     and id <> NEW.id
     and status in ('pending', 'active', 'on_hold');

  return NEW;
end;
$function$;

-- progress_card_to_assignment (trigger fn on progress_cards)
CREATE OR REPLACE FUNCTION public.progress_card_to_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile_id constant uuid := '6fa98f97-1555-4a73-bfc7-09ff468c94be';
  v_rate numeric;
begin
  if NEW.ready_drive_file_id is null then
    return NEW;
  end if;

  perform public.revoke_superseded_ready_assignments(
    NEW.title, NEW.ready_drive_file_id, coalesce(NEW.ready_at, now()));

  select fp.rate into v_rate
  from public.contractor_profiles fp
  where fp.id = v_profile_id;

  insert into public.contractor_assignments
    (contractor_id, title, assignment_type, status, pay_amount,
     completed_at, source_drive_file_id)
  values
    (v_profile_id,
     coalesce(NEW.title, 'Untitled'),
     'edit',
     'completed',
     coalesce(v_rate, 0),
     coalesce(NEW.ready_at, now()),
     NEW.ready_drive_file_id)
  on conflict (source_drive_file_id) do nothing;

  return NEW;
end;
$function$;

-- revoke_superseded_ready_assignments
CREATE OR REPLACE FUNCTION public.revoke_superseded_ready_assignments(p_title text, p_keep_file_id text, p_ready_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  delete from public.contractor_assignments a
  using public.progress_cards old
  where old.ready_drive_file_id = a.source_drive_file_id
    and old.title = p_title
    and old.ready_drive_file_id <> p_keep_file_id
    and old.archived_at is not null
    and old.moved_to_scheduled_at is null
    and old.ready_at between p_ready_at - interval '7 days'
                         and p_ready_at + interval '1 day'
    and not exists (
      select 1 from public.payroll_paid pp
      where pp.profile_id = a.contractor_id
        and pp.period_start = case
          when extract(day from (a.completed_at at time zone 'America/Los_Angeles')) <= 15
            then date_trunc('month', (a.completed_at at time zone 'America/Los_Angeles'))::date
          else (date_trunc('month', (a.completed_at at time zone 'America/Los_Angeles')) + interval '15 days')::date
        end
    );
end;
$function$;

-- trg_fl_assignment_notify_new_owner (trigger fn on contractor_assignments)
CREATE OR REPLACE FUNCTION public.trg_fl_assignment_notify_new_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  should_notify boolean := false;
  v_secret text;
begin
  if (TG_OP = 'INSERT') then
    should_notify := NEW.contractor_id is not null;
  elsif (TG_OP = 'UPDATE') then
    should_notify := NEW.contractor_id is not null
                     and NEW.contractor_id is distinct from OLD.contractor_id;
  end if;

  if not should_notify then
    return NEW;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  perform net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/notify-fl-assignment?secret=' || v_secret,
    body := jsonb_build_object('assignment_id', NEW.id::text),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return NEW;
end;
$function$;

-- trg_mayday_video_match_film (trigger fn on contractor_assignments)
CREATE OR REPLACE FUNCTION public.trg_mayday_video_match_film()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_secret text;
begin
  if NEW.contractor_id is null then
    return NEW;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  perform net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/workflow-internal?secret=' || v_secret,
    body := jsonb_build_object(
      'op', 'complete_match',
      'slug', 'mayday_video_workflow',
      'step_key', 'film_send_to_editor',
      'match_context', jsonb_build_object('editor_id', NEW.contractor_id::text),
      'payload', jsonb_build_object('editor_assignment_id', NEW.id::text)
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Policies that hard-check the role LITERAL (parsed Const, not auto-updated)
--    Add 'contractor' alongside 'freelancer' (non-breaking superset).
--    ALTER POLICY preserves the command + roles, changing only the expression.
-- ---------------------------------------------------------------------------
ALTER POLICY "Staff can create projects" ON public.projects
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND (p.role <> ALL (ARRAY['freelancer','contractor','agency','partner']))
  ));

ALTER POLICY "Staff can update projects" ON public.projects
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND (p.role <> ALL (ARRAY['freelancer','contractor','agency','partner']))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND (p.role <> ALL (ARRAY['freelancer','contractor','agency','partner']))
  ));

-- Storage: route the contractor-upload policy through is_freelancer() so it
-- accepts both role values now, and auto-tightens with the helper at CONTRACT.
ALTER POLICY "Freelancers upload signed docs" ON storage.objects
  WITH CHECK (
    bucket_id = 'freelancer-documents'
    AND (auth.uid())::text = (storage.foldername(name))[1]
    AND public.is_freelancer(auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 7. Backward-compat VIEWS (old names, old column shape). Auto-updatable
--    (1:1 column mapping) + security_invoker so base-table RLS applies as the
--    querying user. FK constraint names are preserved on the base tables, so
--    PostgREST constraint-name embed hints keep resolving through these views.
-- ---------------------------------------------------------------------------
CREATE VIEW public.freelancer_assignments WITH (security_invoker = on) AS
  SELECT id, contractor_id AS freelancer_id, title, description, assignment_type, status,
         due_date, pay_amount, project_id, deliverable_id, mayday_video_id, completed_at,
         created_by, created_at, updated_at, hours_spent, asset_url, declined_at,
         source_drive_event_id, content_type, submit_folder_id, source_drive_file_id, due_time
  FROM public.contractor_assignments;

CREATE VIEW public.freelancer_assignment_comments WITH (security_invoker = on) AS
  SELECT id, assignment_id, author_id, body, created_at
  FROM public.contractor_assignment_comments;

CREATE VIEW public.freelancer_documents WITH (security_invoker = on) AS
  SELECT id, contractor_id AS freelancer_id, uploaded_by, title, description, doc_type,
         storage_path, file_name, signed_at, signed_name, signature_storage_path,
         created_at, updated_at
  FROM public.contractor_documents;

CREATE VIEW public.freelancer_hours WITH (security_invoker = on) AS
  SELECT id, contractor_id AS freelancer_id, period_start, period_end, total_hours, notes,
         submitted_at, reviewed_by, reviewed_at
  FROM public.contractor_hours;

CREATE VIEW public.freelancer_overtime_approvals WITH (security_invoker = on) AS
  SELECT id, contractor_id AS freelancer_id, retainer_start, retainer_end, status,
         trigger_assignment_id, approved_by, approved_at, created_at
  FROM public.contractor_overtime_approvals;

CREATE VIEW public.freelancer_profiles WITH (security_invoker = on) AS
  SELECT id, specialty, hourly_rate, phone, payment_method, payment_details, bio,
         payment_type, rate, tour_completed_at, created_at, updated_at, saved_signature,
         saved_initials, retainer_enabled, retainer_min_hours, overtime_enabled,
         overtime_max_hours, overtime_multiplier
  FROM public.contractor_profiles;

-- Grants on the compat views (RLS via security_invoker still governs rows).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.freelancer_assignments         TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.freelancer_assignment_comments TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.freelancer_documents           TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.freelancer_hours               TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.freelancer_overtime_approvals  TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.freelancer_profiles            TO authenticated, service_role;
GRANT SELECT ON public.freelancer_assignments         TO anon;
GRANT SELECT ON public.freelancer_assignment_comments TO anon;
GRANT SELECT ON public.freelancer_documents           TO anon;
GRANT SELECT ON public.freelancer_hours               TO anon;
GRANT SELECT ON public.freelancer_overtime_approvals  TO anon;
GRANT SELECT ON public.freelancer_profiles            TO anon;

-- Reload PostgREST schema cache so contractor_* + the compat views are exposed.
NOTIFY pgrst, 'reload schema';
