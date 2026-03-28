-- Add 'backlog' to status, 'business_development' to category, switch priority to point system

ALTER TABLE personal_tasks DROP CONSTRAINT IF EXISTS personal_tasks_status_check;
ALTER TABLE personal_tasks DROP CONSTRAINT IF EXISTS personal_tasks_category_check;
ALTER TABLE personal_tasks DROP CONSTRAINT IF EXISTS personal_tasks_priority_check;

UPDATE personal_tasks SET priority = '1' WHERE priority = 'low';
UPDATE personal_tasks SET priority = '6' WHERE priority = 'medium';
UPDATE personal_tasks SET priority = '15' WHERE priority = 'high';

ALTER TABLE personal_tasks ADD CONSTRAINT personal_tasks_status_check
  CHECK (status = ANY (ARRAY['inbox', 'today', 'this_week', 'done', 'backlog']));

ALTER TABLE personal_tasks ADD CONSTRAINT personal_tasks_category_check
  CHECK (category = ANY (ARRAY['administration', 'communication', 'creative', 'production', 'business_development']));

ALTER TABLE personal_tasks ADD CONSTRAINT personal_tasks_priority_check
  CHECK (priority = ANY (ARRAY['1', '3', '6', '10', '15']));
