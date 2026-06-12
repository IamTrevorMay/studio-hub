-- Auto-complete the Mayday Video Kanban's `film` and `edit` stage tasks when
-- the editor's contractor assignment lifecycles past the corresponding gate.
--
--   film  → closes when the editor assignment is CREATED
--           (Trevor picking the editor is the manual gate the legacy
--            mayday_video_workflow used to clear this stage).
--   edit  → closes when the editor assignment is COMPLETED
--           (editor finishing their work clears the wait).
--
-- Both hooks are scoped to:
--   * projects.type = 'mayday_video'
--   * freelancer_assignments.assignment_type = 'edit'
--   * projects.status matching the stage being closed (no stale closures)
--
-- Each closed task fans out one notification mirroring the card-move pattern.

create or replace function public.auto_complete_film_on_assignment_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_type   text;
  v_project_status text;
  v_project_name   text;
  v_task           record;
begin
  if new.project_id is null then return new; end if;
  if new.assignment_type is distinct from 'edit' then return new; end if;

  select type, status, name
    into v_project_type, v_project_status, v_project_name
  from public.projects
  where id = new.project_id;

  if v_project_type is distinct from 'mayday_video' then return new; end if;
  if v_project_status is distinct from 'film' then return new; end if;

  for v_task in
    update public.tasks
      set status = 'complete',
          completed_at = now()
    where related_entity_type = 'project'
      and related_entity_id = new.project_id
      and step_key = 'film'
      and status in ('pending', 'active', 'on_hold')
    returning id, assignee_id, title
  loop
    if v_task.assignee_id is not null then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target, is_read)
      values (
        v_task.assignee_id,
        'task_assigned',
        'Auto-completed: ' || v_task.title,
        'Marked complete when the editor assignment was created.',
        'my_tasks',
        v_task.id::text,
        false
      );
    end if;
  end loop;

  return new;
end
$$;

create or replace function public.auto_complete_edit_on_assignment_complete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_type   text;
  v_project_status text;
  v_task           record;
begin
  if new.project_id is null then return new; end if;
  if new.assignment_type is distinct from 'edit' then return new; end if;
  if new.status is distinct from 'completed' then return new; end if;
  if old.status = 'completed' then return new; end if;

  select type, status
    into v_project_type, v_project_status
  from public.projects
  where id = new.project_id;

  if v_project_type is distinct from 'mayday_video' then return new; end if;
  if v_project_status is distinct from 'edit' then return new; end if;

  for v_task in
    update public.tasks
      set status = 'complete',
          completed_at = now()
    where related_entity_type = 'project'
      and related_entity_id = new.project_id
      and step_key = 'edit'
      and status in ('pending', 'active', 'on_hold')
    returning id, assignee_id, title
  loop
    if v_task.assignee_id is not null then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target, is_read)
      values (
        v_task.assignee_id,
        'task_assigned',
        'Auto-completed: ' || v_task.title,
        'Marked complete when the editor finished their assignment.',
        'my_tasks',
        v_task.id::text,
        false
      );
    end if;
  end loop;

  return new;
end
$$;

drop trigger if exists tr_auto_complete_film_on_assignment on public.freelancer_assignments;
create trigger tr_auto_complete_film_on_assignment
after insert on public.freelancer_assignments
for each row execute function public.auto_complete_film_on_assignment_insert();

drop trigger if exists tr_auto_complete_edit_on_assignment on public.freelancer_assignments;
create trigger tr_auto_complete_edit_on_assignment
after update of status on public.freelancer_assignments
for each row execute function public.auto_complete_edit_on_assignment_complete();
