-- Follow-up to 20260730130000: the notifications INSERT tightening was
-- bypassed by a second, pre-existing policy — "Service role can insert
-- notifications" WITH CHECK (true) on role {public}, which ORs with every
-- other INSERT policy and let ANY authenticated user (including clients)
-- forge notifications. The service role bypasses RLS entirely, so the policy
-- never did anything for its named purpose. Drop it.
drop policy if exists "Service role can insert notifications" on public.notifications;

notify pgrst, 'reload schema';
