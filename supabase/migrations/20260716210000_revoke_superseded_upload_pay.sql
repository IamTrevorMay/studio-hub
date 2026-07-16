-- Fix double-pay from re-uploaded Ready videos.
--
-- "Trump will try to force MLB to have a salary cap" was delivered to Watch 1
-- on 2026-07-14 at 12:32 PT, then deleted and re-uploaded 6 minutes later.
-- A re-upload gets a new Drive file id, so the per-file dedup in
-- 20260716120000 saw two distinct files: two progress_cards, two $35
-- assignments. The superseded card's signature: archived while still in the
-- Ready column (moved_to_scheduled_at null) with a same-title replacement card
-- carrying a different ready file id.
--
-- IMPORTANT: archived-unscheduled ALONE is not a safe revoke signal — the
-- 2026-06-04 bulk archive hit legitimately delivered (and paid) cards. Revoke
-- only when a replacement upload actually exists, only within a 7-day window,
-- and never from a period already marked paid in payroll_paid.

-- ── 1. Shared revoke helper ─────────────────────────────────────────
-- Deletes assignments for cards with the same title as the surviving card
-- that were archived without ever being scheduled (their file vanished from
-- Watch 1 = replaced upload). Skips periods already marked paid.
create or replace function public.revoke_superseded_ready_assignments(
  p_title text,
  p_keep_file_id text,
  p_ready_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.freelancer_assignments a
  using public.progress_cards old
  where old.ready_drive_file_id = a.source_drive_file_id
    and old.title = p_title
    and old.ready_drive_file_id <> p_keep_file_id
    and old.archived_at is not null
    and old.moved_to_scheduled_at is null
    and old.ready_at between p_ready_at - interval '7 days'
                         and p_ready_at + interval '1 day'
    and not exists (
      select 1 from public.payroll_paid pp
      where pp.profile_id = a.freelancer_id
        and pp.period_start = case
          when extract(day from (a.completed_at at time zone 'America/Los_Angeles')) <= 15
            then date_trunc('month', (a.completed_at at time zone 'America/Los_Angeles'))::date
          else (date_trunc('month', (a.completed_at at time zone 'America/Los_Angeles')) + interval '15 days')::date
        end
    );
end;
$$;

-- ── 2. Revoke on replacement arrival ────────────────────────────────
-- The sync usually archives the old card first, then inserts the replacement
-- on a later poll — so the assignment-creating trigger is the natural place
-- to sweep superseded siblings.
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

  -- A re-upload of the same video superseded an earlier delivery — the
  -- earlier file's pay row must not survive alongside this one.
  perform public.revoke_superseded_ready_assignments(
    NEW.title, NEW.ready_drive_file_id, coalesce(NEW.ready_at, now()));

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

-- ── 3. Revoke on archive when the replacement already exists ────────
-- Covers the opposite write order (replacement card inserted before the old
-- card is archived in the same or an earlier sync run).
create or replace function public.progress_card_revoke_on_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_replacement public.progress_cards%rowtype;
begin
  if OLD.archived_at is not null            -- only the transition to archived
     or NEW.archived_at is null
     or NEW.moved_to_scheduled_at is not null
     or NEW.ready_drive_file_id is null then
    return NEW;
  end if;

  select * into v_replacement
  from public.progress_cards n
  where n.title = NEW.title
    and n.id <> NEW.id
    and n.archived_at is null
    and n.ready_drive_file_id is not null
    and n.ready_drive_file_id <> NEW.ready_drive_file_id
    and n.ready_at >= NEW.ready_at - interval '1 day'
  order by n.ready_at desc
  limit 1;

  if found then
    perform public.revoke_superseded_ready_assignments(
      v_replacement.title, v_replacement.ready_drive_file_id,
      coalesce(v_replacement.ready_at, now()));
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_progress_card_revoke_on_archive on public.progress_cards;
create trigger trg_progress_card_revoke_on_archive
  after update on public.progress_cards
  for each row execute function public.progress_card_revoke_on_archive();

-- ── 4. Data fix: remove the superseded July 14 duplicate ────────────
-- First upload of the salary-cap video (12:32 PT), replaced at 12:39 PT.
delete from public.freelancer_assignments
where id = '9ce35bb7-9f29-496f-bc30-902235179037'
  and source_drive_file_id = '1pKtLAGuN7TSx8Nj928i6S0MZutHYXaTO';
