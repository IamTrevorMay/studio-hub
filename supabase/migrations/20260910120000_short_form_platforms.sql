-- Platforms a short_form project will be published to (Facebook, Instagram,
-- Twitter, TikTok). Multi-select; empty array for non-short_form projects.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS short_form_platforms TEXT[] NOT NULL DEFAULT '{}';
