-- Emoji reactions on channel messages and DMs.
-- Stored as jsonb on the message row: { "👍": ["<user_id>", ...], ... }.
-- RLS restricts UPDATE on both tables to the message owner, so reactions
-- toggle through a security-definer RPC that checks membership itself.

alter table public.channel_messages
  add column if not exists reactions jsonb not null default '{}'::jsonb;

alter table public.direct_messages
  add column if not exists reactions jsonb not null default '{}'::jsonb;

create or replace function public.toggle_message_reaction(
  p_kind text,          -- 'channel' | 'dm'
  p_message_id uuid,
  p_emoji text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reactions jsonb;
  v_users jsonb;
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_emoji is null or p_emoji = '' or length(p_emoji) > 16 then
    raise exception 'invalid emoji';
  end if;

  if p_kind = 'channel' then
    select cm.reactions, public.can_view_channel(cm.channel_id)
      into v_reactions, v_allowed
      from public.channel_messages cm
     where cm.id = p_message_id
     for update of cm;
  elsif p_kind = 'dm' then
    select dm.reactions,
           exists (
             select 1 from public.conversation_participants cp
              where cp.conversation_id = dm.conversation_id
                and cp.user_id = v_uid
           )
      into v_reactions, v_allowed
      from public.direct_messages dm
     where dm.id = p_message_id
     for update of dm;
  else
    raise exception 'invalid kind';
  end if;

  if not found then
    raise exception 'message not found';
  end if;
  if not coalesce(v_allowed, false) then
    raise exception 'not allowed';
  end if;

  v_reactions := coalesce(v_reactions, '{}'::jsonb);
  v_users := coalesce(v_reactions -> p_emoji, '[]'::jsonb);

  if v_users ? v_uid::text then
    -- Already reacted with this emoji — remove; drop the key when empty.
    select coalesce(jsonb_agg(u), '[]'::jsonb) into v_users
      from jsonb_array_elements_text(v_users) u
     where u <> v_uid::text;
    if jsonb_array_length(v_users) = 0 then
      v_reactions := v_reactions - p_emoji;
    else
      v_reactions := jsonb_set(v_reactions, array[p_emoji], v_users);
    end if;
  else
    v_reactions := jsonb_set(v_reactions, array[p_emoji], v_users || to_jsonb(v_uid::text));
  end if;

  if p_kind = 'channel' then
    update public.channel_messages set reactions = v_reactions where id = p_message_id;
  else
    update public.direct_messages set reactions = v_reactions where id = p_message_id;
  end if;

  return v_reactions;
end;
$$;

revoke execute on function public.toggle_message_reaction(text, uuid, text) from anon, public;
grant execute on function public.toggle_message_reaction(text, uuid, text) to authenticated;
