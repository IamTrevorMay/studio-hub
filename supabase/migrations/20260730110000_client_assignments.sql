-- Client Portal part 2: clients create/track assignments for their editors.
-- Adds client RLS on contractor_assignments + comments, column-guard triggers,
-- server-side notification triggers (single source of truth for client-recipient
-- notifications), and extends the daily due-date cron for client creators.

-- 1. Client policies on contractor_assignments (existing admin/contractor
-- policies untouched; freelancer_assignments compat view is security_invoker,
-- so these flow through automatically).
create policy "client insert assignments for own editors"
  on public.contractor_assignments for insert
  with check (
    public.is_client(auth.uid())
    and created_by = auth.uid()
    and contractor_id is not null
    and public.is_client_editor(auth.uid(), contractor_id)
  );

create policy "client select own created assignments"
  on public.contractor_assignments for select
  using (public.is_client(auth.uid()) and created_by = auth.uid());

create policy "client update own created assignments"
  on public.contractor_assignments for update
  using (public.is_client(auth.uid()) and created_by = auth.uid() and status <> 'completed')
  with check (created_by = auth.uid());

-- 2. Column guards (RLS cannot restrict columns). Both no-op for non-clients.
create or replace function public.client_assignment_sanitize()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_client(auth.uid()) then
    return NEW;
  end if;
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
  NEW.source_drive_event_id := null;
  NEW.source_drive_file_id := null;
  -- Server-stamped pay: project-rate editors get their standard rate (client
  -- cannot spoof it); hourly editors stay NULL (payroll computes from hours).
  select case when fp.payment_type is distinct from 'hourly' then fp.rate end
    into NEW.pay_amount
  from contractor_profiles fp where fp.id = NEW.contractor_id;
  return NEW;
end;
$$;

create trigger client_assignment_sanitize_trg
  before insert on public.contractor_assignments
  for each row execute function public.client_assignment_sanitize();

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
    or NEW.submit_folder_id     is distinct from OLD.submit_folder_id
    or NEW.project_id           is distinct from OLD.project_id
    or NEW.deliverable_id       is distinct from OLD.deliverable_id
    or NEW.mayday_video_id      is distinct from OLD.mayday_video_id
    or NEW.created_by           is distinct from OLD.created_by
    or NEW.assignment_type      is distinct from OLD.assignment_type
    or NEW.source_drive_event_id is distinct from OLD.source_drive_event_id
    or NEW.source_drive_file_id is distinct from OLD.source_drive_file_id
  then
    raise exception 'Clients may only edit title, description, due date/time, and content type';
  end if;
  return NEW;
end;
$$;

create trigger client_assignment_lock_fields_trg
  before update on public.contractor_assignments
  for each row execute function public.client_assignment_lock_fields();

-- 3. Comment policies for clients (mirrors the contractor comment policies).
create policy "client select comments on own created assignments"
  on public.contractor_assignment_comments for select
  using (public.is_client(auth.uid()) and exists (
    select 1 from public.contractor_assignments a
    where a.id = assignment_id and a.created_by = auth.uid()));

create policy "client insert comments on own created assignments"
  on public.contractor_assignment_comments for insert
  with check (author_id = auth.uid() and public.is_client(auth.uid()) and exists (
    select 1 from public.contractor_assignments a
    where a.id = assignment_id and a.created_by = auth.uid()));

create policy "client update own comments"
  on public.contractor_assignment_comments for update
  using (author_id = auth.uid() and public.is_client(auth.uid()))
  with check (author_id = auth.uid());

-- 4. Server-side notification triggers. These fire only for client-created
-- assignments, so existing staff flows are unaffected. The frontend must NOT
-- also insert client-recipient notifications (these are authoritative).

-- 4a. Status changes -> notify the client.
create or replace function public.client_assignment_status_notify()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if NEW.status is distinct from OLD.status
     and public.is_client(NEW.created_by)
     and NEW.created_by is distinct from auth.uid() then
    if NEW.status = 'completed' then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (NEW.created_by, 'cl_assignment_completed', 'Assignment completed',
              '"' || NEW.title || '" was completed by your editor.',
              'cl_dashboard', NEW.id::text);
    else
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (NEW.created_by, 'cl_assignment_status', 'Assignment status updated',
              '"' || NEW.title || '" is now ' || replace(NEW.status, '_', ' ') || '.',
              'cl_dashboard', NEW.id::text);
    end if;
  end if;
  return NEW;
end;
$$;

create trigger client_assignment_status_notify_trg
  after update of status on public.contractor_assignments
  for each row execute function public.client_assignment_status_notify();

-- 4b. New client-created assignment -> notify the editor (in-app; the existing
-- notify-fl-assignment email trigger already fires for any insert).
create or replace function public.client_assignment_new_notify()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if public.is_client(NEW.created_by) and NEW.contractor_id is not null then
    insert into public.notifications (user_id, type, title, body, link_tab, link_target)
    values (NEW.contractor_id, 'fl_assignment_new', 'New assignment from a client',
            '"' || NEW.title || '"', 'fl_dashboard', NEW.id::text);
  end if;
  return NEW;
end;
$$;

create trigger client_assignment_new_notify_trg
  after insert on public.contractor_assignments
  for each row execute function public.client_assignment_new_notify();

-- 4c. Comments on client-created assignments -> notify the other side.
create or replace function public.client_assignment_comment_notify()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a record;
begin
  select id, title, created_by, contractor_id
    into a
    from public.contractor_assignments
   where id = NEW.assignment_id;
  if not found or not public.is_client(a.created_by) then
    return NEW;
  end if;
  if NEW.author_id = a.created_by then
    -- Client commented -> notify the editor (existing fl_ type = existing push category).
    if a.contractor_id is not null then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (a.contractor_id, 'fl_comment', 'New comment on your assignment',
              '"' || a.title || '": ' || left(NEW.body, 140),
              'fl_dashboard', a.id::text);
    end if;
  else
    -- Editor (or staff) commented -> notify the client.
    insert into public.notifications (user_id, type, title, body, link_tab, link_target)
    values (a.created_by, 'cl_comment', 'New comment on "' || a.title || '"',
            left(NEW.body, 140), 'cl_dashboard', a.id::text);
  end if;
  return NEW;
end;
$$;

create trigger client_assignment_comment_notify_trg
  after insert on public.contractor_assignment_comments
  for each row execute function public.client_assignment_comment_notify();

-- 5. Daily due-date cron: reproduce the current body verbatim (20260729120000)
-- and add a third loop notifying client creators of missed due dates.
CREATE OR REPLACE FUNCTION public.fl_emit_due_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
begin
  for r in
    select id, contractor_id, title
    from public.contractor_assignments
    where status <> 'completed'
      and due_date < current_date
  loop
    if not exists (
      select 1 from public.notifications
      where user_id = r.contractor_id
        and type = 'fl_assignment_overdue'
        and link_target = r.id::text
    ) then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (
        r.contractor_id,
        'fl_assignment_overdue',
        'Overdue Assignment',
        'Assignment "' || r.title || '" is past due.',
        'fl_dashboard',
        r.id::text
      );
    end if;
  end loop;

  for r in
    select id, contractor_id, title
    from public.contractor_assignments
    where status <> 'completed'
      and due_date = current_date
  loop
    if not exists (
      select 1 from public.notifications
      where user_id = r.contractor_id
        and type = 'fl_assignment_due'
        and link_target = r.id::text
    ) then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (
        r.contractor_id,
        'fl_assignment_due',
        'Assignment Due Today',
        'Assignment "' || r.title || '" is due today.',
        'fl_dashboard',
        r.id::text
      );
    end if;
  end loop;

  -- Client creators: alert when an assignment they contracted misses its due date.
  for r in
    select a.id, a.created_by, a.title
    from public.contractor_assignments a
    where a.status <> 'completed'
      and a.due_date < current_date
      and a.created_by is not null
      and public.is_client(a.created_by)
  loop
    if not exists (
      select 1 from public.notifications
      where user_id = r.created_by
        and type = 'cl_assignment_overdue'
        and link_target = r.id::text
    ) then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (
        r.created_by,
        'cl_assignment_overdue',
        'Assignment overdue',
        'Your assignment "' || r.title || '" missed its due date.',
        'cl_dashboard',
        r.id::text
      );
    end if;
  end loop;
end;
$function$;

notify pgrst, 'reload schema';
