-- Add folder column to beat_sheets for grouping into named sections.
-- Values: 'mayday', 'tm_baseball', 'ideas', or NULL (unfiled).

ALTER TABLE beat_sheets ADD COLUMN IF NOT EXISTS folder TEXT;
