-- Per-sender unread DM breakdown, for the Dashboard team list.
--
-- get_unread_dm_count() already returns a single global integer; this returns
-- the same predicate grouped by sender, plus the conversation id so the caller
-- can open the thread without a round trip through get_or_create_dm().
--
-- Scoped to 1:1 conversations on purpose: the badge sits on a person's row in
-- the team list and clicking it opens the DM with them, so an unread group
-- message would point somewhere the badge doesn't claim to go.
--
-- SECURITY DEFINER + auth.uid() rather than a p_user_id parameter, so one
-- account can't ask for another account's unread breakdown.
CREATE OR REPLACE FUNCTION public.get_unread_dm_by_sender()
RETURNS TABLE (sender_id uuid, conversation_id uuid, unread_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT dm.user_id AS sender_id,
         dm.conversation_id,
         COUNT(*)::int AS unread_count
  FROM public.direct_messages dm
  JOIN public.conversation_participants cp
    ON cp.conversation_id = dm.conversation_id
   AND cp.user_id = auth.uid()
  JOIN public.conversations c
    ON c.id = dm.conversation_id
  WHERE dm.user_id <> auth.uid()
    AND dm.created_at > cp.last_read_at
    AND c.is_group = FALSE
  GROUP BY dm.user_id, dm.conversation_id;
$$;

REVOKE ALL ON FUNCTION public.get_unread_dm_by_sender() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_unread_dm_by_sender() TO authenticated;
