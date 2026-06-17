ALTER TABLE personal_tasks DROP CONSTRAINT IF EXISTS personal_tasks_category_check;
ALTER TABLE personal_tasks ADD CONSTRAINT personal_tasks_category_check
  CHECK (category = ANY (ARRAY['administration', 'communication', 'creative', 'production', 'business_development', 'software', 'ad', 'social']));
