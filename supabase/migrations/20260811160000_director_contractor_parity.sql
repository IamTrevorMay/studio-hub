-- Directors get full parity with admins across Contractor Mode.
--
-- These policies predate the 2026-07-29 role restructure, so they still test
-- `role = 'admin'` literally instead of calling is_admin() (which is
-- admin + director). That left directors able to open Contractor Mode — the
-- page gates on the admin-tier `isAdmin` — but unable to upload a contractor
-- document, edit a contractor's profile, or see pending invites.
--
-- Everything here moves to is_admin(). The one thing directors still cannot
-- do is touch admin-tier accounts or hand out admin-tier roles: that would
-- let a director promote themselves, so it stays strict-admin via the new
-- is_strict_admin() helper.

create or replace function public.is_strict_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

grant execute on function public.is_strict_admin() to authenticated;

-- ─── Contractor documents (upload / view / delete) ───────────────────
drop policy if exists "Admins full access on freelancer_documents" on public.contractor_documents;
create policy "Admins full access on freelancer_documents" on public.contractor_documents
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ─── The document files themselves ───────────────────────────────────
drop policy if exists "Admins upload freelancer docs" on storage.objects;
create policy "Admins upload freelancer docs" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'freelancer-documents' and is_admin());

drop policy if exists "Admins delete freelancer docs" on storage.objects;
create policy "Admins delete freelancer docs" on storage.objects
  for delete to authenticated
  using (bucket_id = 'freelancer-documents' and is_admin());

-- Contractors keep read access to their own folder.
drop policy if exists "Read freelancer docs" on storage.objects;
create policy "Read freelancer docs" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'freelancer-documents'
    and (is_admin() or auth.uid()::text = (storage.foldername(name))[1])
  );

-- ─── Invitations (pending list on the Team tab + revoke) ─────────────
drop policy if exists "Admins can view invitations" on public.invitations;
create policy "Admins can view invitations" on public.invitations
  for select to authenticated
  using (is_admin());

drop policy if exists "Admins can create invitations" on public.invitations;
create policy "Admins can create invitations" on public.invitations
  for insert to authenticated
  with check (is_admin());

drop policy if exists "Admins can delete invitations" on public.invitations;
create policy "Admins can delete invitations" on public.invitations
  for delete to authenticated
  using (is_admin());

-- ─── Profiles (Team tab edits name / sub-role / Drive folder) ────────
--
-- USING keeps a director out of admin-tier rows; WITH CHECK stops them
-- writing an admin-tier role onto anyone. Together those close the
-- promote-yourself path while leaving contractor and client rows editable.
-- Self-service updates run through the separate own-profile policy.
drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile" on public.profiles
  for update to authenticated
  using (
    is_strict_admin()
    or (is_admin() and role not in ('admin', 'director', 'director_creative', 'director_comms'))
  )
  with check (
    is_strict_admin()
    or (is_admin() and role not in ('admin', 'director', 'director_creative', 'director_comms'))
  );

drop policy if exists "Admins can delete profiles" on public.profiles;
create policy "Admins can delete profiles" on public.profiles
  for delete to authenticated
  using (
    is_strict_admin()
    or (is_admin() and role not in ('admin', 'director', 'director_creative', 'director_comms'))
  );
