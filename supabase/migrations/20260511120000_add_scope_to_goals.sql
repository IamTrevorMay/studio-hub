-- Add scope column to goals and monthly_goals tables
-- so BD goals can be separated from content goals.

ALTER TABLE goals ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'content';
ALTER TABLE monthly_goals ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'content';
