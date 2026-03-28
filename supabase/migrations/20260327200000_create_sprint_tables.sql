-- Sprint tables for personal agile planning

-- Sprints
CREATE TABLE sprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  velocity integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Only one active sprint per user
CREATE UNIQUE INDEX one_active_sprint_per_user ON sprints (user_id) WHERE status = 'active';
-- Prevent duplicate sprints for the same week
CREATE UNIQUE INDEX unique_sprint_per_user_week ON sprints (user_id, start_date);

ALTER TABLE sprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sprints" ON sprints
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Sprint Goals (1-3 per sprint)
CREATE TABLE sprint_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id uuid NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  text text NOT NULL,
  is_complete boolean DEFAULT false,
  position integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sprint_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sprint goals" ON sprint_goals
  FOR ALL USING (EXISTS (SELECT 1 FROM sprints WHERE sprints.id = sprint_goals.sprint_id AND sprints.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM sprints WHERE sprints.id = sprint_goals.sprint_id AND sprints.user_id = auth.uid()));

-- Sprint Retrospectives (one per sprint)
CREATE TABLE sprint_retros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id uuid NOT NULL UNIQUE REFERENCES sprints(id) ON DELETE CASCADE,
  went_well text DEFAULT '',
  to_improve text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE sprint_retros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sprint retros" ON sprint_retros
  FOR ALL USING (EXISTS (SELECT 1 FROM sprints WHERE sprints.id = sprint_retros.sprint_id AND sprints.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM sprints WHERE sprints.id = sprint_retros.sprint_id AND sprints.user_id = auth.uid()));

-- Add sprint_id to personal_tasks
ALTER TABLE personal_tasks ADD COLUMN IF NOT EXISTS sprint_id uuid REFERENCES sprints(id) ON DELETE SET NULL;
