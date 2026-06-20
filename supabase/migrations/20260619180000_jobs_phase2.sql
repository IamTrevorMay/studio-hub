-- Jobs board phase 2: applicant status tracking, screening questions, audit
-- trail, editable email templates, interview scheduling, and view analytics.

-- ─── Columns ─────────────────────────────────────────────────────────────
alter table public.job_applications
  add column if not exists status_token        text,
  add column if not exists answers             jsonb not null default '[]'::jsonb,
  add column if not exists interview_at         timestamptz,
  add column if not exists interview_event_id   text,
  add column if not exists interview_calendar_id text;

create unique index if not exists idx_job_applications_status_token
  on public.job_applications (status_token) where status_token is not null;

alter table public.job_listings
  add column if not exists screening_questions jsonb not null default '[]'::jsonb;

-- ─── Audit trail ─────────────────────────────────────────────────────────
create table if not exists public.job_application_events (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications(id) on delete cascade,
  type           text not null,   -- created | status_change | interview_scheduled | accepted | declined
  from_status    text,
  to_status      text,
  actor_id       uuid references public.profiles(id) on delete set null,
  meta           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_job_application_events_app
  on public.job_application_events (application_id, created_at);

-- ─── Editable email templates (keyed singletons) ─────────────────────────
create table if not exists public.job_email_templates (
  key        text primary key,   -- confirmation | decline | interview
  subject    text not null,
  body_html  text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- ─── View analytics ──────────────────────────────────────────────────────
create table if not exists public.job_listing_views (
  id         bigint generated always as identity primary key,
  listing_id uuid references public.job_listings(id) on delete set null,
  slug       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_job_listing_views_created on public.job_listing_views (created_at);
create index if not exists idx_job_listing_views_listing on public.job_listing_views (listing_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────
alter table public.job_application_events enable row level security;
alter table public.job_email_templates    enable row level security;
alter table public.job_listing_views      enable row level security;

create policy job_app_events_admin_all on public.job_application_events
  for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy job_email_templates_admin_all on public.job_email_templates
  for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy job_listing_views_admin_read on public.job_listing_views
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
-- Inserts (views) and status lookups come via service-role edge fns; no public policy.

-- ─── Seed default email templates ────────────────────────────────────────
insert into public.job_email_templates (key, subject, body_html) values
  ('confirmation',
   'We received your application — {{listing_title}}',
   '<p>Hi {{first_name}},</p><p>Thanks for applying for <strong>{{listing_title}}</strong>. We''ve received your application and our team will review it. If it''s a fit, we''ll be in touch.</p><p>You can check your status anytime here: <a href="{{status_url}}">{{status_url}}</a></p><p>— The Mayday Team</p>'),
  ('decline',
   'Update on your application — {{listing_title}}',
   '<p>Hi {{first_name}},</p><p>Thank you for your interest in <strong>{{listing_title}}</strong> and for taking the time to apply. After careful review, we''ve decided not to move forward at this time.</p><p>We genuinely appreciate it and encourage you to apply for future roles that fit.</p><p>— The Mayday Team</p>'),
  ('interview',
   'Interview invitation — {{listing_title}}',
   '<p>Hi {{first_name}},</p><p>Great news — we''d like to interview you for <strong>{{listing_title}}</strong>. Your interview is scheduled for <strong>{{interview_time}}</strong>, and a calendar invite is on its way.</p><p>Track your status anytime: <a href="{{status_url}}">{{status_url}}</a></p><p>— The Mayday Team</p>')
on conflict (key) do nothing;
