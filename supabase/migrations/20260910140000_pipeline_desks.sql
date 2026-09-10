-- Pipeline desks refactor: publish stamps + bucket goals.

-- When a project actually reached Published. Stamped by card-move on entering
-- publish (first time only); backfilled from updated_at for rows already there.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

UPDATE projects
  SET published_at = updated_at
  WHERE status = 'publish' AND published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_published_at
  ON projects(published_at) WHERE published_at IS NOT NULL;

-- Per-bucket output goals for the Pipeline view. Buckets are fixed keys:
-- yt_long | yt_short | instagram | tiktok | facebook.
CREATE TABLE IF NOT EXISTS pipeline_goals (
  bucket TEXT PRIMARY KEY CHECK (bucket IN ('yt_long', 'yt_short', 'instagram', 'tiktok', 'facebook')),
  goal INT NOT NULL DEFAULT 0 CHECK (goal >= 0 AND goal <= 99),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row global settings: the counting window shared by every bucket.
CREATE TABLE IF NOT EXISTS pipeline_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  period TEXT NOT NULL DEFAULT 'weekly' CHECK (period IN ('weekly', 'monthly')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO pipeline_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO pipeline_goals (bucket) VALUES
  ('yt_long'), ('yt_short'), ('instagram'), ('tiktok'), ('facebook')
  ON CONFLICT (bucket) DO NOTHING;

ALTER TABLE pipeline_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_settings ENABLE ROW LEVEL SECURITY;

-- Pipeline view is admin-tier only; so are its goals.
DROP POLICY IF EXISTS "pipeline_goals admin all" ON pipeline_goals;
CREATE POLICY "pipeline_goals admin all" ON pipeline_goals
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "pipeline_settings admin all" ON pipeline_settings;
CREATE POLICY "pipeline_settings admin all" ON pipeline_settings
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
