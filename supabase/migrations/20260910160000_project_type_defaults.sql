-- Configurable default stage assignees per project type (was hardcoded in
-- src/lib/kanbanStages.js TYPE_DEFAULT_ASSIGNEES). One row per type;
-- `assignees` is { stage: [profile ids] }. Read by the project-creation flows
-- (any staff can create), written from the Projects board's ⚙ modal (admins).
CREATE TABLE IF NOT EXISTS project_type_defaults (
  type TEXT PRIMARY KEY CHECK (type IN ('mayday_video', 'tm_baseball_video', 'podcast', 'short_form')),
  assignees JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_type_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "type defaults staff read" ON project_type_defaults;
CREATE POLICY "type defaults staff read" ON project_type_defaults
  FOR SELECT USING (is_staff(auth.uid()));

DROP POLICY IF EXISTS "type defaults admin write" ON project_type_defaults;
CREATE POLICY "type defaults admin write" ON project_type_defaults
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Seed with the previously hardcoded values so behavior doesn't change.
INSERT INTO project_type_defaults (type, assignees) VALUES
  ('mayday_video', '{
    "write": ["aff29906-eda8-4c3f-8a1e-a550b5bbe45d"],
    "pre_production": ["c3290048-436b-46c6-b3f0-fdf7923d0c3b", "7b1e50e0-cede-409d-a160-1aa6d1e232a9", "ed7541f9-213d-4868-9147-5e638cbb6883"],
    "film": ["c3290048-436b-46c6-b3f0-fdf7923d0c3b"],
    "edit": ["dc5d43c8-60e2-4721-8b81-aed9aa12aab6"],
    "post_production": ["c3290048-436b-46c6-b3f0-fdf7923d0c3b"]
  }'::jsonb),
  ('tm_baseball_video', '{
    "write": ["7b1e50e0-cede-409d-a160-1aa6d1e232a9", "c3290048-436b-46c6-b3f0-fdf7923d0c3b", "ed7541f9-213d-4868-9147-5e638cbb6883"],
    "pre_production": ["7b1e50e0-cede-409d-a160-1aa6d1e232a9", "c3290048-436b-46c6-b3f0-fdf7923d0c3b", "ed7541f9-213d-4868-9147-5e638cbb6883"],
    "film": ["c3290048-436b-46c6-b3f0-fdf7923d0c3b"],
    "review": ["c3290048-436b-46c6-b3f0-fdf7923d0c3b"],
    "edit": ["219a0098-6530-49a2-98d0-edb59b8ed39a"],
    "post_production": ["c3290048-436b-46c6-b3f0-fdf7923d0c3b"]
  }'::jsonb),
  ('podcast', '{}'::jsonb),
  ('short_form', '{}'::jsonb)
  ON CONFLICT (type) DO NOTHING;
