-- Enable editing and deleting of one's own direct messages (Messages page).
-- direct_messages already has an edited_at column but only INSERT + SELECT
-- policies existed, so UPDATE/DELETE were silently denied by RLS. Mirror the
-- channel_messages model: a user may modify only their own messages.

drop policy if exists "Users can edit their own direct messages" on public.direct_messages;
create policy "Users can edit their own direct messages"
on public.direct_messages
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can delete their own direct messages" on public.direct_messages;
create policy "Users can delete their own direct messages"
on public.direct_messages
for delete
to authenticated
using (user_id = auth.uid());

-- REPLICA IDENTITY FULL so filtered realtime DELETE events (filter on
-- conversation_id) are delivered to subscribers with the full old row — the
-- default (primary key only) makes the filter never match, so peers wouldn't
-- see a deleted message disappear live.
alter table public.direct_messages replica identity full;
