-- Beat Sheets: three manual sections + multi-select tags.
--
-- The landing page used to group by the fixed `type` taxonomy (Mayday / TM
-- Baseball / Podcast / Short Form / Ad Read) with an Archive section at the
-- bottom. It now works like the Ideas board: a table with three
-- hand-curated sections and tags in their own column.
--
-- Sections are Active / Backlog / Completed, but only TWO of them need a
-- column:
--
--   Completed  ==  is_archived = true
--   Active / Backlog  ==  the new `section` column
--
-- Completed deliberately maps onto the existing flag rather than becoming an
-- independent third value, because `is_archived` is already load-bearing
-- outside this page — Deliverables, Timeline, ProductionMobile, UnifiedBoard
-- and WriteAdReadModal all hide archived sheets from their pickers. Keeping
-- one source of truth means "completed" keeps that behaviour instead of
-- silently diverging from it.
--
-- `type` is intentionally KEPT, not dropped, matching the precedent set when
-- `folder` was superseded by `type` in 20260717170000. It stops driving the
-- UI; tag_ids replaces it.

-- ── Tags ──────────────────────────────────────────────────────
-- Mirrors public.idea_tags in shape so both boards behave the same way:
-- custom labels, per-tag colour, manual order.
create table if not exists public.beat_sheet_tags (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique,
  color      text not null default '#8fb4d8',
  position   integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.beat_sheet_tags enable row level security;

-- Same openness as beat_sheets itself, which is authenticated-wide.
drop policy if exists "beat_sheet_tags: select all authenticated" on public.beat_sheet_tags;
create policy "beat_sheet_tags: select all authenticated"
  on public.beat_sheet_tags for select
  using (auth.role() = 'authenticated');

drop policy if exists "beat_sheet_tags: insert all authenticated" on public.beat_sheet_tags;
create policy "beat_sheet_tags: insert all authenticated"
  on public.beat_sheet_tags for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "beat_sheet_tags: update all authenticated" on public.beat_sheet_tags;
create policy "beat_sheet_tags: update all authenticated"
  on public.beat_sheet_tags for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "beat_sheet_tags: delete all authenticated" on public.beat_sheet_tags;
create policy "beat_sheet_tags: delete all authenticated"
  on public.beat_sheet_tags for delete
  using (auth.role() = 'authenticated');

-- Seed the five former sections, keeping the exact hues the section titles
-- used (BEAT_SHEET_TYPE_COLORS in src/pages/Production.js) so nothing
-- visibly changes colour on the way over.
insert into public.beat_sheet_tags (label, color, position) values
  ('Mayday',              '#f87171', 0),
  ('Trevor May Baseball', '#34d399', 1),
  ('Podcast',             '#c084fc', 2),
  ('Short Form',          '#fbbf24', 3),
  ('Ad Read',             '#38bdf8', 4)
on conflict (label) do nothing;

-- ── Columns ───────────────────────────────────────────────────
alter table public.beat_sheets
  add column if not exists tag_ids  uuid[]  not null default '{}',
  add column if not exists section  text    not null default 'backlog',
  add column if not exists position integer not null default 0;

-- Only two values: Completed is is_archived, not a section value. An archived
-- row keeps whatever section it had, which is harmless — un-completing sets
-- it to 'backlog' explicitly rather than restoring it.
alter table public.beat_sheets
  drop constraint if exists beat_sheets_section_check;

alter table public.beat_sheets
  add constraint beat_sheets_section_check
  check (section in ('active', 'backlog'));

comment on column public.beat_sheets.section is
  'Active/Backlog placement on the Beat Sheets page. Completed is is_archived=true, not a value here.';

-- ── Backfill ──────────────────────────────────────────────────
-- Each sheet starts tagged with its former type. Sheets with no type (33 of
-- them) stay untagged rather than being guessed into a tag.
update public.beat_sheets b
set tag_ids = array[t.id]
from public.beat_sheet_tags t
where cardinality(b.tag_ids) = 0
  and t.label = case b.type
    when 'mayday'      then 'Mayday'
    when 'tm_baseball' then 'Trevor May Baseball'
    when 'podcast'     then 'Podcast'
    when 'short_form'  then 'Short Form'
    when 'ad_read'     then 'Ad Read'
  end;

-- "Archive is Completed, everything else is in backlog" — the column default
-- already puts every row in 'backlog', so there is nothing to move. Active
-- starts empty by design and gets filled by dragging.

-- Seed a manual order per section from most-recently-updated, so the first
-- render is sensible before anyone drags anything.
with ordered as (
  select id,
         row_number() over (
           partition by (case when is_archived then 'completed' else section end)
           order by updated_at desc nulls last, created_at desc
         ) - 1 as rn
  from public.beat_sheets
)
update public.beat_sheets b
set position = o.rn
from ordered o
where b.id = o.id;

create index if not exists beat_sheets_section_position_idx
  on public.beat_sheets (section, position);

create index if not exists beat_sheets_archived_position_idx
  on public.beat_sheets (is_archived, position);
