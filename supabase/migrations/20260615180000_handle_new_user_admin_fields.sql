-- Update handle_new_user to also set title and drive folder fields from
-- invite metadata, so these admin-controlled columns are written server-side
-- (SECURITY DEFINER) instead of via client-side profile update.
-- Fixes: freelancer setup failing with "title is admin-only" from the
-- profiles_lock_admin_fields trigger.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, nickname, email, role, title, assigned_drive_folder_id, assigned_drive_folder_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'nickname', ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'member'),
    NULLIF(NEW.raw_user_meta_data->>'title', ''),
    NULLIF(NEW.raw_user_meta_data->>'assigned_drive_folder_id', ''),
    NULLIF(NEW.raw_user_meta_data->>'assigned_drive_folder_name', '')
  )
  ON CONFLICT (id) DO UPDATE
    SET email    = EXCLUDED.email,
        nickname = COALESCE(EXCLUDED.nickname, public.profiles.nickname),
        title    = COALESCE(EXCLUDED.title, public.profiles.title),
        assigned_drive_folder_id   = COALESCE(EXCLUDED.assigned_drive_folder_id, public.profiles.assigned_drive_folder_id),
        assigned_drive_folder_name = COALESCE(EXCLUDED.assigned_drive_folder_name, public.profiles.assigned_drive_folder_name);
  RETURN NEW;
END;
$$;
