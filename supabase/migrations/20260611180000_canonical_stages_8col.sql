-- Expand canonical Kanban from 6 to 8 stages.
-- New order: queue, write, pre_production, film, review, edit, post_production, publish
-- Renames existing 'produce' -> 'film' (shoot stage); adds pre_production, post_production.

alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects drop constraint if exists projects_start_column_check;
alter table public.project_card_handoffs drop constraint if exists project_card_handoffs_from_stage_check;
alter table public.project_card_handoffs drop constraint if exists project_card_handoffs_to_stage_check;

update public.projects set status = 'film' where status = 'produce';
update public.projects set start_column = 'film' where start_column = 'produce';
update public.tasks set step_key = 'film' where step_key = 'produce';
update public.project_stage_assignments set stage = 'film' where stage = 'produce';
update public.project_card_handoffs set from_stage = 'film' where from_stage = 'produce';
update public.project_card_handoffs set to_stage = 'film' where to_stage = 'produce';

alter table public.projects add constraint projects_status_check
  check (status in ('queue','backlog','write','pre_production','film','review','edit','post_production','publish'));

alter table public.projects add constraint projects_start_column_check
  check (start_column is null or start_column in ('queue','write','pre_production','film','review','edit','post_production','publish'));

alter table public.project_card_handoffs add constraint project_card_handoffs_from_stage_check
  check (from_stage in ('queue','backlog','write','pre_production','film','review','edit','post_production','publish'));

alter table public.project_card_handoffs add constraint project_card_handoffs_to_stage_check
  check (to_stage in ('queue','backlog','write','pre_production','film','review','edit','post_production','publish'));
