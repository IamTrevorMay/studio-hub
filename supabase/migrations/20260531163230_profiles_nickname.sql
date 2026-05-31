-- Two-name model for profiles.
--   full_name (existing) = legal name, surfaces in admin pages
--                          (Payroll, Assignments, Workflows, etc.)
--   nickname  (new)      = social/communication display, surfaces in
--                          chat, DMs, post bylines, notifications.
--
-- Display resolution lives in src/lib/displayName.js:
--   getDisplayName(profile) = nickname || first_word_of(full_name).
-- Admin pages keep reading profile.full_name directly.
--
-- handle_new_user is updated so future invitees can carry both names
-- through raw_user_meta_data ({ full_name, nickname }).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nickname text;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, nickname, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'nickname', ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'member')
  )
  ON CONFLICT (id) DO UPDATE
    SET email    = EXCLUDED.email,
        nickname = COALESCE(EXCLUDED.nickname, public.profiles.nickname);
  RETURN NEW;
END;
$$;
