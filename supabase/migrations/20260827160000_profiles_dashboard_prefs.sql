-- Per-user Dashboard section visibility, toggled from Settings.
--
-- Everything defaults to visible, so existing users see no change until they
-- turn something off. Read defensively in the UI (`!== false`) rather than
-- trusting the key to exist — a row written before a new section was added
-- won't carry its key.
--
-- Self-service: profiles_lock_admin_fields() is a blocklist (role, sub_role,
-- title, posting_allowed, drive folders), so a user can update this on their
-- own profile without any policy change.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dashboard_prefs jsonb
  NOT NULL DEFAULT '{"schedule": true, "sprint": true, "checkin": true, "todo": true}'::jsonb;

COMMENT ON COLUMN public.profiles.dashboard_prefs IS
  'Dashboard section visibility: schedule, sprint, checkin, todo. Missing key = visible.';
