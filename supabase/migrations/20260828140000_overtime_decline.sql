-- ============================================================
-- Overtime approval: make Decline mean something
--
-- Completing a confirm_overtime task already flips the linked window to
-- 'approved' (fl_overtime_task_completed). Declining one only took the task
-- off that admin's plate — the approval stayed 'pending' and sat in everyone
-- else's queue forever. Now a decline is the explicit "no": it marks the
-- window declined and clears the sibling tasks, mirroring the approve path.
--
-- Pay impact of a decline is nil by design: compute_freelancer_pay only pays
-- the overtime multiplier when status = 'approved', so a declined window is
-- paid at the normal rate, exactly like an untouched pending one.
-- ============================================================

alter table public.contractor_overtime_approvals
  add column if not exists declined_by uuid references public.profiles(id) on delete set null,
  add column if not exists declined_at timestamptz;

-- Bounded recursion, same shape as fl_overtime_task_completed: siblings flip
-- to 'declined', but the approval is no longer 'pending' so the guard exits.
create or replace function public.fl_overtime_task_declined()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  appr record;
begin
  if NEW.related_entity_type is distinct from 'overtime_approval'
     or NEW.related_entity_id is null then
    return NEW;
  end if;
  if NEW.status <> 'declined' or OLD.status = 'declined' then
    return NEW;
  end if;

  select * into appr
    from public.contractor_overtime_approvals
   where id = NEW.related_entity_id
   for update;
  if not found or appr.status <> 'pending' then
    return NEW;
  end if;

  update public.contractor_overtime_approvals
     set status = 'declined',
         declined_by = NEW.assignee_id,
         declined_at = now()
   where id = appr.id;

  update public.tasks
     set status = 'declined', completed_at = now()
   where related_entity_type = 'overtime_approval'
     and related_entity_id = appr.id
     and id <> NEW.id
     and status in ('pending', 'active', 'on_hold');

  return NEW;
end;
$$;

drop trigger if exists fl_overtime_task_declined on public.tasks;
create trigger fl_overtime_task_declined
  after update on public.tasks
  for each row execute function public.fl_overtime_task_declined();

revoke execute on function public.fl_overtime_task_declined() from anon, authenticated, public;
