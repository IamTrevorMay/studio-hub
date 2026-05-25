-- Clean up orphaned notifications and add triggers to prevent future orphans.
-- Notifications reference bd_tasks, bd_initiatives, and freelancer_assignments
-- via link_target (text), but nothing deletes them when the source item is
-- removed or completed.

-- 1. Trigger: delete notifications when a bd_task is deleted or completed
create or replace function public.trg_bd_task_cleanup_notifications()
returns trigger language plpgsql security definer as $$
begin
  if (TG_OP = 'DELETE') then
    delete from public.notifications
    where link_target = OLD.id::text
      and type in ('bd_task_overdue', 'bd_task_due');
    return OLD;
  end if;
  -- UPDATE: task just got completed
  if (NEW.completed_at is not null and OLD.completed_at is null) then
    delete from public.notifications
    where link_target = NEW.id::text
      and type in ('bd_task_overdue', 'bd_task_due');
  end if;
  return NEW;
end;
$$;

drop trigger if exists bd_task_cleanup_notifications on bd_tasks;
create trigger bd_task_cleanup_notifications
  after delete or update of completed_at on bd_tasks
  for each row execute function public.trg_bd_task_cleanup_notifications();

-- 2. Trigger: delete notifications when a bd_initiative is deleted or done
create or replace function public.trg_bd_initiative_cleanup_notifications()
returns trigger language plpgsql security definer as $$
begin
  if (TG_OP = 'DELETE') then
    delete from public.notifications
    where link_target = OLD.id::text
      and type = 'bd_initiative_overdue';
    return OLD;
  end if;
  -- UPDATE: initiative marked done
  if (NEW.status = 'done' and OLD.status <> 'done') then
    delete from public.notifications
    where link_target = NEW.id::text
      and type = 'bd_initiative_overdue';
  end if;
  return NEW;
end;
$$;

drop trigger if exists bd_initiative_cleanup_notifications on bd_initiatives;
create trigger bd_initiative_cleanup_notifications
  after delete or update of status on bd_initiatives
  for each row execute function public.trg_bd_initiative_cleanup_notifications();

-- 3. Trigger: delete notifications when a freelancer_assignment is deleted or completed
-- (only if table exists — it may not be deployed yet)
do $$
begin
  if to_regclass('public.freelancer_assignments') is not null then
    create or replace function public.trg_fl_assignment_cleanup_notifications()
    returns trigger language plpgsql security definer as $fn$
    begin
      if (TG_OP = 'DELETE') then
        delete from public.notifications
        where link_target = OLD.id::text
          and type in ('fl_assignment_overdue', 'fl_assignment_due');
        return OLD;
      end if;
      if (NEW.status = 'completed' and OLD.status <> 'completed') then
        delete from public.notifications
        where link_target = NEW.id::text
          and type in ('fl_assignment_overdue', 'fl_assignment_due');
      end if;
      return NEW;
    end;
    $fn$;

    drop trigger if exists fl_assignment_cleanup_notifications on freelancer_assignments;
    create trigger fl_assignment_cleanup_notifications
      after delete or update of status on freelancer_assignments
      for each row execute function public.trg_fl_assignment_cleanup_notifications();
  end if;
end;
$$;

-- 4. One-time cleanup: remove existing orphaned notifications
delete from public.notifications
where type in ('bd_task_overdue', 'bd_task_due')
  and link_target not in (select id::text from bd_tasks);

delete from public.notifications
where type = 'bd_initiative_overdue'
  and link_target not in (select id::text from bd_initiatives);

-- Freelancer orphans: just delete by type if table doesn't exist, else check properly
do $$
begin
  if to_regclass('public.freelancer_assignments') is not null then
    delete from public.notifications
    where type in ('fl_assignment_overdue', 'fl_assignment_due')
      and link_target not in (select id::text from freelancer_assignments);

    delete from public.notifications
    where type in ('fl_assignment_overdue', 'fl_assignment_due')
      and link_target in (
        select id::text from freelancer_assignments where status = 'completed'
      );
  else
    -- Table doesn't exist, so all freelancer notifications are orphaned
    delete from public.notifications
    where type in ('fl_assignment_overdue', 'fl_assignment_due');
  end if;
end;
$$;

-- Also clean up notifications for completed items that are still lingering
delete from public.notifications
where type in ('bd_task_overdue', 'bd_task_due')
  and link_target in (
    select id::text from bd_tasks where completed_at is not null
  );

delete from public.notifications
where type = 'bd_initiative_overdue'
  and link_target in (
    select id::text from bd_initiatives where status = 'done'
  );
