-- Link an idea to the project created from it (Ideas → Up Next → "Add
-- Project"). Null = no project yet; the button shows "In Production" while
-- set. ON DELETE SET NULL so deleting the project re-opens the idea.
ALTER TABLE write_ideas
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
