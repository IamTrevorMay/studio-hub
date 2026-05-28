-- Send the contractor an email when they're newly assigned an item.
-- Fires on INSERT with a non-null freelancer_id, or on UPDATE when freelancer_id
-- actually changes to a different non-null value. Hands off async via pg_net so
-- the assignment transaction is not blocked by HTTP.

create extension if not exists pg_net with schema extensions;

create or replace function public.trg_fl_assignment_notify_new_owner()
returns trigger
language plpgsql
security definer
as $$
declare
  should_notify boolean := false;
begin
  if (TG_OP = 'INSERT') then
    should_notify := NEW.freelancer_id is not null;
  elsif (TG_OP = 'UPDATE') then
    should_notify := NEW.freelancer_id is not null
                     and NEW.freelancer_id is distinct from OLD.freelancer_id;
  end if;

  if not should_notify then
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/notify-fl-assignment?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := jsonb_build_object('assignment_id', NEW.id::text),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return NEW;
end;
$$;

drop trigger if exists fl_assignment_notify_new_owner on public.freelancer_assignments;
create trigger fl_assignment_notify_new_owner
  after insert or update of freelancer_id on public.freelancer_assignments
  for each row execute function public.trg_fl_assignment_notify_new_owner();
