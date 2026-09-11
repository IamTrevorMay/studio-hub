-- Deleting a project (Projects page) or a film_queue_items row (manual
-- removal — today that's deleting its beat sheet, which cascades here) also
-- sweeps the workflow tasks pointing at it and any sprint cards linked to
-- those tasks or the project. Without this, personal_tasks FKs are ON DELETE
-- SET NULL, so cards were orphaned and tasks lived on.
--
-- BEFORE DELETE, because the SET NULL FKs would sever the links before an
-- AFTER trigger could see them. Fires on cascaded deletes too.

create or replace function public.cleanup_entity_tasks()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_type text := case tg_table_name when 'projects' then 'project' else 'film_queue_item' end;
begin
  -- Sprint cards first (their delete trigger still updates tasks), then tasks.
  delete from personal_tasks
   where task_id in (
     select id from tasks
      where related_entity_type = v_type and related_entity_id = old.id
   );
  if tg_table_name = 'projects' then
    delete from personal_tasks where project_id = old.id;
  end if;
  delete from tasks
   where related_entity_type = v_type and related_entity_id = old.id;
  return old;
end; $$;

drop trigger if exists projects_delete_cleanup_tasks on public.projects;
create trigger projects_delete_cleanup_tasks
  before delete on public.projects
  for each row execute function public.cleanup_entity_tasks();

drop trigger if exists film_queue_items_delete_cleanup_tasks on public.film_queue_items;
create trigger film_queue_items_delete_cleanup_tasks
  before delete on public.film_queue_items
  for each row execute function public.cleanup_entity_tasks();
