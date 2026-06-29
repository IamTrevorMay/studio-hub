-- Email notification preferences: per-user opt-in toggles for email alerts.
-- Each row maps a user to a trigger_key with an enabled flag.
-- Default state is OFF (no row = not subscribed).

create table public.email_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  trigger_key text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, trigger_key)
);

alter table public.email_notification_preferences enable row level security;

create policy "own_read"  on public.email_notification_preferences for select using (auth.uid() = user_id);
create policy "own_insert" on public.email_notification_preferences for insert with check (auth.uid() = user_id);
create policy "own_update" on public.email_notification_preferences for update using (auth.uid() = user_id);
create policy "own_delete" on public.email_notification_preferences for delete using (auth.uid() = user_id);

-- Cron: email contractors about assignments due tomorrow, daily at 15:00 UTC (8am PT).
do $$
begin
  perform cron.unschedule('email-due-soon-assignments');
exception when others then null;
end $$;

select cron.schedule(
  'email-due-soon-assignments', '0 15 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"cron": true, "trigger_key": "fl_assignment_due_soon"}'::jsonb
  )$cron$
);
