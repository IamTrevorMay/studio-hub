-- Channel groups: admins can organize channels into groups and set group-level
-- permissions that override each member channel's individual permissions.

create table if not exists public.channel_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer default 0,
  allowed_roles text[],            -- null/empty = open to everyone (same convention as channels)
  created_by uuid,
  created_at timestamptz default now()
);

-- A channel may belong to at most one group. Deleting a group ungroups its
-- channels rather than deleting them.
alter table public.channels
  add column if not exists group_id uuid references public.channel_groups(id) on delete set null;

alter table public.channel_groups enable row level security;

-- Mirror the channels RLS model: everyone reads (visibility is enforced in the
-- client the same way channels are), anyone authenticated can create/update,
-- only admins can delete.
drop policy if exists "Channel groups viewable by authenticated" on public.channel_groups;
create policy "Channel groups viewable by authenticated"
  on public.channel_groups for select to authenticated using (true);

drop policy if exists "Authenticated can create channel groups" on public.channel_groups;
create policy "Authenticated can create channel groups"
  on public.channel_groups for insert to authenticated with check (true);

drop policy if exists "Authenticated can update channel groups" on public.channel_groups;
create policy "Authenticated can update channel groups"
  on public.channel_groups for update to authenticated using (true) with check (true);

drop policy if exists "Admins can delete channel groups" on public.channel_groups;
create policy "Admins can delete channel groups"
  on public.channel_groups for delete to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
