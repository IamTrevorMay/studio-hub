-- Brand tag on research doc templates. Drives the gallery card color:
-- Mayday = red, Trevor May Baseball = orange. Values mirror the beat_sheets
-- folder keys so the two systems stay in the same vocabulary.
alter table public.research_doc_templates
  add column tag text not null default 'mayday'
  check (tag in ('mayday', 'tm_baseball'));
