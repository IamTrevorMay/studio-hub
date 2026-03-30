-- Admin goals: simple key-value goal tracking (e.g. "post X stories per day")
create table if not exists admin_goals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  label text not null,
  daily_target int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed with IG Stories goal
insert into admin_goals (name, label, daily_target)
values ('ig_stories', 'IG Stories', 1);

-- RLS: only admins can read/write
alter table admin_goals enable row level security;

create policy "Admins can read admin_goals"
  on admin_goals for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

create policy "Admins can update admin_goals"
  on admin_goals for update
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );
