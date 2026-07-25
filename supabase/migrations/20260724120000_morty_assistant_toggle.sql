-- Morty Chat assistant: per-user toggle, independent of the mascot toggle.
-- null/true = enabled (matches the `mascot_enabled !== false` convention).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS assistant_enabled boolean;
