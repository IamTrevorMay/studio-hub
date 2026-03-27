-- Add sort_order to concept_documents
ALTER TABLE concept_documents ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- Backfill concept_documents sort_order by created_at ASC
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY concept_id ORDER BY created_at ASC) - 1 AS rn
  FROM concept_documents
)
UPDATE concept_documents SET sort_order = ranked.rn
FROM ranked WHERE concept_documents.id = ranked.id;

-- Add sort_order to show_documents
ALTER TABLE show_documents ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- Backfill show_documents sort_order by created_at ASC
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY show_id ORDER BY created_at ASC) - 1 AS rn
  FROM show_documents
)
UPDATE show_documents SET sort_order = ranked.rn
FROM ranked WHERE show_documents.id = ranked.id;

-- Add category to concepts
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS category text DEFAULT 'other';
