-- Progress cards: manual priority ordering within Editing/Ready columns.
-- Admins drag to reorder; position 0 = top priority (#1). The sync-progress-cards
-- edge function keeps Drive filenames numbered to match (N. <title>) and
-- self-heals contiguous positions every run.

alter table public.progress_cards
  add column if not exists position integer not null default 0;

-- Backfill: per status, oldest first = #1 (position 0).
with ranked as (
  select
    id,
    row_number() over (partition by status order by created_at asc, id asc) - 1 as pos
  from public.progress_cards
  where archived_at is null
)
update public.progress_cards p
set position = r.pos
from ranked r
where p.id = r.id;

create index if not exists progress_cards_status_position_idx
  on public.progress_cards (status, position);
