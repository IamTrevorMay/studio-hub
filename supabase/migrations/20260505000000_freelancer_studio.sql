-- Freelancer Studio: tables, RLS, helpers, cron
-- ============================================

-- 0. Helper function
create or replace function public.is_freelancer(uid uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = uid and role = 'freelancer');
$$;

-- 1. freelancer_profiles
create table public.freelancer_profiles (
  id          uuid primary key references public.profiles(id) on delete cascade,
  specialty   text check (specialty in ('editor','designer','writer','other')),
  hourly_rate numeric(10,2),
  phone       text,
  payment_method  text,
  payment_details text,
  bio         text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.freelancer_profiles enable row level security;

create policy "admin full access on freelancer_profiles"
  on public.freelancer_profiles for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "freelancer select own profile"
  on public.freelancer_profiles for select
  using (id = auth.uid() and public.is_freelancer(auth.uid()));

create policy "freelancer update own profile"
  on public.freelancer_profiles for update
  using (id = auth.uid() and public.is_freelancer(auth.uid()))
  with check (id = auth.uid());

-- 2. freelancer_assignments
create table public.freelancer_assignments (
  id              uuid primary key default gen_random_uuid(),
  freelancer_id   uuid not null references public.profiles(id),
  title           text not null,
  description     text,
  assignment_type text check (assignment_type in ('edit','design','write','other')) default 'other',
  status          text check (status in ('assigned','in_progress','completed')) default 'assigned',
  due_date        date,
  pay_amount      numeric(10,2),
  project_id      uuid references public.projects(id) on delete set null,
  deliverable_id  uuid references public.sponsor_deliverables(id) on delete set null,
  mayday_video_id uuid references public.mayday_videos(id) on delete set null,
  completed_at    timestamptz,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.freelancer_assignments enable row level security;

create policy "admin full access on freelancer_assignments"
  on public.freelancer_assignments for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "freelancer select own assignments"
  on public.freelancer_assignments for select
  using (freelancer_id = auth.uid() and public.is_freelancer(auth.uid()));

create policy "freelancer update own assignment status"
  on public.freelancer_assignments for update
  using (freelancer_id = auth.uid() and public.is_freelancer(auth.uid()))
  with check (freelancer_id = auth.uid());

-- 3. freelancer_assignment_comments
create table public.freelancer_assignment_comments (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.freelancer_assignments(id) on delete cascade,
  author_id     uuid not null references public.profiles(id),
  body          text not null,
  created_at    timestamptz default now()
);

alter table public.freelancer_assignment_comments enable row level security;

create policy "admin full access on freelancer_assignment_comments"
  on public.freelancer_assignment_comments for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "freelancer select comments on own assignments"
  on public.freelancer_assignment_comments for select
  using (
    public.is_freelancer(auth.uid()) and
    exists (
      select 1 from public.freelancer_assignments
      where id = assignment_id and freelancer_id = auth.uid()
    )
  );

create policy "freelancer insert comments on own assignments"
  on public.freelancer_assignment_comments for insert
  with check (
    author_id = auth.uid() and
    public.is_freelancer(auth.uid()) and
    exists (
      select 1 from public.freelancer_assignments
      where id = assignment_id and freelancer_id = auth.uid()
    )
  );

create policy "freelancer update own comments"
  on public.freelancer_assignment_comments for update
  using (author_id = auth.uid() and public.is_freelancer(auth.uid()))
  with check (author_id = auth.uid());

-- 4. freelancer_hours
create table public.freelancer_hours (
  id            uuid primary key default gen_random_uuid(),
  freelancer_id uuid not null references public.profiles(id),
  period_start  date not null,
  period_end    date not null,
  total_hours   numeric(6,2) not null default 0,
  notes         text,
  submitted_at  timestamptz default now(),
  reviewed_by   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  constraint period_order check (period_start < period_end),
  constraint unique_period unique (freelancer_id, period_start, period_end)
);

alter table public.freelancer_hours enable row level security;

create policy "admin full access on freelancer_hours"
  on public.freelancer_hours for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "freelancer select own hours"
  on public.freelancer_hours for select
  using (freelancer_id = auth.uid() and public.is_freelancer(auth.uid()));

create policy "freelancer insert own hours"
  on public.freelancer_hours for insert
  with check (freelancer_id = auth.uid() and public.is_freelancer(auth.uid()));

create policy "freelancer update own unreviewed hours"
  on public.freelancer_hours for update
  using (
    freelancer_id = auth.uid()
    and public.is_freelancer(auth.uid())
    and reviewed_at is null
  )
  with check (freelancer_id = auth.uid());

-- 5. Add role column to invitations
alter table public.invitations add column if not exists role text default 'member';

-- 6. Notification cron: emit due/overdue assignment notifications
create or replace function public.fl_emit_due_notifications()
returns void language plpgsql security definer as $$
declare
  r record;
begin
  -- Overdue assignments (past due, not completed)
  for r in
    select id, freelancer_id, title
    from public.freelancer_assignments
    where status != 'completed'
      and due_date < current_date
  loop
    -- Skip if already notified today
    if not exists (
      select 1 from public.notifications
      where user_id = r.freelancer_id
        and type = 'fl_assignment_overdue'
        and link_target = r.id::text
        and created_at::date = current_date
    ) then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (
        r.freelancer_id,
        'fl_assignment_overdue',
        'Overdue Assignment',
        'Assignment "' || r.title || '" is past due.',
        'fl_dashboard',
        r.id::text
      );
    end if;
  end loop;

  -- Due today assignments (not completed)
  for r in
    select id, freelancer_id, title
    from public.freelancer_assignments
    where status != 'completed'
      and due_date = current_date
  loop
    if not exists (
      select 1 from public.notifications
      where user_id = r.freelancer_id
        and type = 'fl_assignment_due'
        and link_target = r.id::text
        and created_at::date = current_date
    ) then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (
        r.freelancer_id,
        'fl_assignment_due',
        'Assignment Due Today',
        'Assignment "' || r.title || '" is due today.',
        'fl_dashboard',
        r.id::text
      );
    end if;
  end loop;
end;
$$;

-- Schedule cron job: daily at 15:00 UTC (8am PT)
select cron.schedule(
  'fl-emit-due-notifications',
  '0 15 * * *',
  $$select public.fl_emit_due_notifications();$$
);
