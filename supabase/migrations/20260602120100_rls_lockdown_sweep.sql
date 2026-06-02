-- HIGH RLS lockdown sweep. Five tables were open to all authed users for
-- writes (and in some cases reads of fields that should be admin-only).
-- Also adds WITH CHECK to two admin UPDATE policies on workflow_steps /
-- workflow_step_outcomes that were missing it (PostgreSQL accepts UPDATE
-- without WITH CHECK; the row passes the policy after mutation even if the
-- new value would have failed USING — so a row updated to a different
-- creator/id sneaks through).

-- ─── research_feeds: admin-only write, all authed read OK ────────────────
drop policy if exists "Authenticated users can insert feeds" on public.research_feeds;
drop policy if exists "Authenticated users can update feeds" on public.research_feeds;
drop policy if exists "Authenticated users can delete feeds" on public.research_feeds;

create policy "Admin insert research_feeds"
  on public.research_feeds for insert
  with check (public.is_admin(auth.uid()));

create policy "Admin update research_feeds"
  on public.research_feeds for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Admin delete research_feeds"
  on public.research_feeds for delete
  using (public.is_admin(auth.uid()));

-- ─── mayday_videos: admin-only write, all authed read OK ─────────────────
drop policy if exists "Authenticated users can insert mayday_videos" on public.mayday_videos;
drop policy if exists "Authenticated users can update mayday_videos" on public.mayday_videos;
drop policy if exists "Authenticated users can delete mayday_videos" on public.mayday_videos;

create policy "Admin insert mayday_videos"
  on public.mayday_videos for insert
  with check (public.is_admin(auth.uid()));

create policy "Admin update mayday_videos"
  on public.mayday_videos for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Admin delete mayday_videos"
  on public.mayday_videos for delete
  using (public.is_admin(auth.uid()));

-- ─── beat_sheet_folders: admin-only write ────────────────────────────────
drop policy if exists "Authenticated users can update folders" on public.beat_sheet_folders;
drop policy if exists "Authenticated users can delete folders" on public.beat_sheet_folders;
drop policy if exists "Authenticated users can insert folders" on public.beat_sheet_folders;

create policy "Admin insert beat_sheet_folders"
  on public.beat_sheet_folders for insert
  with check (public.is_admin(auth.uid()));

create policy "Admin update beat_sheet_folders"
  on public.beat_sheet_folders for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Admin delete beat_sheet_folders"
  on public.beat_sheet_folders for delete
  using (public.is_admin(auth.uid()));

-- ─── beat_sheet_templates: INSERT must set created_by = auth.uid() ──────
drop policy if exists "Authenticated users can insert templates" on public.beat_sheet_templates;
create policy "Authed insert beat_sheet_templates"
  on public.beat_sheet_templates for insert
  with check (
    auth.uid() is not null
    and created_by = auth.uid()
  );

-- ─── read_slot_limits: admin-only write ─────────────────────────────────
drop policy if exists "Authenticated users can insert slot limits" on public.read_slot_limits;
drop policy if exists "Authenticated users can update slot limits" on public.read_slot_limits;

create policy "Admin insert read_slot_limits"
  on public.read_slot_limits for insert
  with check (public.is_admin(auth.uid()));

create policy "Admin update read_slot_limits"
  on public.read_slot_limits for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Admin delete read_slot_limits"
  on public.read_slot_limits for delete
  using (public.is_admin(auth.uid()));

-- ─── workflow_steps + workflow_step_outcomes: add WITH CHECK to UPDATE ──
drop policy if exists "Admin update workflow_steps" on public.workflow_steps;
create policy "Admin update workflow_steps"
  on public.workflow_steps for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Admin update workflow_step_outcomes" on public.workflow_step_outcomes;
create policy "Admin update workflow_step_outcomes"
  on public.workflow_step_outcomes for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
