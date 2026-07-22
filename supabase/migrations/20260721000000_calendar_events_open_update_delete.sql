-- Open calendar_events UPDATE and DELETE to all authenticated users.
--
-- Rationale:
--   * UPDATE: all roles should be able to add team members (the `guests` array)
--     to any calendar event, not just the event creator or admins.
--   * DELETE: when a project's post date is cleared, the client auto-deletes the
--     linked calendar event. Previously this silently failed for any editor who
--     wasn't the event's creator or an admin, orphaning the event. Any editor who
--     can clear a project's post date must be able to delete its calendar event.
--
-- SELECT is already open to all authenticated users (calendar_events_select USING true),
-- so this brings write access in line for this internal team tool.

DROP POLICY IF EXISTS calendar_events_update ON public.calendar_events;
CREATE POLICY calendar_events_update ON public.calendar_events
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS calendar_events_delete ON public.calendar_events;
CREATE POLICY calendar_events_delete ON public.calendar_events
  FOR DELETE TO authenticated
  USING (true);
