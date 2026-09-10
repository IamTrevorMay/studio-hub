-- Deleting a MyBoard card that's linked to a workflow task removes that task
-- from the Dashboard badge (tasks.count_in_badge = false). Re-creating a card
-- for the task turns it back on. Tasks that never had a card are untouched.

create or replace function public.card_delete_clears_badge()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if old.task_id is not null then
    update tasks set count_in_badge = false where id = old.task_id;
  end if;
  return old;
end; $$;

create or replace function public.card_insert_restores_badge()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.task_id is not null then
    update tasks set count_in_badge = true where id = new.task_id;
  end if;
  return new;
end; $$;

drop trigger if exists personal_tasks_delete_badge on personal_tasks;
create trigger personal_tasks_delete_badge
  after delete on personal_tasks
  for each row execute function public.card_delete_clears_badge();

drop trigger if exists personal_tasks_insert_badge on personal_tasks;
create trigger personal_tasks_insert_badge
  after insert on personal_tasks
  for each row execute function public.card_insert_restores_badge();

-- Backfill: "Grading the Trade Deadline" task whose card was already deleted.
update tasks set count_in_badge = false
where id = 'aceca7ac-2b57-45bd-8219-76636c089d2c';
