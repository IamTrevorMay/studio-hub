-- Slate pipeline stops at approval; editing moves to "+ Assignment".
--
-- The chain was fq_write → fq_review → fq_send → fq_edit (+ fq_draft_review).
-- It is now fq_write → fq_review, and the item sits in The Line. Editing work
-- is handed out from the Dashboard's "+ Assignment" menu (Member task or
-- Contractor assignment), each of which can optionally point at a slate item.
--
-- Linking an assignment to a slate item IS the "it got shot" signal
-- (state → filmed). Completing that assignment closes the item (state → done).
-- One assignment per item, across both tables. Unlinking or deleting the
-- assignment leaves the item filmed and makes it linkable again.

-- ── The link ────────────────────────────────────────────────────────────────
alter table public.contractor_assignments
  add column if not exists film_queue_item_id uuid
  references public.film_queue_items(id) on delete set null;

alter table public.tasks
  add column if not exists film_queue_item_id uuid
  references public.film_queue_items(id) on delete set null;

create unique index if not exists contractor_assignments_fq_item_uniq
  on public.contractor_assignments(film_queue_item_id)
  where film_queue_item_id is not null;

create unique index if not exists tasks_fq_item_uniq
  on public.tasks(film_queue_item_id)
  where film_queue_item_id is not null;

comment on column public.contractor_assignments.film_queue_item_id is
  'Optional slate item this assignment edits. Set = the item was filmed; completing the assignment marks the item done.';
comment on column public.tasks.film_queue_item_id is
  'Optional slate item this member task edits. Distinct from related_entity_type/id, which still carries the fq_* pipeline tasks.';

-- editor_id is dead: editors are named on the assignment now, never on the
-- slate item. Column kept (history) but nothing reads or writes it.
comment on column public.film_queue_items.editor_id is
  'DEPRECATED 2026-09-17 — editing assignments live on contractor_assignments / tasks via film_queue_item_id.';

-- ── One assignment per item, across both tables ─────────────────────────────
-- The partial unique indexes above each cover one table; this catches the
-- cross-table case (a member task and a contractor assignment on one item).
create or replace function public.film_queue_item_link_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if NEW.film_queue_item_id is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.film_queue_item_id is not distinct from NEW.film_queue_item_id then
    return NEW;
  end if;

  if exists (
    select 1 from public.contractor_assignments ca
     where ca.film_queue_item_id = NEW.film_queue_item_id
       and (TG_TABLE_NAME <> 'contractor_assignments' or ca.id <> NEW.id)
  ) or exists (
    select 1 from public.tasks t
     where t.film_queue_item_id = NEW.film_queue_item_id
       and (TG_TABLE_NAME <> 'tasks' or t.id <> NEW.id)
  ) then
    raise exception 'That slate item already has an editing assignment';
  end if;

  return NEW;
end;
$$;

drop trigger if exists contractor_assignments_fq_link_guard on public.contractor_assignments;
create trigger contractor_assignments_fq_link_guard
  before insert or update of film_queue_item_id on public.contractor_assignments
  for each row when (NEW.film_queue_item_id is not null)
  execute function public.film_queue_item_link_guard();

drop trigger if exists tasks_fq_link_guard on public.tasks;
create trigger tasks_fq_link_guard
  before insert or update of film_queue_item_id on public.tasks
  for each row when (NEW.film_queue_item_id is not null)
  execute function public.film_queue_item_link_guard();

-- ── Link / completion → item state ──────────────────────────────────────────
create or replace function public.film_queue_assignment_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_old uuid;
  v_new uuid;
  v_done_now boolean := false;
  v_was_done boolean := false;
  v_done_status text := case TG_TABLE_NAME when 'contractor_assignments' then 'completed' else 'complete' end;
begin
  v_old := case when TG_OP = 'INSERT' then null else OLD.film_queue_item_id end;
  v_new := case when TG_OP = 'DELETE' then null else NEW.film_queue_item_id end;

  -- Linked and sent = filmed. Never walks a done item backwards.
  if v_new is not null and v_old is distinct from v_new then
    update public.film_queue_items
       set state      = 'filmed',
           filmed_at  = coalesce(filmed_at, now()),
           updated_at = now()
     where id = v_new
       and state <> 'done';
  end if;

  -- Unlinked (or the assignment was deleted): the shoot still happened, so the
  -- item stays filmed — it just becomes linkable again.
  if v_old is not null and v_old is distinct from v_new then
    update public.film_queue_items
       set state      = case when state = 'done' then 'filmed' else state end,
           updated_at = now()
     where id = v_old;
  end if;

  -- The editor finished: the slate item is complete.
  if v_new is not null and TG_OP <> 'DELETE' then
    v_done_now := NEW.status = v_done_status;
    v_was_done := TG_OP = 'UPDATE' and OLD.status = v_done_status and v_old is not distinct from v_new;
    if v_done_now and not v_was_done then
      if TG_TABLE_NAME = 'contractor_assignments' then
        update public.film_queue_items
           set state      = 'done',
               cut_url    = coalesce(nullif(btrim(NEW.delivery_url), ''), NEW.asset_url, cut_url),
               updated_at = now()
         where id = v_new;
      else
        update public.film_queue_items
           set state      = 'done',
               cut_url    = coalesce(nullif(btrim(NEW.completion_payload ->> 'cut_url'), ''), NEW.link_url, cut_url),
               updated_at = now()
         where id = v_new;
      end if;
    end if;
  end if;

  return null;
end;
$$;

-- Split by operation so the WHEN clauses can keep this off the hot path for
-- every unrelated task/assignment write.
drop trigger if exists contractor_assignments_fq_sync_ins on public.contractor_assignments;
create trigger contractor_assignments_fq_sync_ins
  after insert on public.contractor_assignments
  for each row when (NEW.film_queue_item_id is not null)
  execute function public.film_queue_assignment_sync();

drop trigger if exists contractor_assignments_fq_sync_upd on public.contractor_assignments;
create trigger contractor_assignments_fq_sync_upd
  after update on public.contractor_assignments
  for each row when (
    coalesce(NEW.film_queue_item_id, OLD.film_queue_item_id) is not null
    and (NEW.film_queue_item_id is distinct from OLD.film_queue_item_id
         or NEW.status is distinct from OLD.status)
  )
  execute function public.film_queue_assignment_sync();

drop trigger if exists contractor_assignments_fq_sync_del on public.contractor_assignments;
create trigger contractor_assignments_fq_sync_del
  after delete on public.contractor_assignments
  for each row when (OLD.film_queue_item_id is not null)
  execute function public.film_queue_assignment_sync();

drop trigger if exists tasks_fq_sync_ins on public.tasks;
create trigger tasks_fq_sync_ins
  after insert on public.tasks
  for each row when (NEW.film_queue_item_id is not null)
  execute function public.film_queue_assignment_sync();

drop trigger if exists tasks_fq_sync_upd on public.tasks;
create trigger tasks_fq_sync_upd
  after update on public.tasks
  for each row when (
    coalesce(NEW.film_queue_item_id, OLD.film_queue_item_id) is not null
    and (NEW.film_queue_item_id is distinct from OLD.film_queue_item_id
         or NEW.status is distinct from OLD.status)
  )
  execute function public.film_queue_assignment_sync();

drop trigger if exists tasks_fq_sync_del on public.tasks;
create trigger tasks_fq_sync_del
  after delete on public.tasks
  for each row when (OLD.film_queue_item_id is not null)
  execute function public.film_queue_assignment_sync();

-- ── Clients never touch the slate ───────────────────────────────────────────
-- Both guards are rewritten wholesale (they're the 2026-09-17 versions plus
-- film_queue_item_id) so the client portal can't link or unlink a slate item.
create or replace function public.client_assignment_sanitize()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_client(auth.uid()) then
    return NEW;
  end if;
  if NEW.project_folder_url is null or btrim(NEW.project_folder_url) = '' then
    raise exception 'A project folder link is required';
  end if;
  NEW.project_folder_url := btrim(NEW.project_folder_url);
  NEW.delivery_url := null;
  NEW.created_by := auth.uid();
  NEW.status := 'assigned';
  NEW.completed_at := null;
  NEW.declined_at := null;
  NEW.hours_spent := null;
  NEW.asset_url := null;
  NEW.submit_folder_id := null;
  NEW.project_id := null;
  NEW.deliverable_id := null;
  NEW.mayday_video_id := null;
  NEW.film_queue_item_id := null;
  NEW.source_drive_event_id := null;
  NEW.source_drive_file_id := null;
  select case when fp.payment_type is distinct from 'hourly' then fp.rate end
    into NEW.pay_amount
  from contractor_profiles fp where fp.id = NEW.contractor_id;
  return NEW;
end;
$$;

create or replace function public.client_assignment_lock_fields()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_client(auth.uid()) then
    return NEW;
  end if;
  if NEW.contractor_id          is distinct from OLD.contractor_id
    or NEW.status               is distinct from OLD.status
    or NEW.pay_amount           is distinct from OLD.pay_amount
    or NEW.hours_spent          is distinct from OLD.hours_spent
    or NEW.completed_at         is distinct from OLD.completed_at
    or NEW.declined_at          is distinct from OLD.declined_at
    or NEW.asset_url            is distinct from OLD.asset_url
    or NEW.delivery_url         is distinct from OLD.delivery_url
    or NEW.submit_folder_id     is distinct from OLD.submit_folder_id
    or NEW.project_id           is distinct from OLD.project_id
    or NEW.deliverable_id       is distinct from OLD.deliverable_id
    or NEW.mayday_video_id      is distinct from OLD.mayday_video_id
    or NEW.film_queue_item_id   is distinct from OLD.film_queue_item_id
    or NEW.created_by           is distinct from OLD.created_by
    or NEW.assignment_type      is distinct from OLD.assignment_type
    or NEW.source_drive_event_id is distinct from OLD.source_drive_event_id
    or NEW.source_drive_file_id is distinct from OLD.source_drive_file_id
  then
    raise exception 'Clients may only edit title, description, due date/time, content type, and project folder';
  end if;
  if NEW.project_folder_url is null or btrim(NEW.project_folder_url) = '' then
    raise exception 'A project folder link is required';
  end if;
  NEW.project_folder_url := btrim(NEW.project_folder_url);
  return NEW;
end;
$$;

-- ── Picker source ───────────────────────────────────────────────────────────
-- Approved, not done, and not already carrying an assignment. p_include keeps
-- the currently-linked item visible when editing an existing assignment.
create or replace function public.slate_items_for_assignment(p_include uuid default null)
returns table (
  id            uuid,
  title         text,
  queue_type    text,
  state         text,
  film_date     date,
  beat_sheet_id uuid
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select i.id,
         coalesce(nullif(btrim(s.title), ''), 'Untitled'),
         i.queue_type,
         i.state,
         s.film_date,
         i.beat_sheet_id
    from public.film_queue_items i
    join public.beat_sheets s on s.id = i.beat_sheet_id
   where public.is_staff(auth.uid())
     and s.status = 'approved'
     and i.state <> 'done'
     and (
       i.id = p_include
       or (
         not exists (select 1 from public.contractor_assignments ca where ca.film_queue_item_id = i.id)
         and not exists (select 1 from public.tasks t where t.film_queue_item_id = i.id)
       )
     )
   order by s.film_date nulls last, s.approved_at, i.created_at;
$$;

revoke all on function public.slate_items_for_assignment(uuid) from public;
grant execute on function public.slate_items_for_assignment(uuid) to authenticated;

-- The Film Queue view needs to name whoever holds each item's edit, but staff
-- can't read contractor_assignments (admin/own only) or other people's tasks.
-- This hands back just the summary those rows need — no pay, no description.
create or replace function public.slate_item_assignments()
returns table (
  film_queue_item_id uuid,
  kind               text,
  assignment_id      uuid,
  title              text,
  person_id          uuid,
  person_name        text,
  done               boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select ca.film_queue_item_id,
         'contractor'::text,
         ca.id,
         ca.title,
         ca.contractor_id,
         coalesce(nullif(btrim(p.full_name), ''), p.email, 'Unknown'),
         ca.status = 'completed'
    from public.contractor_assignments ca
    left join public.profiles p on p.id = ca.contractor_id
   where ca.film_queue_item_id is not null
     and public.is_staff(auth.uid())
  union all
  select t.film_queue_item_id,
         'member'::text,
         t.id,
         t.title,
         t.assignee_id,
         coalesce(nullif(btrim(p.full_name), ''), p.email, 'Unknown'),
         t.status = 'complete'
    from public.tasks t
    left join public.profiles p on p.id = t.assignee_id
   where t.film_queue_item_id is not null
     and public.is_staff(auth.uid());
$$;

revoke all on function public.slate_item_assignments() from public;
grant execute on function public.slate_item_assignments() to authenticated;

-- ── Retire the removed steps ────────────────────────────────────────────────
-- Silently close anything still open on the three dropped steps. Their sprint
-- cards go with them so nothing is left pointing at a step that no longer runs.
delete from public.personal_tasks
 where task_id in (
   select id from public.tasks
    where step_key in ('fq_send', 'fq_edit', 'fq_draft_review')
      and status in ('pending', 'active', 'on_hold')
 );

update public.tasks
   set status = 'skipped',
       completed_at = now()
 where step_key in ('fq_send', 'fq_edit', 'fq_draft_review')
   and status in ('pending', 'active', 'on_hold');
