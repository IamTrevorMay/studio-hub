-- Mayday Video Workflow: DB triggers that wire beat_sheets and
-- freelancer_assignments to the workflow-internal helper edge function.

create extension if not exists pg_net with schema extensions;

-- ─── Trigger 1: start workflow when a beat sheet lands in Mayday ──────
create or replace function public.trg_mayday_video_start()
returns trigger
language plpgsql
security definer
as $$
declare
  should_start boolean := false;
begin
  if (TG_OP = 'INSERT') then
    should_start := NEW.folder = 'mayday' and coalesce(NEW.is_archived, false) = false;
  elsif (TG_OP = 'UPDATE') then
    should_start :=
      NEW.folder = 'mayday'
      and coalesce(NEW.is_archived, false) = false
      and (OLD.folder is distinct from 'mayday' or coalesce(OLD.is_archived, false) = true);
  end if;

  if not should_start then
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/workflow-internal?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := jsonb_build_object(
      'op', 'start',
      'slug', 'mayday_video_workflow',
      'dedupe_key', 'beat_sheet_id',
      'context', jsonb_build_object(
        'beat_sheet_id', NEW.id::text,
        'beat_sheet_title', coalesce(NEW.title, '(untitled)')
      )
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return NEW;
end;
$$;

drop trigger if exists mayday_video_start on public.beat_sheets;
create trigger mayday_video_start
  after insert or update of folder, is_archived on public.beat_sheets
  for each row execute function public.trg_mayday_video_start();

-- ─── Trigger 2: editor assignment created → complete film_send_to_editor ──
create or replace function public.trg_mayday_video_match_film()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.freelancer_id is null then
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/workflow-internal?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := jsonb_build_object(
      'op', 'complete_match',
      'slug', 'mayday_video_workflow',
      'step_key', 'film_send_to_editor',
      'match_context', jsonb_build_object('editor_id', NEW.freelancer_id::text),
      'payload', jsonb_build_object('editor_assignment_id', NEW.id::text)
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return NEW;
end;
$$;

drop trigger if exists mayday_video_match_film on public.freelancer_assignments;
create trigger mayday_video_match_film
  after insert on public.freelancer_assignments
  for each row execute function public.trg_mayday_video_match_film();

-- ─── Trigger 3: editor assignment completed → complete wait_on_edit ──
create or replace function public.trg_mayday_video_match_wait()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.status is distinct from 'completed' or OLD.status = 'completed' then
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/workflow-internal?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := jsonb_build_object(
      'op', 'complete_match',
      'slug', 'mayday_video_workflow',
      'step_key', 'wait_on_edit',
      'match_context', jsonb_build_object('editor_assignment_id', NEW.id::text),
      'payload', jsonb_build_object()
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return NEW;
end;
$$;

drop trigger if exists mayday_video_match_wait on public.freelancer_assignments;
create trigger mayday_video_match_wait
  after update of status on public.freelancer_assignments
  for each row execute function public.trg_mayday_video_match_wait();
