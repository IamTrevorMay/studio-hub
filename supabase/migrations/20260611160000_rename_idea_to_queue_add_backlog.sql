-- Rename canonical Kanban stage 'idea' to 'queue' across all stage columns
-- and add 'backlog' as a special parking status for cards held below the board.

alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects drop constraint if exists projects_start_column_check;
alter table public.project_card_handoffs drop constraint if exists project_card_handoffs_from_stage_check;
alter table public.project_card_handoffs drop constraint if exists project_card_handoffs_to_stage_check;

update public.projects set status = 'queue' where status = 'idea';
update public.projects set start_column = 'queue' where start_column = 'idea';
update public.tasks set step_key = 'queue' where step_key = 'idea';
update public.project_stage_assignments set stage = 'queue' where stage = 'idea';
update public.project_card_handoffs set from_stage = 'queue' where from_stage = 'idea';
update public.project_card_handoffs set to_stage = 'queue' where to_stage = 'idea';

alter table public.projects add constraint projects_status_check
  check (status in ('queue', 'backlog', 'write', 'produce', 'edit', 'review', 'publish'));

alter table public.projects add constraint projects_start_column_check
  check (start_column is null or start_column in ('queue', 'write', 'produce', 'edit', 'review', 'publish'));

alter table public.projects alter column status set default 'queue';

alter table public.project_card_handoffs add constraint project_card_handoffs_from_stage_check
  check (from_stage in ('queue', 'backlog', 'write', 'produce', 'edit', 'review', 'publish'));

alter table public.project_card_handoffs add constraint project_card_handoffs_to_stage_check
  check (to_stage in ('queue', 'backlog', 'write', 'produce', 'edit', 'review', 'publish'));
