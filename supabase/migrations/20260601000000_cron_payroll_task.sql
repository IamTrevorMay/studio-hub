-- Recurring payroll task: creates a workflow instance + active task in the
-- workflow engine's `tasks` table for every admin on the 1st and 15th of
-- each month. Runs daily at 14:00 UTC (7am PT); no-ops on other days.
-- De-dupes so re-runs are safe.

create or replace function public.create_payroll_tasks()
returns void
language plpgsql
security definer
as $$
declare
  today date := current_date;
  wf_id uuid;
  admin_row record;
  inst_id uuid;
begin
  -- Only act on the 1st and 15th
  if extract(day from today) not in (1, 15) then
    return;
  end if;

  -- Look up the payroll workflow
  select id into wf_id from public.workflows where slug = 'payroll' and is_active = true;
  if wf_id is null then
    raise warning 'Payroll workflow not found';
    return;
  end if;

  for admin_row in
    select p.id
    from public.profiles p
    where p.role = 'admin'
      -- skip if this admin already has an active payroll task created today
      and not exists (
        select 1 from public.tasks t
        join public.workflow_instances wi on wi.id = t.workflow_instance_id
        where wi.workflow_id = wf_id
          and t.assignee_id = p.id
          and t.step_key = 'run_payroll'
          and t.status = 'active'
          and t.created_at::date = today
      )
  loop
    -- Create workflow instance
    insert into public.workflow_instances (workflow_id, status, context, started_by)
    values (wf_id, 'active', jsonb_build_object('admin_id', admin_row.id), admin_row.id)
    returning id into inst_id;

    -- Create the single active task
    insert into public.tasks (workflow_instance_id, step_key, title, description, assignee_id, status, position)
    values (inst_id, 'run_payroll', 'Run Payroll', 'Process payroll for this pay period.', admin_row.id, 'active', 0);
  end loop;
end;
$$;

select cron.schedule(
  'semimonthly-payroll-task',
  '0 14 * * *',
  $$select public.create_payroll_tasks();$$
);
