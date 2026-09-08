-- User deactivation follow-up (2026-09-08): DB-side notification/task
-- fan-outs skip deactivated recipients. Bodies pulled from the live DB via
-- pg_get_functiondef and patched only with `deactivated_at` predicates.

CREATE OR REPLACE FUNCTION public.alert_failed_cron_jobs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  fail record;
  rec_admin record;
  pt_today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  for fail in
    select coalesce(j.jobname, d.jobid::text) as job,
           count(*) as fails,
           max(d.end_time) as last_fail
    from cron.job_run_details d
    left join cron.job j on j.jobid = d.jobid
    where d.status = 'failed'
      and d.start_time > now() - interval '24 hours'
    group by coalesce(j.jobname, d.jobid::text)
  loop
    for rec_admin in
      select id from public.profiles where public.is_admin(id) and deactivated_at is null
    loop
      insert into public.notifications (user_id, type, title, body, link_tab, is_read, created_at)
      select rec_admin.id,
             'cron_failure',
             'Scheduled job failing: ' || fail.job,
             fail.fails || ' failed run(s) in the last 24h (last at ' ||
               to_char(fail.last_fail at time zone 'America/Los_Angeles', 'Mon DD HH24:MI') ||
               ' PT). Check Ops -> cron status and the edge function logs.',
             'ops',
             false,
             now()
      where not exists (
        select 1 from public.notifications n
        where n.user_id = rec_admin.id
          and n.type = 'cron_failure'
          and n.title = 'Scheduled job failing: ' || fail.job
          and (n.created_at at time zone 'America/Los_Angeles')::date = pt_today
      );
    end loop;
  end loop;

  delete from cron.job_run_details where end_time < now() - interval '7 days';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fl_overtime_check_on_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  fp record; pt_today date; r_start date; r_end date; a numeric; appr_id uuid;
  fl_name text; rec record; desc_text text;
begin
  if NEW.status <> 'in_progress' or OLD.status is not distinct from NEW.status or OLD.status = 'in_progress' then
    return NEW;
  end if;
  begin
    select payment_type, coalesce(overtime_enabled,false) as overtime_enabled,
           overtime_max_hours, coalesce(overtime_multiplier,1.5) as overtime_multiplier
      into fp from public.contractor_profiles where id = NEW.contractor_id;
    if fp.payment_type is distinct from 'hourly' or not fp.overtime_enabled or fp.overtime_max_hours is null then
      return NEW;
    end if;
    pt_today := (now() at time zone 'America/Los_Angeles')::date;
    select ws, we into r_start, r_end from public.fl_retainer_window(pt_today);
    select coalesce(sum(hours_spent), 0) into a from public.contractor_assignments
     where contractor_id = NEW.contractor_id and hours_spent is not null and completed_at is not null
       and (completed_at at time zone 'America/Los_Angeles')::date between r_start and r_end;
    if a < fp.overtime_max_hours - 5 then return NEW; end if;
    if exists (select 1 from public.contractor_overtime_approvals
       where contractor_id = NEW.contractor_id and retainer_start = r_start and retainer_end = r_end) then
      return NEW;
    end if;
    insert into public.contractor_overtime_approvals
      (contractor_id, retainer_start, retainer_end, status, trigger_assignment_id)
      values (NEW.contractor_id, r_start, r_end, 'pending', NEW.id) returning id into appr_id;
    select full_name into fl_name from public.profiles where id = NEW.contractor_id;
    fl_name := coalesce(fl_name, 'A contractor');
    desc_text := fl_name || ' has ' || round(a, 2) || 'h logged this retainer period ('
      || to_char(r_start, 'Mon DD') || '-' || to_char(r_end, 'Mon DD')
      || '), within 5h of their ' || fp.overtime_max_hours || 'h overtime cap. '
      || 'Approve to pay ' || fp.overtime_multiplier
      || 'x for hours above the cap in this window. '
      || 'Deny keeps every hour at the normal rate — so does leaving it undecided.';
    for rec in select id from public.profiles
       where role in ('admin', 'director') and coalesce(status, 'active') <> 'archived'
         and deactivated_at is null
    loop
      insert into public.tasks (step_key, title, description, assignee_id, status, position,
         related_entity_type, related_entity_id, nav_target, dedup_key)
      values ('confirm_overtime', 'Approve overtime: ' || fl_name, desc_text, rec.id, 'active', 0,
         'overtime_approval', appr_id, 'freelancers', 'ot_' || appr_id::text || '_' || rec.id::text);
      insert into public.notifications (user_id, type, title, body, link_tab)
      values (rec.id, 'fl_overtime_approval', 'Overtime approval needed',
         fl_name || ' is nearing their overtime cap - review in My Tasks.', 'freelancers');
    end loop;
  exception when others then
    raise warning 'fl_overtime_check_on_start failed for assignment %: %', NEW.id, sqlerrm;
    return NEW;
  end;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.overtime_check_on_task_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  cfg record; v_role text; pt_today date; r_start date; r_end date;
  a numeric; appr_id uuid; who text; rec record; desc_text text;
BEGIN
  -- Only a freshly completed, hours-bearing task. The approval tasks this
  -- inserts have requires_hours unset, so they can't re-enter here.
  IF NEW.status <> 'complete' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.requires_hours IS NOT TRUE OR NEW.hours_spent IS NULL OR NEW.assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.assignee_id;
    -- Contractors are covered by fl_overtime_check_on_start.
    IF v_role IN ('contractor', 'freelancer') THEN RETURN NEW; END IF;

    SELECT * INTO cfg FROM public.hourly_pay_config(NEW.assignee_id);
    IF NOT cfg.is_hourly OR NOT cfg.overtime_enabled OR cfg.overtime_max_hours IS NULL THEN
      RETURN NEW;
    END IF;

    pt_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;
    SELECT ws, we INTO r_start, r_end FROM public.fl_retainer_window(pt_today);
    a := public.hourly_hours_in_window(NEW.assignee_id, r_start, r_end);

    IF a < cfg.overtime_max_hours - 5 THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.contractor_overtime_approvals
                WHERE contractor_id = NEW.assignee_id
                  AND retainer_start = r_start AND retainer_end = r_end) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.contractor_overtime_approvals
      (contractor_id, retainer_start, retainer_end, status)
      VALUES (NEW.assignee_id, r_start, r_end, 'pending')
      RETURNING id INTO appr_id;

    SELECT full_name INTO who FROM public.profiles WHERE id = NEW.assignee_id;
    who := COALESCE(who, 'A team member');
    desc_text := who || ' has ' || round(a, 2) || 'h logged this retainer period ('
      || to_char(r_start, 'Mon DD') || '-' || to_char(r_end, 'Mon DD')
      || '), within 5h of their ' || cfg.overtime_max_hours || 'h overtime cap. '
      || 'Completing this task APPROVES overtime pay (' || cfg.overtime_multiplier
      || 'x rate) for hours above the cap in this window. '
      || 'If no one approves, all hours are paid at the normal rate.';

    FOR rec IN SELECT id FROM public.profiles
                WHERE role IN ('admin', 'director')
                  AND COALESCE(status, 'active') <> 'archived'
                  AND deactivated_at IS NULL
    LOOP
      INSERT INTO public.tasks (step_key, title, description, assignee_id, status, position,
         related_entity_type, related_entity_id, nav_target, dedup_key)
      VALUES ('confirm_overtime', 'Approve overtime: ' || who, desc_text, rec.id, 'active', 0,
         'overtime_approval', appr_id, 'payroll', 'ot_' || appr_id::text || '_' || rec.id::text);
      INSERT INTO public.notifications (user_id, type, title, body, link_tab)
      VALUES (rec.id, 'fl_overtime_approval', 'Overtime approval needed',
         who || ' is nearing their overtime cap - review in My Tasks.', 'payroll');
    END LOOP;
  EXCEPTION WHEN others THEN
    -- Never block a task completion over a pay warning.
    RAISE WARNING 'overtime_check_on_task_complete failed for task %: %', NEW.id, sqlerrm;
    RETURN NEW;
  END;

  RETURN NEW;
END;
$function$
;
