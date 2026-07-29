-- Role hierarchy restructure — EXPAND phase (non-breaking, apply live).
--
-- Target model (finalized in the CONTRACT migration):
--   roles: admin, director, member, contractor
--   profiles.sub_role: director -> communications|creative ; contractor -> title values ; admin/member -> null
--   deleted: assistant (folds into director), producer (unused), partner (portal removed)
--
-- EXPAND keeps the currently-deployed prod frontend working by:
--   * adding 'director' to the constraint ALONGSIDE the legacy director_creative/director_comms
--   * making is_admin() dual-accept director + both legacy director roles
--   * NOT flipping director role data, NOT deleting anything (CONTRACT does that)

begin;

-- 1. sub_role column ---------------------------------------------------------
alter table public.profiles add column if not exists sub_role text;

-- 2. backfill sub_role (does not change role/title, so the admin-lock trigger
--    is not tripped even under the service context)
update public.profiles set sub_role = title
  where role = 'contractor' and title is not null and sub_role is null;
update public.profiles set sub_role = 'communications'
  where role = 'director_comms' and sub_role is null;
update public.profiles set sub_role = 'creative'
  where role = 'director_creative' and sub_role is null;

-- 3. protect sub_role as an admin-only field (recreated AFTER the backfill so
--    the backfill above is not blocked)
create or replace function public.profiles_lock_admin_fields()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if public.is_admin(auth.uid()) then
    return NEW;
  end if;
  if NEW.role is distinct from OLD.role then
    raise exception 'role is admin-only';
  end if;
  if NEW.sub_role is distinct from OLD.sub_role then
    raise exception 'sub_role is admin-only';
  end if;
  if NEW.posting_allowed is distinct from OLD.posting_allowed then
    raise exception 'posting_allowed is admin-only';
  end if;
  if NEW.title is distinct from OLD.title then
    raise exception 'title is admin-only';
  end if;
  if NEW.assigned_drive_folder_id is distinct from OLD.assigned_drive_folder_id then
    raise exception 'assigned_drive_folder_id is admin-only';
  end if;
  if NEW.assigned_drive_folder_name is distinct from OLD.assigned_drive_folder_name then
    raise exception 'assigned_drive_folder_name is admin-only';
  end if;
  return NEW;
end;
$function$;

-- 4. widen the role constraint (superset: legacy + new 'director') -----------
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array[
    'admin','director','member','contractor',
    'assistant','partner','producer','director_creative','director_comms'
  ]::text[]));

-- 5. admin-tier helpers dual-accept 'director' -------------------------------
create or replace function public.is_admin()
 returns boolean language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin','director','director_creative','director_comms')
  );
$function$;

create or replace function public.is_admin(uid uuid)
 returns boolean language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.profiles
    where id = uid
      and role in ('admin','director','director_creative','director_comms')
  );
$function$;

-- assistant folds into director (admin-tier); 0 assistant users. Keep the
-- function name so its ~8 dependent policies need no change.
create or replace function public.is_admin_or_assistant(uid uuid)
 returns boolean language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select public.is_admin(uid);
$function$;

-- staff 'producer' role is being deleted (0 users); broadcast access becomes
-- admin+director. Keep the function name (used by broadcast RLS + storage).
create or replace function public.is_producer_or_admin(uid uuid)
 returns boolean language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select public.is_admin(uid);
$function$;

-- 6. collapse admin+director rater policies to is_admin() (== admin-tier) -----
drop policy if exists "raters insert own idea rating" on public.idea_ratings;
create policy "raters insert own idea rating" on public.idea_ratings for insert
  with check (user_id = auth.uid() and public.is_admin(auth.uid()));
drop policy if exists "raters read idea ratings" on public.idea_ratings;
create policy "raters read idea ratings" on public.idea_ratings for select
  using (public.is_admin(auth.uid()));
drop policy if exists "raters update own idea rating" on public.idea_ratings;
create policy "raters update own idea rating" on public.idea_ratings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_admin(auth.uid()));

-- announcements: admin+assistant -> admin-tier (is_admin covers admin+director)
drop policy if exists "assistants_admins_insert" on public.announcements;
create policy "assistants_admins_insert" on public.announcements for insert
  with check (public.is_admin(auth.uid()));

-- 7. staff (non-contractor) allow-lists: drop assistant, add director.
--    Legacy director roles kept for the deploy window; CONTRACT narrows them.
drop policy if exists "Non-freelancer read handoffs" on public.project_card_handoffs;
create policy "Non-freelancer read handoffs" on public.project_card_handoffs for select
  using (exists (select 1 from profiles where id = auth.uid()
    and role = any (array['admin','director','member','director_creative','director_comms']::text[])));
drop policy if exists "Non-freelancer write handoffs" on public.project_card_handoffs;
create policy "Non-freelancer write handoffs" on public.project_card_handoffs for insert
  with check (exists (select 1 from profiles where id = auth.uid()
    and role = any (array['admin','director','member','director_creative','director_comms']::text[])));
drop policy if exists "Non-freelancer read notes" on public.project_card_notes;
create policy "Non-freelancer read notes" on public.project_card_notes for select
  using (exists (select 1 from profiles where id = auth.uid()
    and role = any (array['admin','director','member','director_creative','director_comms']::text[])));
drop policy if exists "Non-freelancer write notes" on public.project_card_notes;
create policy "Non-freelancer write notes" on public.project_card_notes for insert
  with check (exists (select 1 from profiles where id = auth.uid()
    and role = any (array['admin','director','member','director_creative','director_comms']::text[])));

-- 8. contractor overtime approval tasks: director_creative -> admin+director
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
       where role in ('admin', 'director', 'director_creative') and coalesce(status, 'active') <> 'archived'
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

commit;

notify pgrst, 'reload schema';
