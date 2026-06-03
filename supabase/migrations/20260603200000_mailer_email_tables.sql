-- Mayday Mailer (port of Triton's Emails tool). Admin-only tool per Q15.
-- Public endpoints (subscribe / unsubscribe / track / webhook) use the
-- service-role key from inside the Vercel functions and don't hit RLS.

-- ── email_products ──────────────────────────────────────────────────
create table public.email_products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text,
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.email_products enable row level security;
create policy email_products_admin_all on public.email_products
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── email_templates ─────────────────────────────────────────────────
create table public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.email_products(id) on delete cascade,
  name        text not null default 'Untitled',
  subject     text not null default '',
  preheader   text,
  blocks      jsonb not null default '[]'::jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index email_templates_product_id_updated_at_idx
  on public.email_templates (product_id, updated_at desc);
alter table public.email_templates enable row level security;
create policy email_templates_admin_all on public.email_templates
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── email_subscribers ──────────────────────────────────────────────
create table public.email_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  name            text,
  confirmed       boolean not null default false,
  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create unique index email_subscribers_email_lower_idx
  on public.email_subscribers ((lower(email)));
alter table public.email_subscribers enable row level security;
create policy email_subscribers_admin_all on public.email_subscribers
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── email_audiences ─────────────────────────────────────────────────
create table public.email_audiences (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.email_products(id) on delete cascade,
  name        text not null,
  description text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index email_audiences_product_id_idx on public.email_audiences (product_id);
alter table public.email_audiences enable row level security;
create policy email_audiences_admin_all on public.email_audiences
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── email_audience_members ─────────────────────────────────────────
create table public.email_audience_members (
  id            uuid primary key default gen_random_uuid(),
  audience_id   uuid not null references public.email_audiences(id) on delete cascade,
  subscriber_id uuid not null references public.email_subscribers(id) on delete cascade,
  added_at      timestamptz not null default now(),
  unique (audience_id, subscriber_id)
);
create index email_audience_members_audience_idx
  on public.email_audience_members (audience_id);
create index email_audience_members_subscriber_idx
  on public.email_audience_members (subscriber_id);
alter table public.email_audience_members enable row level security;
create policy email_audience_members_admin_all on public.email_audience_members
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── email_sends ─────────────────────────────────────────────────────
create table public.email_sends (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.email_products(id) on delete cascade,
  template_id     uuid references public.email_templates(id) on delete set null,
  audience_id     uuid references public.email_audiences(id) on delete set null,
  subject         text not null,
  status          text not null default 'scheduled'
                  check (status in ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_at    timestamptz,
  sent_at         timestamptz,
  recipient_count integer not null default 0,
  error_message   text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index email_sends_product_id_created_at_idx
  on public.email_sends (product_id, created_at desc);
create index email_sends_status_scheduled_at_idx
  on public.email_sends (status, scheduled_at);
alter table public.email_sends enable row level security;
create policy email_sends_admin_all on public.email_sends
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── email_events ────────────────────────────────────────────────────
create table public.email_events (
  id            bigint generated always as identity primary key,
  send_id       uuid not null references public.email_sends(id) on delete cascade,
  subscriber_id uuid references public.email_subscribers(id) on delete set null,
  type          text not null check (type in
                  ('sent','delivered','opened','clicked','bounced','complained','unsubscribed')),
  url           text,
  ip            inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index email_events_send_id_idx    on public.email_events (send_id, type);
create index email_events_created_at_idx on public.email_events (created_at desc);
alter table public.email_events enable row level security;
create policy email_events_admin_read on public.email_events
  for select using (public.is_admin(auth.uid()));

-- ── Touch updated_at on UPDATE ─────────────────────────────────────
create or replace function public.email_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin NEW.updated_at = now(); return NEW; end;
$$;
drop trigger if exists email_products_touch_updated_at on public.email_products;
create trigger email_products_touch_updated_at before update on public.email_products
  for each row execute function public.email_touch_updated_at();
drop trigger if exists email_templates_touch_updated_at on public.email_templates;
create trigger email_templates_touch_updated_at before update on public.email_templates
  for each row execute function public.email_touch_updated_at();
drop trigger if exists email_sends_touch_updated_at on public.email_sends;
create trigger email_sends_touch_updated_at before update on public.email_sends
  for each row execute function public.email_touch_updated_at();

-- ── Storage bucket for image blocks (public read; admin-only write) ──
insert into storage.buckets (id, name, public)
values ('email-assets', 'email-assets', true)
on conflict (id) do nothing;

create policy "email-assets read" on storage.objects
  for select using (bucket_id = 'email-assets');
create policy "email-assets admin write" on storage.objects
  for insert with check (
    bucket_id = 'email-assets' and public.is_admin(auth.uid())
  );
create policy "email-assets admin delete" on storage.objects
  for delete using (
    bucket_id = 'email-assets' and public.is_admin(auth.uid())
  );
