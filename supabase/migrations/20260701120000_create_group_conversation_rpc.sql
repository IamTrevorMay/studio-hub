-- Group message creation failed with:
--   "new row violates row-level security policy for table conversations"
--
-- Cause: the client did `insert(...).select().single()`, which PostgREST runs as
-- INSERT ... RETURNING. Postgres enforces the conversations SELECT policy on the
-- returned row, and that policy requires the caller to already be a participant.
-- For a brand-new group the creator's conversation_participants row does not exist
-- yet (it's inserted in a *second* call), so RETURNING is denied -> 42501.
--
-- DMs never hit this because they go through the SECURITY DEFINER get_or_create_dm
-- RPC. This adds the equivalent for groups: create the conversation and all
-- participant rows atomically, bypassing the chicken-and-egg, and return the row.

create or replace function public.create_group_conversation(
  p_participant_ids uuid[],
  p_name text default null
)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  creator uuid := auth.uid();
  conv public.conversations;
begin
  if creator is null then
    raise exception 'Not authenticated';
  end if;
  if p_participant_ids is null or array_length(p_participant_ids, 1) is null then
    raise exception 'At least one other participant is required';
  end if;

  insert into public.conversations (name, is_group, created_by)
  values (
    nullif(btrim(coalesce(p_name, '')), ''),
    array_length(p_participant_ids, 1) > 1,
    creator
  )
  returning * into conv;

  -- Creator + selected users, de-duplicated (creator may already be in the list).
  insert into public.conversation_participants (conversation_id, user_id)
  select conv.id, uid
  from (select distinct unnest(array_append(p_participant_ids, creator)) as uid) s;

  return conv;
end;
$$;

grant execute on function public.create_group_conversation(uuid[], text) to authenticated;
