-- ============================================================
-- Partner role: add assigned_partners to bd_phases and
-- split RLS policies so partners get read-only access
-- ============================================================

-- 1. Add assigned_partners column to bd_phases
alter table bd_phases add column assigned_partners uuid[] default '{}';

-- 2. Helper: is the user an admin or an assigned partner?
create or replace function public.is_bd_viewer(uid uuid)
returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from profiles where id = uid and role = 'admin'
  ) or exists (
    select 1 from bd_phases where uid = any(assigned_partners) and archived_at is null
  );
$$;

grant execute on function public.is_bd_viewer(uuid) to authenticated;

-- ============================================================
-- 3. Replace "FOR ALL" policies with split SELECT / INSERT /
--    UPDATE / DELETE so partners get read-only access
-- ============================================================

-- ── bd_phases ────────────────────────────────────────────────
drop policy if exists "bd_phases admin all" on bd_phases;

create policy "bd_phases read" on bd_phases
  for select to authenticated
  using (public.is_admin(auth.uid()) or auth.uid() = any(assigned_partners));

create policy "bd_phases insert" on bd_phases
  for insert to authenticated
  with check (public.is_admin(auth.uid()));

create policy "bd_phases update" on bd_phases
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "bd_phases delete" on bd_phases
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- ── bd_initiatives ───────────────────────────────────────────
drop policy if exists "bd_initiatives admin all" on bd_initiatives;

create policy "bd_initiatives read" on bd_initiatives
  for select to authenticated
  using (
    public.is_admin(auth.uid()) or exists (
      select 1 from bd_phases where id = bd_initiatives.phase_id and auth.uid() = any(assigned_partners)
    )
  );

create policy "bd_initiatives insert" on bd_initiatives
  for insert to authenticated
  with check (public.is_admin(auth.uid()));

create policy "bd_initiatives update" on bd_initiatives
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "bd_initiatives delete" on bd_initiatives
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- ── bd_initiative_links ──────────────────────────────────────
drop policy if exists "bd_initiative_links admin all" on bd_initiative_links;

create policy "bd_initiative_links read" on bd_initiative_links
  for select to authenticated
  using (
    public.is_admin(auth.uid()) or exists (
      select 1 from bd_initiatives i
        join bd_phases p on p.id = i.phase_id
      where i.id = bd_initiative_links.initiative_id
        and auth.uid() = any(p.assigned_partners)
    )
  );

create policy "bd_initiative_links insert" on bd_initiative_links
  for insert to authenticated
  with check (public.is_admin(auth.uid()));

create policy "bd_initiative_links update" on bd_initiative_links
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "bd_initiative_links delete" on bd_initiative_links
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- ── bd_tasks ─────────────────────────────────────────────────
drop policy if exists "bd_tasks admin all" on bd_tasks;

create policy "bd_tasks read" on bd_tasks
  for select to authenticated
  using (
    public.is_admin(auth.uid()) or exists (
      select 1 from bd_initiatives i
        join bd_phases p on p.id = i.phase_id
      where i.id = bd_tasks.initiative_id
        and auth.uid() = any(p.assigned_partners)
    )
  );

create policy "bd_tasks insert" on bd_tasks
  for insert to authenticated
  with check (public.is_admin(auth.uid()));

create policy "bd_tasks update" on bd_tasks
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "bd_tasks delete" on bd_tasks
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- ── bd_milestones ────────────────────────────────────────────
drop policy if exists "bd_milestones admin all" on bd_milestones;

create policy "bd_milestones read" on bd_milestones
  for select to authenticated
  using (
    public.is_admin(auth.uid()) or exists (
      select 1 from bd_phases where id = bd_milestones.phase_id and auth.uid() = any(assigned_partners)
    )
  );

create policy "bd_milestones insert" on bd_milestones
  for insert to authenticated
  with check (public.is_admin(auth.uid()));

create policy "bd_milestones update" on bd_milestones
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "bd_milestones delete" on bd_milestones
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- bd_settings stays admin-only (no change needed)
