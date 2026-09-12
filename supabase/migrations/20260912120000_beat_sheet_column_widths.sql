-- Beat sheet grid: per-sheet column widths.
--
-- The beat sheet editor became a resizable grid (Beat | Graphics | Videos |
-- Notes). Beat absorbs the leftover space, so only the three right-hand
-- columns carry an explicit pixel width. Stored per sheet rather than per user
-- so the layout travels with the document between machines.
alter table public.beat_sheets
  add column if not exists column_widths jsonb;

comment on column public.beat_sheets.column_widths is
  'Grid column widths in px, e.g. {"graphics":200,"videos":200,"notes":260}. Null = defaults. The Beat column is fluid and has no stored width.';
