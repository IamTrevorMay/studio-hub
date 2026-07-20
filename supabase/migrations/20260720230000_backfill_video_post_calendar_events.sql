-- Backfill calendar events for existing video projects that have a Post Date
-- (deadline) but no linked calendar event yet. One-time, idempotent pass:
-- the `calendar_event_id IS NULL` guard means re-running is a no-op for rows
-- already processed.
--
-- For each mayday_video / tm_baseball_video project with a deadline and no
-- linked event:
--   * default post_time to 14:00 when null (persist it so card + event agree)
--   * build start_date = deadline @ post_time in Pacific Time (matches how the
--     Calendar renders and how the app derives Post Date ⇄ event)
--   * end_date = start + 1h, all_day = false
--   * event_type = video_post (mayday) / tmbb_video (tmbb), title = project name
--   * created_by = the project's creator
--   * link the new event back via projects.calendar_event_id
DO $$
DECLARE
  r RECORD;
  new_event_id uuid;
  v_pt text;
  v_start timestamptz;
BEGIN
  FOR r IN
    SELECT id, name, created_by, post_time, deadline, type
    FROM projects
    WHERE type IN ('mayday_video', 'tm_baseball_video')
      AND deadline IS NOT NULL
      AND calendar_event_id IS NULL
      AND created_by IS NOT NULL
  LOOP
    v_pt := COALESCE(r.post_time, '14:00');
    v_start := (r.deadline::text || ' ' || v_pt || ':00')::timestamp
                 AT TIME ZONE 'America/Los_Angeles';

    INSERT INTO calendar_events (title, event_type, start_date, end_date, all_day, created_by)
    VALUES (
      r.name,
      CASE r.type WHEN 'mayday_video' THEN 'video_post' ELSE 'tmbb_video' END,
      v_start,
      v_start + interval '1 hour',
      false,
      r.created_by
    )
    RETURNING id INTO new_event_id;

    UPDATE projects
    SET calendar_event_id = new_event_id,
        post_time = v_pt
    WHERE id = r.id;
  END LOOP;
END $$;
