-- Overtime approval task copy: Approve / Deny, not Complete / Decline.
--
-- The card is a decision, not a chore, and since 20260828140000 a decline is a
-- real outcome (fl_overtime_task_declined marks the window declined and clears
-- the sibling tasks) rather than just taking the task off one admin's plate.
-- The body text still described the old world — "Completing this task
-- APPROVES…", "If no one approves…" — which no longer matches the two buttons
-- on the card. This restates it around the actual choice.
--
-- Body only: the branching, the 5h threshold, the recipient loop, and the
-- notification are unchanged from the live definition.

create or replace function public.fl_overtime_check_on_start()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
$function$;

-- Restate the copy on approvals that are still open, so the card Trevor is
-- looking at right now reads correctly instead of waiting for the next one.
update public.tasks t
   set description = regexp_replace(
         t.description,
         'Completing this task APPROVES overtime pay \(([0-9.]+)x rate\) for hours above the cap in this window\. If no one approves, all hours are paid at the normal rate\.',
         'Approve to pay \1x for hours above the cap in this window. Deny keeps every hour at the normal rate — so does leaving it undecided.'
       )
 where t.related_entity_type = 'overtime_approval'
   and t.status in ('pending', 'active', 'on_hold')
   and t.description like '%Completing this task APPROVES%';
