-- google-calendar-pull now imports Google-born events, not just echoes back the
-- ones Studio pushed. The importer upserts on google_event_id, so that column
-- needs a real unique index (a partial one can't be inferred by ON CONFLICT).
-- NULLs stay distinct in Postgres, so Studio-only events are unaffected.

DROP INDEX IF EXISTS idx_calendar_events_google_event_id;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_google_event_id_key
  ON public.calendar_events (google_event_id);
