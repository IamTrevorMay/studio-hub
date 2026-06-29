ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS post_time text,
  ADD COLUMN IF NOT EXISTS calendar_event_id uuid
    REFERENCES public.calendar_events(id) ON DELETE SET NULL;
