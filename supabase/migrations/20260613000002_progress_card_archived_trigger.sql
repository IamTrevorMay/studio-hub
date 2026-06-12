-- When a progress_card is archived, create a completed task for Emily Jude
create or replace function public.on_progress_card_archived()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_emily_id uuid := '712f6910-7262-4551-8cb4-9dc609ef91fb';
begin
  -- Only fire when archived_at changes from null to not-null
  if OLD.archived_at is null and NEW.archived_at is not null then
    insert into tasks (title, assignee_id, status, completed_at, step_key, related_entity_type, related_entity_id)
    values (
      NEW.title || ' — Published',
      v_emily_id,
      'complete',
      NEW.archived_at,
      'published',
      'progress_card',
      NEW.id
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_progress_card_archived on progress_cards;
create trigger trg_progress_card_archived
  after update of archived_at on progress_cards
  for each row
  execute function on_progress_card_archived();
