-- 1. Remove duplicate project_stage_assignments, keeping the oldest row
DELETE FROM public.project_stage_assignments
WHERE id NOT IN (
  SELECT DISTINCT ON (project_id, stage, user_id) id
  FROM public.project_stage_assignments
  ORDER BY project_id, stage, user_id, created_at ASC
);

-- 2. Add unique constraint so duplicates can't be created again
ALTER TABLE public.project_stage_assignments
  ADD CONSTRAINT project_stage_assignments_unique_assignment
  UNIQUE (project_id, stage, user_id);

-- 3. Remove duplicate personal_tasks sprint cards for the same project+user,
--    keeping the oldest card
DELETE FROM public.personal_tasks
WHERE id NOT IN (
  SELECT DISTINCT ON (project_id, created_by) id
  FROM public.personal_tasks
  WHERE project_id IS NOT NULL
  ORDER BY project_id, created_by, created_at ASC
)
AND project_id IS NOT NULL;

-- 4. Remove orphaned tasks rows that were linked to the deleted sprint cards
--    (tasks created by card-move that no longer have a personal_tasks card)
DELETE FROM public.tasks
WHERE id IN (
  SELECT t.id
  FROM public.tasks t
  LEFT JOIN public.personal_tasks pt ON pt.task_id = t.id
  WHERE t.related_entity_type = 'project'
    AND t.status = 'active'
    AND pt.id IS NULL
    AND t.id NOT IN (SELECT task_id FROM public.personal_tasks WHERE task_id IS NOT NULL)
);
