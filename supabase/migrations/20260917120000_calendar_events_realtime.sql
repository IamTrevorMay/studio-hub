-- Calendar.js now subscribes to calendar_events so changes made by the
-- google-calendar-pull cron (imports / moves / deletes) and by teammates show
-- up without a tab refocus. Low-write table; safe to add to the publication.
alter publication supabase_realtime add table public.calendar_events;
