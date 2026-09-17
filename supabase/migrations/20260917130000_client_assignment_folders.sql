-- Client portal: per-assignment project folder + finished-project link.
--
-- client_profiles.drive_folder_url is now the client's ASSETS folder (branding
-- assets), surfaced as an "Assets" button on every one of their assignments.
-- The column keeps its name; only the meaning and the UI copy change.
--
-- Each client-created assignment carries project_folder_url (the folder with
-- that project's footage/materials, set by the client, required) and
-- delivery_url (the exact location of the finished project, set by the editor
-- and REQUIRED to complete). Staff-created assignments are untouched: both
-- columns are optional there and the existing asset_url / upload flow stays.

alter table public.contractor_assignments
  add column if not exists project_folder_url text,
  add column if not exists delivery_url text;

comment on column public.client_profiles.drive_folder_url is
  'Client assets folder (branding assets). Link-only; shown as an Assets button on every assignment.';
comment on column public.contractor_assignments.project_folder_url is
  'Folder holding this project''s footage/materials. Required on client-created assignments.';
comment on column public.contractor_assignments.delivery_url is
  'Exact location of the finished project. Editor-set; required to complete a client-created assignment.';

-- 1. Insert guard: clients must supply a project folder; delivery_url is never
--    theirs to set.
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

-- 2. Update guard: clients may edit project_folder_url (it's theirs) but not
--    delivery_url, and can't blank the project folder.
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

-- 3. Completion gate: a client-created assignment can't flip to completed
--    without the finished-project link. Admin-tier can override (support /
--    cleanup); editors and everyone else are held to it. Server-side so the
--    mobile dashboard and any direct write are covered, not just the UI.
create or replace function public.client_assignment_delivery_gate()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if NEW.status = 'completed'
     and OLD.status is distinct from 'completed'
     and public.is_client(NEW.created_by)
     and (NEW.delivery_url is null or btrim(NEW.delivery_url) = '')
     and auth.uid() is not null
     and not public.is_admin(auth.uid()) then
    raise exception 'A link to the finished project is required to complete this assignment';
  end if;
  if NEW.delivery_url is not null then
    NEW.delivery_url := nullif(btrim(NEW.delivery_url), '');
  end if;
  return NEW;
end;
$$;

drop trigger if exists client_assignment_delivery_gate_trg on public.contractor_assignments;
create trigger client_assignment_delivery_gate_trg
  before update on public.contractor_assignments
  for each row execute function public.client_assignment_delivery_gate();

-- 4. Completion notification carries the finished-project link.
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
              '"' || NEW.title || '" was completed by your editor.'
                || case when NEW.delivery_url is not null
                        then ' Finished project: ' || NEW.delivery_url
                        else '' end,
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
