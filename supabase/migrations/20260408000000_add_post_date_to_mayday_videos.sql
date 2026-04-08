alter table public.mayday_videos
  add column post_date date,
  add column calendar_event_id uuid references public.calendar_events(id) on delete set null;
