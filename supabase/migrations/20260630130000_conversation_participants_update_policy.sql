-- conversation_participants had INSERT + SELECT policies but no UPDATE policy.
-- markConversationRead() updates last_read_at to clear the unread-DM badge, but RLS
-- silently denied the write (0 rows, no error), so the sidebar badge never cleared.
-- Allow an authenticated user to update only their own participant row.
drop policy if exists "Users can update their own participant row" on public.conversation_participants;
create policy "Users can update their own participant row"
on public.conversation_participants
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
