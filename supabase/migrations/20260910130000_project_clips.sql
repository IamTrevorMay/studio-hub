-- Clips: lightweight short_form sub-projects hanging off a long-form parent.
-- A clip is a normal projects row (type 'short_form') linked via parent_project_id,
-- so it rides the board / card-move / stage-task machinery unchanged.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS parent_project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_projects_parent_project_id
  ON projects(parent_project_id) WHERE parent_project_id IS NOT NULL;
