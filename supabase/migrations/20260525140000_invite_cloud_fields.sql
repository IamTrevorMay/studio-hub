alter table public.invitations
  add column if not exists cloud_user_id uuid,
  add column if not exists blocked_folders text[];
