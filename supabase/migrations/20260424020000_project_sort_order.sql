-- Add sort_order for kanban card positioning within columns.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
