ALTER TABLE public.calendar_events
  DROP CONSTRAINT calendar_events_event_type_check;

ALTER TABLE public.calendar_events
  ADD CONSTRAINT calendar_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'deadline', 'meeting', 'live_recording', 'filming',
    'video_post', 'tmbb_video', 'unavailable', 'sponsor'
  ]));
