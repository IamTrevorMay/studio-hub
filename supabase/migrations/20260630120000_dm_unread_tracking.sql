-- Per-participant read cursor for direct messages.
alter table public.conversation_participants
  add column if not exists last_read_at timestamptz not null default now();

-- Total unread DM count across all of a user's conversations.
-- Counts messages newer than the participant's last_read_at, excluding own messages.
-- SECURITY INVOKER (default) so existing RLS on direct_messages/conversation_participants applies.
create or replace function public.get_unread_dm_count(p_user_id uuid)
returns integer
language sql
stable
as $$
  select count(*)::int
  from public.direct_messages dm
  join public.conversation_participants cp
    on cp.conversation_id = dm.conversation_id
   and cp.user_id = p_user_id
  where dm.user_id <> p_user_id
    and dm.created_at > cp.last_read_at;
$$;

grant execute on function public.get_unread_dm_count(uuid) to authenticated;
