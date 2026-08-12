-- Admin Panel → Team → user detail drawer.
--
-- Adds the two things the drawer needs that didn't exist for staff accounts:
-- a phone number, and admin-only notes. Contractors and clients already have
-- both on their own profile tables (contractor_profiles / client_profiles) and
-- those stay the source of truth for them — the drawer reads whichever store
-- the person's role uses, so nothing drifts from the Contractors/Clients pages.

-- ── Phone for staff accounts ───────────────────────────────────────
alter table public.profiles
  add column if not exists phone text;

comment on column public.profiles.phone is
  'Contact number for staff accounts. Contractors/clients keep theirs on contractor_profiles/client_profiles.';

-- ── Admin-only notes ───────────────────────────────────────────────
-- A separate table, not a profiles column: profiles is SELECT-able by every
-- authenticated user ("Profiles are viewable by authenticated users"), so a
-- column there could not be hidden from the person it's about.
create table if not exists public.profile_admin_notes (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  notes       text,
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.profile_admin_notes is
  'Admin-only notes about a staff member. Never exposed to the subject.';

alter table public.profile_admin_notes enable row level security;

drop policy if exists "Admins manage profile notes" on public.profile_admin_notes;
create policy "Admins manage profile notes"
  on public.profile_admin_notes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── Avatars: let an admin manage someone else's picture ────────────
-- The existing policies are own-folder only (foldername[1] = auth.uid()), so
-- an admin setting a teammate's photo would be rejected.
drop policy if exists "Admins can upload any avatar" on storage.objects;
create policy "Admins can upload any avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_admin());

drop policy if exists "Admins can update any avatar" on storage.objects;
create policy "Admins can update any avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and public.is_admin());

drop policy if exists "Admins can delete any avatar" on storage.objects;
create policy "Admins can delete any avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.is_admin());
