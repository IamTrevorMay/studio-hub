-- The 'research' canonical stage was added to the app (CANONICAL_STAGES) but the
-- projects check constraints were never widened to allow it, so creating a project
-- with start_column='research' (or moving a card to status='research') fails with
-- projects_start_column_check / projects_status_check violations. Add 'research'.

alter table public.projects drop constraint if exists projects_start_column_check;
alter table public.projects add constraint projects_start_column_check
  check (start_column is null or start_column in
    ('queue','research','write','pre_production','film','review','edit','post_production','publish'));

alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in
    ('queue','backlog','research','write','pre_production','film','review','edit','post_production','publish'));
