-- Drive-upload payroll safeguard
-- Context: contractor pay is driven by contractor_assignments rows keyed on
-- completed_at. Rows are entered in periodic manual batches, and the batch for
-- the back half of July 2026 was never entered — so editors' uploads went
-- unpaid with no signal anywhere. Meanwhile drive-watch-poll already logs every
-- file upload to drive_events WITH uploader attribution (uploader_email).
--
-- This migration wires that log into payroll as a passive safety net:
--   1. profiles.drive_email  — bridges a Google upload account -> a contractor
--   2. unbilled_drive_uploads() — reconciliation: (E)-prefixed uploads in a
--      period that have NO matching assignment row, per mapped contractor
--   3. bill_drive_upload()   — one-click convert an upload into a completed
--      assignment (admin only), with drive-event provenance so it can't dup
--
-- Convention (confirmed by team): a payable short-form deliverable is one
-- "(E) ..."-prefixed file per uploader (the editor's cut). "(S) (E) ..." files
-- are a downstream second pass and are NOT billed here. Dedup is by drive_file_id.

-- 1. Email -> contractor bridge -------------------------------------------------
alter table public.profiles add column if not exists drive_email text;
comment on column public.profiles.drive_email is
  'Google account email this person uploads from in Drive (may differ from their login email). Used to attribute drive_events to a contractor for payroll reconciliation.';

-- one profile per upload email
create unique index if not exists profiles_drive_email_lower_key
  on public.profiles (lower(drive_email)) where drive_email is not null;

-- Backfill known uploaders seen in drive_events. emilyjude1@gmail.com and the
-- owner account are intentionally left unmapped (identity unconfirmed / not a
-- paid per-video contractor).
update public.profiles set drive_email = 'alanalbenson@gmail.com'
  where id = '6fa98f97-1555-4a73-bfc7-09ff468c94be' and drive_email is null;   -- Alana Benson (Short-Form Video Editor)
update public.profiles set drive_email = 'esharbaugh32@gmail.com'
  where id = 'e5bd8aa3-cd6f-4871-957b-084d872751aa' and drive_email is null;   -- Emily Sharbaugh (Podcast Editor)
update public.profiles set drive_email = 'dkorn444@gmail.com'
  where id = 'aff29906-eda8-4c3f-8a1e-a550b5bbe45d' and drive_email is null;   -- David Korn (member)

-- 2. Reconciliation: unbilled uploads in a pay period --------------------------
-- Returns one row per un-assigned (E) upload attributed to a contractor whose
-- Drive email is mapped. PT-day window matches Payroll.js (America/Los_Angeles,
-- DST-safe, half-open [start, end+1)).
create or replace function public.unbilled_drive_uploads(p_start date, p_end date)
returns table (
  contractor_id   uuid,
  contractor_name text,
  drive_event_id  uuid,
  drive_file_id   text,
  file_name       text,
  uploaded_at     timestamptz,
  web_view_link   text,
  suggested_pay   numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
  select distinct on (e.drive_file_id)
    pr.id,
    pr.full_name,
    e.id,
    e.drive_file_id,
    e.file_name,
    e.created_time,
    e.web_view_link,
    coalesce(
      (select ca2.pay_amount
         from public.contractor_assignments ca2
        where ca2.contractor_id = pr.id and ca2.pay_amount is not null
        order by ca2.completed_at desc nulls last
        limit 1),
      35.00
    ) as suggested_pay
  from public.drive_events e
  join public.profiles pr
    on lower(pr.drive_email) = lower(e.uploader_email)
   and pr.role = 'contractor'
  where e.file_name like '(E)%'
    and e.event_type in ('added','modified')
    and e.created_time >= (p_start::timestamp at time zone 'America/Los_Angeles')
    and e.created_time <  ((p_end + 1)::timestamp at time zone 'America/Los_Angeles')
    and not exists (
      select 1 from public.contractor_assignments ca
      where ca.source_drive_file_id = e.drive_file_id
         or ca.source_drive_event_id = e.id
    )
  order by e.drive_file_id, e.created_time;  -- earliest event per file
end;
$$;

-- 3. One-click bill an upload into an assignment -------------------------------
create or replace function public.bill_drive_upload(p_drive_event_id uuid, p_pay numeric default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event       public.drive_events;
  v_contractor  uuid;
  v_pay         numeric;
  v_new         uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select * into v_event from public.drive_events where id = p_drive_event_id;
  if not found then
    raise exception 'drive event % not found', p_drive_event_id;
  end if;

  select id into v_contractor
  from public.profiles
  where lower(drive_email) = lower(v_event.uploader_email) and role = 'contractor';
  if v_contractor is null then
    raise exception 'no contractor mapped to uploader %', v_event.uploader_email;
  end if;

  if exists (
    select 1 from public.contractor_assignments ca
    where ca.source_drive_file_id = v_event.drive_file_id
       or ca.source_drive_event_id = v_event.id
  ) then
    raise exception 'upload already billed';
  end if;

  v_pay := coalesce(
    p_pay,
    (select ca2.pay_amount from public.contractor_assignments ca2
      where ca2.contractor_id = v_contractor and ca2.pay_amount is not null
      order by ca2.completed_at desc nulls last limit 1),
    35.00
  );

  insert into public.contractor_assignments
    (contractor_id, title, assignment_type, status, pay_amount, content_type,
     completed_at, source_drive_file_id, source_drive_event_id, created_by)
  values
    (v_contractor, v_event.file_name, 'edit', 'completed', v_pay, 'video',
     v_event.created_time, v_event.drive_file_id, v_event.id, auth.uid())
  returning id into v_new;

  return v_new;
end;
$$;

grant execute on function public.unbilled_drive_uploads(date, date) to authenticated;
grant execute on function public.bill_drive_upload(uuid, numeric) to authenticated;
