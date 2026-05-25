-- Add payment_type and rate to invitations table
alter table public.invitations
  add column if not exists payment_type text check (payment_type in ('hourly', 'project')),
  add column if not exists rate numeric(10,2);

-- Add contract storage fields to invitations (for pre-upload before user exists)
alter table public.invitations
  add column if not exists contract_storage_path text,
  add column if not exists contract_file_name text;

-- Add payment_type and rate to freelancer_profiles
-- These are set at invite time and read-only to the contractor
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'freelancer_profiles') then
    alter table public.freelancer_profiles
      add column if not exists payment_type text check (payment_type in ('hourly', 'project')),
      add column if not exists rate numeric(10,2);
    alter table public.freelancer_profiles
      drop constraint if exists freelancer_profiles_specialty_check;
  end if;
end $$;

-- Create avatars storage bucket (public)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone authenticated can upload their own avatar (path = user_id/*)
create policy "Users can upload own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Anyone can read avatars (public bucket)
create policy "Avatars are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

-- Users can update their own avatar
create policy "Users can update own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Users can delete their own avatar
create policy "Users can delete own avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
