-- Link personal tasks to mayday videos for auto-created production tasks
alter table public.personal_tasks
  add column mayday_video_id uuid references public.mayday_videos(id) on delete set null;

create index idx_personal_tasks_mayday_video_id
  on public.personal_tasks (mayday_video_id)
  where mayday_video_id is not null;
