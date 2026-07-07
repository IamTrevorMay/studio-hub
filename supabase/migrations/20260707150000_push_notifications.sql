-- Web Push notifications: per-user category prefs + per-device subscriptions
-- + trigger that forwards new notifications rows to the send-push edge function.

-- Per-user notification preferences (sparse opt-outs):
--   { "desktop": { "tasks": false }, "mobile": { "contractors": false } }
-- Missing keys mean enabled. Read by NotificationContext (desktop) and
-- the send-push edge function (mobile).
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- One row per browser/device push subscription.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  platform text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Forward each new notification to the send-push edge function, but only
-- when the recipient has at least one push subscription (skips the HTTP
-- call for everyone else). The edge function validates x-cron-secret,
-- applies mobile category prefs, and prunes dead subscriptions.
create extension if not exists pg_net;

create or replace function public.forward_notification_to_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then
    perform net.http_post(
      url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := jsonb_build_object('notification', to_jsonb(new))
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_push_trigger on public.notifications;
create trigger notifications_push_trigger
  after insert on public.notifications
  for each row
  execute function public.forward_notification_to_push();
