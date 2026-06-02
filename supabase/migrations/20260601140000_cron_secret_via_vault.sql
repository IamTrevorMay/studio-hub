-- Move CRON_SECRET out of hardcoded migration SQL into Supabase Vault.
--
-- PREREQUISITE (must run BEFORE this migration on any fresh database):
--   do $$
--   declare existing_id uuid;
--   begin
--     select id into existing_id from vault.secrets where name = 'cron_secret';
--     if existing_id is null then
--       perform vault.create_secret(
--         '<YOUR_CRON_SECRET>',
--         'cron_secret',
--         'Shared secret for pg_cron jobs + triggers to auth edge fn calls'
--       );
--     else
--       perform vault.update_secret(existing_id, '<YOUR_CRON_SECRET>');
--     end if;
--   end $$;
--
-- The value must match the CRON_SECRET env var on the edge functions.
--
-- Every pg_cron job and trigger function that calls an edge fn now reads
-- the secret at execution time via:
--   (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
--
-- Supersedes hardcoded secrets in:
--   20260328200001_cron_generate_trends.sql
--   20260404130000_cron_run_reports.sql
--   20260406120000_daily_graphics.sql
--   20260406130000_daily_graphics_posts.sql
--   20260410000001_cron_snapshot_daily_work.sql
--   20260512130000_rotate_cron_secret.sql
--   20260527130000_notify_fl_assignment_trigger.sql
--   20260530200000_mayday_video_triggers.sql
--   20260531153558_cron_drive_watch_poll.sql
--   20260601100000_create_automations.sql
--   (plus fn_campaign_brief_auto_complete, defined separately)

-- ─── Cron jobs ────────────────────────────────────────────────────────────

select cron.unschedule('daily-generate-trends');
select cron.schedule(
  'daily-generate-trends',
  '0 15 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/generate-trends?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$cron$
);

select cron.unschedule('run-reports');
select cron.schedule(
  'run-reports',
  '5 15 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/run-report?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$cron$
);

select cron.unschedule('daily-fetch-graphics');
select cron.schedule(
  'daily-fetch-graphics',
  '0 13 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/fetch-daily-graphics?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$cron$
);

select cron.unschedule('daily-post-graphics');
select cron.schedule(
  'daily-post-graphics',
  '15 13 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/post-daily-graphics?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$cron$
);

select cron.unschedule('nightly-snapshot-daily-work');
select cron.schedule(
  'nightly-snapshot-daily-work',
  '59 7 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/snapshot-daily-work?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$cron$
);

select cron.unschedule('minutely-drive-watch-poll');
select cron.schedule(
  'minutely-drive-watch-poll',
  '* * * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/drive-watch-poll?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$cron$
);

select cron.unschedule('hourly-run-automations');
select cron.schedule(
  'hourly-run-automations',
  '0 * * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/run-automations?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$cron$
);

-- ─── Trigger functions ────────────────────────────────────────────────────

create or replace function public.trg_fl_assignment_notify_new_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  should_notify boolean := false;
  v_secret text;
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

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  perform net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/notify-fl-assignment?secret=' || v_secret,
    body := jsonb_build_object('assignment_id', NEW.id::text),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return NEW;
end;
$$;

create or replace function public.trg_mayday_video_start()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  should_start boolean := false;
  v_secret text;
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

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  perform net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/workflow-internal?secret=' || v_secret,
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

create or replace function public.trg_mayday_video_match_film()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
begin
  if NEW.freelancer_id is null then
    return NEW;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  perform net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/workflow-internal?secret=' || v_secret,
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

create or replace function public.trg_mayday_video_match_wait()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
begin
  if NEW.status is distinct from 'completed' or OLD.status = 'completed' then
    return NEW;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  perform net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/workflow-internal?secret=' || v_secret,
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

create or replace function public.fn_campaign_brief_auto_complete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
begin
  if OLD.brief_url is null and NEW.brief_url is not null then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'cron_secret';

    perform net.http_post(
      url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/workflow-brief-complete?secret=' || v_secret,
      body := jsonb_build_object('campaign_id', NEW.id::text),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
  return NEW;
end;
$$;
