ALTER TABLE concepts ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- Backfill existing rows: newest first gets lowest sort_order (preserves current display order)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) - 1 AS rn
  FROM concepts
)
UPDATE concepts SET sort_order = ranked.rn
FROM ranked WHERE concepts.id = ranked.id;
