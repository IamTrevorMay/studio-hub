-- Beat Sheets "Find Assets" feature: per-sheet asset-suggestion review state.
-- Stored on its own column (NOT inside the `beats` blob) so it is never
-- rendered on the sheet or included when the sheet is pushed to Drive.
--
-- Shape (flat map, one entry per searched tag):
--   { "<beatId>::<field>::<tag>": {
--       "status": "pending"|"confirmed"|"denied"|"reroll",
--       "suggestion": { id, name, type, source, proxy_id, url, thumbnail } | null,
--       "shownIds": ["<assetId>", ...],   -- already offered, don't repeat
--       "deniedIds": ["<assetId>", ...]   -- denied, never suggest again
--   } }
--   field is "videos" (B-Roll), "graphics" (Images), or "notes" (audio/SFX/VFX,
--   split on commas). source is "shade" (Assets DB) or "pitch" (Pitch Videos).
alter table public.beat_sheets
  add column if not exists asset_review jsonb not null default '{}'::jsonb;
