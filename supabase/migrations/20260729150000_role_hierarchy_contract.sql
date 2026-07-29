-- Role hierarchy restructure — CONTRACT phase (destructive; HOLD until the new
-- frontend is deployed to prod). Apply only after:
--   1. the frontend that dual-accepts director/director_creative/director_comms
--      and treats partner/assistant/producer as removed is live on Vercel, and
--   2. the updated edge functions are deployed (done in EXPAND).
--
-- What this does:
--   * flips director_creative/director_comms -> 'director' (sub_role already set)
--   * hard-deletes the partner user + removes partner-read RLS + is_roadmap_viewer
--   * tightens is_admin / overtime / staff policies / role constraint to the
--     final 4 roles: admin, director, member, contractor

-- 1. Flip director role data. profiles_lock_admin_fields() blocks role changes
--    when auth.uid() is null (service context), so toggle it within the txn —
--    a failure rolls back the re-enable too, so the guard is never left off.
alter table public.profiles disable trigger profiles_lock_admin_fields;
update public.profiles set role = 'director'
  where role in ('director_creative', 'director_comms');
-- Backstop: any director still missing a sub_role defaults to communications.
update public.profiles set sub_role = 'communications'
  where role = 'director' and sub_role is null;
alter table public.profiles enable trigger profiles_lock_admin_fields;

-- 2. Hard-delete the external partner user (cascades profile + owned data).
delete from auth.users where id = 'b88d48bd-46bf-404a-a9fe-c52753235753';

-- 3. Remove partner-read mechanics from the roadmap.
create or replace function public.is_roadmap_viewer(uid uuid)
 returns boolean language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$ select public.is_admin(uid); $function$;

drop policy if exists "bd_phases read" on public.bd_phases;
create policy "bd_phases read" on public.bd_phases for select
  using (public.is_admin(auth.uid()));
drop policy if exists "bd_initiatives read" on public.bd_initiatives;
create policy "bd_initiatives read" on public.bd_initiatives for select
  using (public.is_admin(auth.uid()));
drop policy if exists "bd_initiative_links read" on public.bd_initiative_links;
create policy "bd_initiative_links read" on public.bd_initiative_links for select
  using (public.is_admin(auth.uid()));
drop policy if exists "bd_milestones read" on public.bd_milestones;
create policy "bd_milestones read" on public.bd_milestones for select
  using (public.is_admin(auth.uid()));
drop policy if exists "bd_tasks read" on public.bd_tasks;
create policy "bd_tasks read" on public.bd_tasks for select
  using (public.is_admin(auth.uid()));

-- 4. Tighten admin-tier helpers to admin + director only.
create or replace function public.is_admin()
 returns boolean language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from public.profiles
    where id = auth.uid() and role in ('admin','director'));
$function$;

create or replace function public.is_admin(uid uuid)
 returns boolean language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from public.profiles
    where id = uid and role in ('admin','director'));
$function$;

-- 5. Narrow staff (non-contractor) allow-lists to the final roles.
drop policy if exists "Non-freelancer read handoffs" on public.project_card_handoffs;
create policy "Non-freelancer read handoffs" on public.project_card_handoffs for select
  using (exists (select 1 from profiles where id = auth.uid()
    and role = any (array['admin','director','member']::text[])));
drop policy if exists "Non-freelancer write handoffs" on public.project_card_handoffs;
create policy "Non-freelancer write handoffs" on public.project_card_handoffs for insert
  with check (exists (select 1 from profiles where id = auth.uid()
    and role = any (array['admin','director','member']::text[])));
drop policy if exists "Non-freelancer read notes" on public.project_card_notes;
create policy "Non-freelancer read notes" on public.project_card_notes for select
  using (exists (select 1 from profiles where id = auth.uid()
    and role = any (array['admin','director','member']::text[])));
drop policy if exists "Non-freelancer write notes" on public.project_card_notes;
create policy "Non-freelancer write notes" on public.project_card_notes for insert
  with check (exists (select 1 from profiles where id = auth.uid()
    and role = any (array['admin','director','member']::text[])));

-- 6. projects staff-write exclusion: drop removed roles, keep contractor(+legacy)
drop policy if exists "Staff can create projects" on public.projects;
create policy "Staff can create projects" on public.projects for insert
  with check (exists (select 1 from profiles p where p.id = auth.uid()
    and p.role <> all (array['contractor','freelancer']::text[])));
drop policy if exists "Staff can update projects" on public.projects;
create policy "Staff can update projects" on public.projects for update
  using (exists (select 1 from profiles p where p.id = auth.uid()
    and p.role <> all (array['contractor','freelancer']::text[])))
  with check (exists (select 1 from profiles p where p.id = auth.uid()
    and p.role <> all (array['contractor','freelancer']::text[])));

-- 7. Contractor overtime approval tasks: admin + director only.
create or replace function public.fl_overtime_check_on_start()
 returns trigger language plpgsql security definer
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
      || 'Completing this task APPROVES overtime pay (' || fp.overtime_multiplier
      || 'x rate) for hours above the cap in this window. '
      || 'If no one approves, all hours are paid at the normal rate.';
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

-- 8. Final role constraint: admin, director, member, contractor.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin','director','member','contractor']::text[]));

notify pgrst, 'reload schema';

-- NOTE: `title` column is intentionally NOT dropped (deprecated mirror). Prune
-- it in a later cleanup once nothing reads it. jobs-review already writes
-- role 'contractor'; no edge-function changes remain for CONTRACT.
