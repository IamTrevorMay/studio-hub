-- Daily Briefing feature: per-account prefs + last-shown gate on profiles.
-- Additive + nullable/defaulted, so existing rows and `select('*')` are unaffected.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS daily_briefing_prefs jsonb NOT NULL
    DEFAULT '{"enabled": false, "around_baseball": true, "upcoming_day": true}'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS daily_briefing_last_shown date;

COMMENT ON COLUMN public.profiles.daily_briefing_prefs IS
  'Daily Briefing modal prefs: {enabled, around_baseball, upcoming_day}.';
COMMENT ON COLUMN public.profiles.daily_briefing_last_shown IS
  'Local date the Daily Briefing modal was last auto-shown, to gate once/day.';
