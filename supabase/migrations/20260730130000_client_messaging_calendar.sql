-- Client Portal part 4: messaging restriction + isolated client calendar.
-- Clients may only converse with admins, the Creative Director, and their
-- assigned editors — enforced in the DEFINER RPCs and participant RLS, not
-- just the UI. Clients are also fenced off the wide-open staff calendar and
-- get a scoped RPC instead.

-- 1. Allowed-set helper.
create or replace function public.client_can_message(p_client uuid, p_other uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from profiles p where p.id = p_other and
           (p.role = 'admin' or (p.role = 'director' and p.sub_role = 'creative')))
      or public.is_client_editor(p_client, p_other);
$$;
revoke execute on function public.client_can_message(uuid, uuid) from anon;

-- 2. Harden get_or_create_dm (live body reproduced verbatim + client guards;
-- symmetric: members/unassigned contractors cannot DM a client either).
CREATE OR REPLACE FUNCTION public.get_or_create_dm(other_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  conv_id UUID;
BEGIN
  IF public.is_client(auth.uid()) AND NOT public.client_can_message(auth.uid(), other_user_id) THEN
    RAISE EXCEPTION 'This user is not available to message';
  END IF;
  IF public.is_client(other_user_id) AND NOT public.client_can_message(other_user_id, auth.uid()) THEN
    RAISE EXCEPTION 'This user is not available to message';
  END IF;

  -- Find existing DM conversation
  SELECT cp1.conversation_id INTO conv_id
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2
    ON cp1.conversation_id = cp2.conversation_id
  JOIN public.conversations c
    ON c.id = cp1.conversation_id
  WHERE cp1.user_id = auth.uid()
    AND cp2.user_id = other_user_id
    AND c.is_group = FALSE
  LIMIT 1;

  -- Create new DM if none exists
  IF conv_id IS NULL THEN
    INSERT INTO public.conversations (is_group, created_by)
    VALUES (FALSE, auth.uid())
    RETURNING id INTO conv_id;

    INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (conv_id, auth.uid()), (conv_id, other_user_id);
  END IF;

  RETURN conv_id;
END;
$function$;

-- 3. Harden create_group_conversation (20260703000300 body + client guard).
create or replace function public.create_group_conversation(
  p_participant_ids uuid[],
  p_name text default null::text
) returns conversations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  creator uuid := auth.uid();
  conv public.conversations;
  v_valid int;
  v_requested int;
  v_client uuid;
begin
  if creator is null then
    raise exception 'Not authenticated';
  end if;
  if p_participant_ids is null or array_length(p_participant_ids, 1) is null then
    raise exception 'At least one other participant is required';
  end if;
  if array_length(p_participant_ids, 1) > 50 then
    raise exception 'Too many participants';
  end if;

  -- Every requested participant must be an existing profile (no forced-add of
  -- arbitrary/garbage ids). Compare distinct requested (excluding the creator).
  select count(distinct uid) into v_requested
  from unnest(p_participant_ids) uid
  where uid <> creator;

  select count(*) into v_valid
  from public.profiles pr
  where pr.id in (select distinct unnest(p_participant_ids)) and pr.id <> creator;

  if v_valid < v_requested then
    raise exception 'One or more participants are not valid users';
  end if;

  -- For every client involved (creator or participant), every other member
  -- must be in that client's allowed set (admins / creative director / their editors).
  for v_client in
    select s.uid
    from (select distinct unnest(array_append(p_participant_ids, creator)) as uid) s
    where public.is_client(s.uid)
  loop
    if exists (
      select 1
      from (select distinct unnest(array_append(p_participant_ids, creator)) as uid) s2
      where s2.uid <> v_client
        and not public.client_can_message(v_client, s2.uid)
    ) then
      raise exception 'One or more participants cannot be in a conversation with a client';
    end if;
  end loop;

  insert into public.conversations (name, is_group, created_by)
  values (
    nullif(btrim(coalesce(p_name, '')), ''),
    array_length(p_participant_ids, 1) > 1,
    creator
  )
  returning * into conv;

  insert into public.conversation_participants (conversation_id, user_id)
  select conv.id, uid
  from (select distinct unnest(array_append(p_participant_ids, creator)) as uid) s;

  return conv;
end;
$function$;

-- 4. Clients cannot add themselves (or be added) to conversations directly —
-- they only enter via the DEFINER RPCs above, which validate the allowed set.
drop policy if exists "Authenticated can add participants" on public.conversation_participants;
create policy "Authenticated can add participants"
  on public.conversation_participants for insert to authenticated
  with check (not public.is_client(auth.uid()) and not public.is_client(user_id));

-- 5. Client recipient picker.
create or replace function public.client_message_recipients()
returns table (id uuid, full_name text, nickname text, title text, avatar_url text,
               role text, sub_role text)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select p.id, p.full_name, p.nickname, p.title, p.avatar_url, p.role, p.sub_role
  from profiles p
  where public.is_client(auth.uid())
    and p.id <> auth.uid()
    and (p.role = 'admin'
      or (p.role = 'director' and p.sub_role = 'creative')
      or public.is_client_editor(auth.uid(), p.id));
$$;
revoke execute on function public.client_message_recipients() from anon;

-- 6. Isolated client calendar: own assignments + anonymized busy blocks for
-- their editors' other active assignments (dates + editor name only).
create or replace function public.client_calendar_events()
returns table (kind text, assignment_id uuid, title text, assigned_date date,
               due_date date, due_time time, status text,
               editor_id uuid, editor_name text)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select 'own'::text, a.id, a.title,
         (a.created_at at time zone 'America/Los_Angeles')::date,
         a.due_date, a.due_time, a.status, a.contractor_id,
         coalesce(p.nickname, p.full_name)
  from contractor_assignments a
  join profiles p on p.id = a.contractor_id
  where public.is_client(auth.uid())
    and a.created_by = auth.uid()
  union all
  select 'busy'::text, null::uuid, null::text,
         (a.created_at at time zone 'America/Los_Angeles')::date,
         a.due_date, null::time, null::text, a.contractor_id,
         coalesce(p.nickname, p.full_name)
  from contractor_assignments a
  join client_editors ce on ce.contractor_id = a.contractor_id and ce.client_id = auth.uid()
  join profiles p on p.id = a.contractor_id
  where public.is_client(auth.uid())
    and a.created_by is distinct from auth.uid()
    and a.status <> 'completed';
$$;
revoke execute on function public.client_calendar_events() from anon;

-- 7. Fence clients off the wide-open staff calendar (predicates otherwise kept).
drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select to authenticated using (not public.is_client(auth.uid()));

drop policy if exists calendar_events_insert on public.calendar_events;
create policy calendar_events_insert on public.calendar_events
  for insert to authenticated
  with check (auth.uid() = created_by and not public.is_client(auth.uid()));

drop policy if exists calendar_events_update on public.calendar_events;
create policy calendar_events_update on public.calendar_events
  for update to authenticated
  using (not public.is_client(auth.uid())) with check (not public.is_client(auth.uid()));

drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_delete on public.calendar_events
  for delete to authenticated using (not public.is_client(auth.uid()));

-- 8. Clients cannot forge notifications: all client-related notifications are
-- emitted by DEFINER triggers/RPCs, so client sessions never need direct INSERT.
drop policy if exists "Authenticated can insert" on public.notifications;
create policy "Authenticated can insert" on public.notifications
  for insert with check (auth.role() = 'authenticated' and not public.is_client(auth.uid()));

notify pgrst, 'reload schema';
