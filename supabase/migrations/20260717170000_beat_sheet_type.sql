-- Beat Sheets: add a fixed-taxonomy `type` column and stop grouping by the
-- dynamic beat_sheet_folders system. The list is now organized by Type in the
-- UI (Mayday / Trevor May Baseball / Podcast / Short Form / Ad Read), with an
-- "Unassigned" catch-all for NULL type.
--
-- `folder` is intentionally KEPT (not dropped) for safety / rollback; the UI
-- simply stops using it for grouping. Existing folder values that map cleanly
-- to a type are backfilled below.

alter table public.beat_sheets
  add column if not exists type text;

-- Backfill from the old folder values that map 1:1 to a type.
-- Everything else (ideas, custom folder ids, archive, NULL) stays NULL.
update public.beat_sheets
  set type = 'mayday'
  where folder = 'mayday' and type is null;

update public.beat_sheets
  set type = 'tm_baseball'
  where folder = 'tm_baseball' and type is null;

-- Guard the taxonomy at the DB level (NULL allowed = "Unassigned").
alter table public.beat_sheets
  drop constraint if exists beat_sheets_type_check;

alter table public.beat_sheets
  add constraint beat_sheets_type_check
  check (type is null or type in ('mayday', 'tm_baseball', 'podcast', 'short_form', 'ad_read'));
