-- HIGH security fix: channels / channel_messages had NO row-level security, so
-- per-channel allowed_roles gating was enforced only in the client. Any
-- authenticated user could read or post in restricted (e.g. admin-only) channels
-- directly via the API, and rewrite any channel's/group's allowed_roles.
--
-- This enables RLS and enforces the exact model the client already uses
-- (src/pages/Channels.js):
--   * role 'admin' sees/manages everything (line 102 `isAdmin || ...`)
--   * a grouped channel's visibility is governed by its group's allowed_roles
--     (the group overrides the channel's own); ungrouped uses the channel's own
--   * null/empty allowed_roles = open to everyone
--   * channel + group management (create/rename/delete/reorder/perms) is admin-only
--   * messages: post as yourself; delete your own (or admin); pin is admin

-- These tables had RLS disabled but carried legacy PERMISSIVE policies (many
-- USING(true) / unscoped). Enabling RLS activates them, and PERMISSIVE policies
-- OR together — so they must be dropped or they defeat the gated policies below.
drop policy if exists "Channels viewable by authenticated" on public.channels;
drop policy if exists "Authenticated can create channels" on public.channels;
drop policy if exists "Admins can update channels" on public.channels;            -- qual was `true`, misnamed
drop policy if exists "Admins can delete channels" on public.channels;            -- redundant with channels_admin_delete below
drop policy if exists "Channel messages viewable by authenticated" on public.channel_messages;
drop policy if exists "Authenticated can send channel messages" on public.channel_messages;
drop policy if exists "Authenticated users can update messages" on public.channel_messages;  -- true/true
drop policy if exists "Users can edit own channel messages" on public.channel_messages;
drop policy if exists "Users and admins can delete messages" on public.channel_messages;     -- redundant with channel_messages_delete below

-- Visibility helper. SECURITY DEFINER so it can read profiles/channels
-- regardless of the caller's own RLS. Mirrors effectiveChannelVisible().
create or replace function public.can_view_channel(p_channel_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role        text;
  v_ch_allowed  text[];
  v_group_id    uuid;
  v_grp_allowed text[];
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null then
    return false;
  end if;
  if v_role = 'admin' then
    return true;
  end if;

  select c.allowed_roles, c.group_id
    into v_ch_allowed, v_group_id
    from public.channels c
   where c.id = p_channel_id;

  if not found then
    return false;
  end if;

  -- Grouped channel: the group's permissions govern (override the channel's own).
  if v_group_id is not null then
    select allowed_roles into v_grp_allowed
      from public.channel_groups where id = v_group_id;
    return v_grp_allowed is null
        or cardinality(v_grp_allowed) = 0
        or v_role = any(v_grp_allowed);
  end if;

  -- Ungrouped channel: its own allowed_roles.
  return v_ch_allowed is null
      or cardinality(v_ch_allowed) = 0
      or v_role = any(v_ch_allowed);
end;
$$;

create or replace function public.is_channel_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- ── channels ────────────────────────────────────────────────────────────────
alter table public.channels enable row level security;

drop policy if exists "channels_select" on public.channels;
create policy "channels_select" on public.channels
  for select to authenticated
  using (public.can_view_channel(id));

drop policy if exists "channels_admin_insert" on public.channels;
create policy "channels_admin_insert" on public.channels
  for insert to authenticated
  with check (public.is_channel_admin());

drop policy if exists "channels_admin_update" on public.channels;
create policy "channels_admin_update" on public.channels
  for update to authenticated
  using (public.is_channel_admin())
  with check (public.is_channel_admin());

drop policy if exists "channels_admin_delete" on public.channels;
create policy "channels_admin_delete" on public.channels
  for delete to authenticated
  using (public.is_channel_admin());

-- ── channel_messages ────────────────────────────────────────────────────────
alter table public.channel_messages enable row level security;

drop policy if exists "channel_messages_select" on public.channel_messages;
create policy "channel_messages_select" on public.channel_messages
  for select to authenticated
  using (public.can_view_channel(channel_id));

drop policy if exists "channel_messages_insert" on public.channel_messages;
create policy "channel_messages_insert" on public.channel_messages
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_view_channel(channel_id));

-- Owner may edit their own message; admin may update any (used for pin).
drop policy if exists "channel_messages_update" on public.channel_messages;
create policy "channel_messages_update" on public.channel_messages
  for update to authenticated
  using ((user_id = auth.uid() or public.is_channel_admin()) and public.can_view_channel(channel_id))
  with check ((user_id = auth.uid() or public.is_channel_admin()) and public.can_view_channel(channel_id));

-- Owner or admin may delete (mirrors canDelete = isAdmin || isOwner).
drop policy if exists "channel_messages_delete" on public.channel_messages;
create policy "channel_messages_delete" on public.channel_messages
  for delete to authenticated
  using (user_id = auth.uid() or public.is_channel_admin());

-- ── channel_groups: tighten create/update from any-authenticated to admin ────
drop policy if exists "Authenticated can create channel groups" on public.channel_groups;
create policy "Admins can create channel groups" on public.channel_groups
  for insert to authenticated
  with check (public.is_channel_admin());

drop policy if exists "Authenticated can update channel groups" on public.channel_groups;
create policy "Admins can update channel groups" on public.channel_groups
  for update to authenticated
  using (public.is_channel_admin())
  with check (public.is_channel_admin());
-- (select-to-all and admin-delete policies from 20260702150000 are unchanged;
--  select stays open because group rows carry no message content and the client
--  already filters group visibility, while channel/message RLS above is what
--  actually gates access.)
