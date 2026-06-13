create extension if not exists citext;

-- Mailer Phase 4 foundation: audiences, subscribers, campaigns with
-- block-based content, per-recipient send tracking, raw webhook events,
-- suppression list, and verified sender domains. RLS is admin-only for
-- v1 to match the rest of the admin-tools surface.

-- ── Audiences ────────────────────────────────────────────────
create table public.mailer_audiences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index mailer_audiences_created_by_idx on public.mailer_audiences(created_by);

-- ── Subscribers ──────────────────────────────────────────────
create type mailer_subscriber_status as enum
  ('active', 'unsubscribed', 'bounced', 'complained');

create table public.mailer_subscribers (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text,
  status mailer_subscriber_status not null default 'active',
  source text,
  custom_fields jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  unsubscribed_at timestamptz,
  bounced_at timestamptz
);
create index mailer_subscribers_status_idx on public.mailer_subscribers(status);

create table public.mailer_audience_subscribers (
  audience_id uuid not null references public.mailer_audiences(id) on delete cascade,
  subscriber_id uuid not null references public.mailer_subscribers(id) on delete cascade,
  added_at timestamptz default now(),
  primary key (audience_id, subscriber_id)
);
create index mailer_audience_subscribers_sub_idx on public.mailer_audience_subscribers(subscriber_id);

-- ── Campaigns ────────────────────────────────────────────────
create type mailer_campaign_status as enum
  ('draft', 'scheduled', 'sending', 'sent', 'failed', 'paused');

create table public.mailer_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null default '',
  preheader text,
  from_name text,
  from_email text,
  reply_to text,
  audience_id uuid references public.mailer_audiences(id) on delete set null,
  status mailer_campaign_status not null default 'draft',
  blocks jsonb not null default '[]'::jsonb,
  scheduled_at timestamptz,
  sent_at timestamptz,
  stats jsonb not null default jsonb_build_object(
    'recipients', 0,
    'delivered',  0,
    'opened',     0,
    'clicked',    0,
    'bounced',    0,
    'complained', 0,
    'unsubscribed', 0
  ),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index mailer_campaigns_status_idx on public.mailer_campaigns(status);
create index mailer_campaigns_scheduled_at_idx on public.mailer_campaigns(scheduled_at)
  where status = 'scheduled';

-- ── Per-recipient send rows ──────────────────────────────────
create type mailer_send_status as enum
  ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed');

create table public.mailer_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.mailer_campaigns(id) on delete cascade,
  subscriber_id uuid references public.mailer_subscribers(id) on delete set null,
  email citext not null,
  resend_id text,
  status mailer_send_status not null default 'queued',
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  created_at timestamptz default now()
);
create index mailer_sends_campaign_idx on public.mailer_sends(campaign_id);
create unique index mailer_sends_resend_id_idx on public.mailer_sends(resend_id)
  where resend_id is not null;
create unique index mailer_sends_campaign_email_idx on public.mailer_sends(campaign_id, email);

-- ── Raw webhook events ───────────────────────────────────────
create table public.mailer_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.mailer_campaigns(id) on delete cascade,
  send_id uuid references public.mailer_sends(id) on delete set null,
  event_type text not null,
  payload jsonb not null,
  url text,
  user_agent text,
  ip inet,
  created_at timestamptz default now()
);
create index mailer_events_campaign_idx on public.mailer_events(campaign_id);
create index mailer_events_send_idx on public.mailer_events(send_id);
create index mailer_events_type_idx on public.mailer_events(event_type);

-- ── Suppression list ─────────────────────────────────────────
create table public.mailer_suppressions (
  email citext primary key,
  reason text not null,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- ── Verified sender domains ──────────────────────────────────
create table public.mailer_sender_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  resend_domain_id text,
  verified_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- ── RLS: admin-only ──────────────────────────────────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'mailer_audiences',
    'mailer_subscribers',
    'mailer_audience_subscribers',
    'mailer_campaigns',
    'mailer_sends',
    'mailer_events',
    'mailer_suppressions',
    'mailer_sender_domains'
  ]) loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('create policy "admin all" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());', t);
  end loop;
end$$;

create or replace function public.mailer_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

create trigger mailer_audiences_touch
  before update on public.mailer_audiences
  for each row execute function public.mailer_touch_updated_at();
create trigger mailer_campaigns_touch
  before update on public.mailer_campaigns
  for each row execute function public.mailer_touch_updated_at();
