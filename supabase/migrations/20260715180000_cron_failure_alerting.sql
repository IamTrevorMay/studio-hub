-- H5: active cron-failure alerting + run-history prune + get_cron_status admin guard.
-- Applied to prod via MCP apply_migration 2026-07-15. Kept here for the git record.
--
-- Problem: ~37 pg_cron jobs run unattended. get_cron_status() (Ops page) is
-- passive — a failure is only seen if an admin opens the page. check-data-integrity
-- covers analytics DATA gaps only, not job failures. So a silently-dead sync-*/
-- mailer/graphics cron (the sync-youtube "More Mayday" staleness class) is invisible.
-- Also: get_cron_status() was executable by anon/authenticated/PUBLIC, and
-- cron.job_run_details grows unbounded.

-- H5a. Daily scan: any pg_cron job that failed in the last 24h → an admin bell
-- notification (deduped per admin, per job, per PT-day). Then prune old history.
create or replace function public.alert_failed_cron_jobs()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fail record;
  rec_admin record;
  pt_today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  for fail in
    select coalesce(j.jobname, d.jobid::text) as job,
           count(*) as fails,
           max(d.end_time) as last_fail
    from cron.job_run_details d
    left join cron.job j on j.jobid = d.jobid   -- job_run_details has no jobname column
    where d.status = 'failed'
      and d.start_time > now() - interval '24 hours'
    group by coalesce(j.jobname, d.jobid::text)
  loop
    for rec_admin in
      select id from public.profiles where public.is_admin(id)
    loop
      insert into public.notifications (user_id, type, title, body, link_tab, is_read, created_at)
      select rec_admin.id,
             'cron_failure',
             'Scheduled job failing: ' || fail.job,
             fail.fails || ' failed run(s) in the last 24h (last at ' ||
               to_char(fail.last_fail at time zone 'America/Los_Angeles', 'Mon DD HH24:MI') ||
               ' PT). Check Ops -> cron status and the edge function logs.',
             'ops',
             false,
             now()
      where not exists (
        select 1 from public.notifications n
        where n.user_id = rec_admin.id
          and n.type = 'cron_failure'
          and n.title = 'Scheduled job failing: ' || fail.job
          and (n.created_at at time zone 'America/Los_Angeles')::date = pt_today
      );
    end loop;
  end loop;

  -- Keep the run-history table bounded.
  delete from cron.job_run_details where end_time < now() - interval '7 days';
end;
$$;

revoke all on function public.alert_failed_cron_jobs() from public;

-- Daily at 16:30 UTC (~9:30am PT) — after the 01:00 UTC overnight sync jobs run,
-- so their failures are caught the same morning.
select cron.schedule('alert-failed-cron-jobs', '30 16 * * *', $$select public.alert_failed_cron_jobs();$$);

-- H5b. get_cron_status() was callable by anon/authenticated/PUBLIC. It reads the
-- cron schema under SECURITY DEFINER. Add an admin guard: non-admins get zero rows
-- (the Ops page runs as an authenticated admin, so it is unaffected). Grants stay
-- as-is so the admin session can still call it.
create or replace function public.get_cron_status()
returns table(jobid bigint, jobname text, schedule text, active boolean, last_run_at timestamp with time zone, last_status text, last_return_message text)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    d.start_time as last_run_at,
    d.status as last_status,
    d.return_message as last_return_message
  from cron.job j
  left join lateral (
    select start_time, status, return_message
    from cron.job_run_details
    where jobid = j.jobid
    order by start_time desc
    limit 1
  ) d on true
  where public.is_admin(auth.uid())   -- admin-only; non-admins get zero rows
  order by j.jobname;
$function$;
