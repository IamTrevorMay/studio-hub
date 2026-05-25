-- Store assigned Drive folder on invitations (set at invite time)
alter table public.invitations
  add column if not exists assigned_drive_folder_id text,
  add column if not exists assigned_drive_folder_name text;

-- Store assigned Drive folder on profiles (copied at invite accept)
alter table public.profiles
  add column if not exists assigned_drive_folder_id text,
  add column if not exists assigned_drive_folder_name text;
