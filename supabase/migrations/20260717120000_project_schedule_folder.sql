-- Film Date, Edit Deadline, and linked Drive folder for project cards.
-- Drives the Schedule section (Gantt / Swimlane) below the Projects board.
alter table public.projects
  add column if not exists film_date date,
  add column if not exists edit_deadline date,
  add column if not exists drive_folder_id text,
  add column if not exists drive_folder_name text,
  add column if not exists drive_folder_url text;
