-- The semimonthly-payroll-task cron + create_payroll_tasks() fn were
-- superseded by the automations system (workflow slug='payroll', is_active=
-- false by seed_automations_and_cleanup migration). Cron currently fires
-- daily, logs a warning, and exits — wastes invocations and risks
-- double-payroll if anyone re-enables the workflow.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'semimonthly-payroll-task') then
    perform cron.unschedule('semimonthly-payroll-task');
  end if;
end $$;

drop function if exists public.create_payroll_tasks();
