-- Support two Messages-page actions from the conversation right-click menu:
--   1. "Leave" — a user removes themselves from a conversation/group.
--   2. "Rename" — the group creator renames the conversation.
--
-- Neither had an RLS policy: conversation_participants had no DELETE policy
-- (so leaving silently did nothing), and conversations had no UPDATE policy
-- (so rename was silently denied). Both writes returned 0 rows, no error.

-- Any authenticated user may remove their OWN participant row (leave).
drop policy if exists "Users can leave conversations" on public.conversation_participants;
create policy "Users can leave conversations"
on public.conversation_participants
for delete
to authenticated
using (user_id = auth.uid());

-- Only the creator of a conversation may rename it (update its row).
drop policy if exists "Creator can update conversation" on public.conversations;
create policy "Creator can update conversation"
on public.conversations
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());
