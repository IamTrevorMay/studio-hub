-- Drop uploader_email matching in drive_event_to_assignment. Google Drive
-- only exposes lastModifyingUser, not original uploader — so any rename or
-- review by another team member overwrites attribution and the freelancer
-- match fails. For the current setup, all videos uploaded to the watched
-- folder are Alana's work; hardcode her profile id so attribution survives
-- downstream edits.
--
-- When a second video-editing freelancer is added, swap this back to a
-- proper revision-based lookup (poller would need to fetch
-- /files/{id}/revisions and use the first revision's lastModifyingUser).

create or replace function public.drive_event_to_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_rate       numeric;
begin
  if NEW.event_type <> 'added' then
    return NEW;
  end if;
  if NEW.mime_type is null or NEW.mime_type not like 'video/%' then
    return NEW;
  end if;

  -- All videos in the watched folder are Alana Benson's work.
  select p.id, fp.rate
    into v_profile_id, v_rate
  from public.profiles p
  join public.freelancer_profiles fp on fp.id = p.id
  where p.id = '6fa98f97-1555-4a73-bfc7-09ff468c94be'
  limit 1;

  if v_profile_id is null then
    return NEW;
  end if;

  insert into public.freelancer_assignments
    (freelancer_id, title, assignment_type, status, pay_amount,
     completed_at, asset_url, source_drive_event_id)
  values
    (v_profile_id,
     coalesce(NEW.file_name, 'Drive upload'),
     'edit',
     'completed',
     coalesce(v_rate, 0),
     coalesce(NEW.created_time, NEW.created_at),
     NEW.web_view_link,
     NEW.id)
  on conflict (source_drive_event_id) do nothing;

  update public.drive_events set processed_at = now() where id = NEW.id;

  return NEW;
end;
$$;
