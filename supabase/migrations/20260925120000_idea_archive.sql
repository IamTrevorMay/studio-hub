-- Ideas archive.
--
-- Checked ideas are swept off the board at midnight Pacific and land in the
-- Archived drawer (Ideas tab, top right), stamped with the moment they were
-- checked complete. Nothing is deleted: `archived_at` hides the row from the
-- live board, and Restore clears it again.

alter table public.write_ideas
  add column if not exists checked_at timestamptz,
  add column if not exists archived_at timestamptz;

comment on column public.write_ideas.checked_at is
  'When the idea was last checked complete (trigger-stamped; cleared on uncheck).';
comment on column public.write_ideas.archived_at is
  'Set by the nightly archive_checked_ideas() sweep; null = live on the board.';

create index if not exists write_ideas_archived_at_idx
  on public.write_ideas (archived_at desc)
  where archived_at is not null;

-- ── checked_at stamp ───────────────────────────────────────────────────
-- Clients only ever write `checked`; the timestamp is owned here so every
-- path (desktop, mobile, assistant) agrees on when a box was ticked.
create or replace function public.write_ideas_stamp_checked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.checked then
    if new.checked_at is null or (tg_op = 'UPDATE' and not coalesce(old.checked, false)) then
      new.checked_at := now();
    end if;
  else
    new.checked_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists write_ideas_stamp_checked on public.write_ideas;
create trigger write_ideas_stamp_checked
  before insert or update of checked, checked_at on public.write_ideas
  for each row execute function public.write_ideas_stamp_checked();

-- Best guess for boxes already ticked before this shipped: the last edit.
update public.write_ideas
   set checked_at = coalesce(updated_at, created_at, now())
 where checked and checked_at is null;

-- ── nightly sweep ──────────────────────────────────────────────────────
-- pg_cron is UTC-only, so two slots cover both offsets (07:00 UTC = midnight
-- PDT, 08:00 UTC = midnight PST). The function gates on the real PT hour so
-- exactly one slot does work on any given day. `p_force` skips the gate for
-- manual runs.
create or replace function public.archive_checked_ideas(p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not p_force
     and extract(hour from (now() at time zone 'America/Los_Angeles')) <> 0 then
    return 0;
  end if;

  with swept as (
    update public.write_ideas
       set archived_at = now(),
           checked_at  = coalesce(checked_at, now())
     where checked
       and archived_at is null
    returning 1
  )
  select count(*) into v_count from swept;

  if v_count > 0 then
    raise notice 'archive_checked_ideas: archived % idea(s)', v_count;
  end if;
  return v_count;
end;
$$;

comment on function public.archive_checked_ideas(boolean) is
  'Moves every checked, unarchived idea into the Archived drawer. Runs from cron at midnight PT; pass true to bypass the hour gate.';

revoke all on function public.archive_checked_ideas(boolean) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job
 where jobname in ('archive-checked-ideas-pdt', 'archive-checked-ideas-pst');

-- Minute 2 keeps clear of the :00 jobs already on the 08:00 UTC slot.
select cron.schedule('archive-checked-ideas-pdt', '2 7 * * *', $$select public.archive_checked_ideas();$$);
select cron.schedule('archive-checked-ideas-pst', '2 8 * * *', $$select public.archive_checked_ideas();$$);
