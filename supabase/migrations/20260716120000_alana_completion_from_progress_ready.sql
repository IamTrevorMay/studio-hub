-- Fix Alana's payroll under-counting (Bug B) — drive completion off the
-- Progress pipeline's own record, not a mutable filename.
--
-- Old path: drive_event_to_assignment() fired only on event_type='added'
-- (poller heuristic createdTime>last_seen). Videos EDITED elsewhere and moved
-- into the Ready folder (= Watch 1) keep their old createdTime, get stamped
-- 'modified', and were dropped — no completed assignment, no pay. Only 7 of 18
-- July 1-14 videos counted. Keying on the "(E)" tag is no better: the tag is
-- transient (the numbering step stripped it) and mostly absent from history.
--
-- New path: a progress_card that reaches the Ready column has a
-- ready_drive_file_id (its finished file living in Watch 1). That is the
-- reliable "delivered" signal. One completed assignment per ready file, dedup
-- on the Drive file id so re-runs / renames / re-archival never double-pay.
--
-- Decisions (Trevor, 2026-07-16): signal = reached Ready column; completed_at =
-- when it became ready; backfill = delivered videos since 2026-07-01 only.

-- ── 1. "Became ready" timestamp on the card ────────────────────────
alter table public.progress_cards
  add column if not exists ready_at timestamptz;

-- Backfill ready_at for cards already delivered: first time the ready file was
-- seen in Watch 1 (precise), else the scheduled/updated time.
update public.progress_cards c
set ready_at = coalesce(
  (select min(coalesce(e.created_time, e.created_at))
     from public.drive_events e
    where e.drive_file_id = c.ready_drive_file_id
      and e.parent_folder_id = '1vaG8mZiQX1bb6S8tCs7-9BQzr7i3eeWU'),
  c.moved_to_scheduled_at, c.updated_at, c.created_at)
where c.ready_drive_file_id is not null
  and c.ready_at is null;

-- ── 2. Per-file dedup key on assignments ───────────────────────────
alter table public.freelancer_assignments
  add column if not exists source_drive_file_id text;

-- Backfill the key on the 37 existing rows from their originating drive_event,
-- so the unique index and the new path both recognise already-paid files.
update public.freelancer_assignments a
set source_drive_file_id = e.drive_file_id
from public.drive_events e
where a.source_drive_event_id = e.id
  and a.source_drive_file_id is null;

-- Plain (non-partial) unique index: NULLs are distinct in Postgres so legacy
-- rows without a Drive file id coexist, and ON CONFLICT (source_drive_file_id)
-- can infer this index (a partial index can't be inferred here).
create unique index if not exists freelancer_assignments_drive_file_uniq
  on public.freelancer_assignments (source_drive_file_id);

-- ── 3. Stamp ready_at when a card first reaches Ready ──────────────
create or replace function public.progress_card_stamp_ready_at()
returns trigger
language plpgsql
as $$
begin
  if NEW.ready_drive_file_id is not null and NEW.ready_at is null then
    NEW.ready_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_progress_card_stamp_ready_at on public.progress_cards;
create trigger trg_progress_card_stamp_ready_at
  before insert or update on public.progress_cards
  for each row execute function public.progress_card_stamp_ready_at();

-- ── 4. Create Alana's completed assignment on delivery ─────────────
create or replace function public.progress_card_to_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- All Progress videos are Alana Benson's work (single video editor; the
  -- Ready folder == payroll Watch 1). Revisit if a second editor is added.
  v_profile_id constant uuid := '6fa98f97-1555-4a73-bfc7-09ff468c94be';
  v_rate numeric;
begin
  -- Only once the card has reached Ready (finished file in Watch 1).
  if NEW.ready_drive_file_id is null then
    return NEW;
  end if;

  select fp.rate into v_rate
  from public.freelancer_profiles fp
  where fp.id = v_profile_id;

  insert into public.freelancer_assignments
    (freelancer_id, title, assignment_type, status, pay_amount,
     completed_at, source_drive_file_id)
  values
    (v_profile_id,
     coalesce(NEW.title, 'Untitled'),
     'edit',
     'completed',
     coalesce(v_rate, 0),
     coalesce(NEW.ready_at, now()),
     NEW.ready_drive_file_id)
  on conflict (source_drive_file_id) do nothing;

  return NEW;
end;
$$;

drop trigger if exists trg_progress_card_to_assignment on public.progress_cards;
create trigger trg_progress_card_to_assignment
  after insert or update on public.progress_cards
  for each row execute function public.progress_card_to_assignment();

-- ── 5. Retire the old drive_event → assignment path ────────────────
-- Single source of truth is now the Progress pipeline. The drive_events poller
-- still records folder activity; it just no longer creates payroll rows.
drop trigger if exists trg_drive_event_to_assignment on public.drive_events;

-- ── 6. Backfill delivered videos since 2026-07-01 (PT) ─────────────
-- completed_at = ready_at (first Watch-1 sighting). Dedup skips the already
-- paid. ~18 rows.
insert into public.freelancer_assignments
  (freelancer_id, title, assignment_type, status, pay_amount,
   completed_at, source_drive_file_id)
select
  '6fa98f97-1555-4a73-bfc7-09ff468c94be'::uuid,
  coalesce(c.title, 'Untitled'),
  'edit',
  'completed',
  coalesce((select fp.rate from public.freelancer_profiles fp
            where fp.id = '6fa98f97-1555-4a73-bfc7-09ff468c94be'), 0),
  c.ready_at,
  c.ready_drive_file_id
from public.progress_cards c
where c.ready_drive_file_id is not null
  and c.ready_at >= (timestamp '2026-07-01 00:00' at time zone 'America/Los_Angeles')
on conflict (source_drive_file_id) do nothing;
