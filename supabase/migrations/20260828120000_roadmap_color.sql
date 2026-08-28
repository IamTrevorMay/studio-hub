-- ============================================================
-- Roadmap color coordination
-- Each roadmap carries a palette key so its card, milestones,
-- tasks and calendar pills all read as one color family.
-- Keys map to src/pages/BusinessDev.js ROADMAP_COLORS.
-- ============================================================

alter table public.roadmaps
  add column if not exists color text;

-- Backfill existing rows by position so nobody starts uncolored.
with ordered as (
  select id, row_number() over (order by position, created_at) - 1 as idx
  from public.roadmaps
  where color is null
)
update public.roadmaps r
set color = (array['steel','violet','emerald','amber','red','sky','pink','green'])[(o.idx % 8) + 1]
from ordered o
where r.id = o.id;
