-- Newsletter subscribers: external email recipients for reports
create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  report_config_id uuid references report_configs(id) on delete cascade,
  confirmed boolean not null default false,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (email, report_config_id)
);

alter table newsletter_subscribers enable row level security;

create policy "Admins can read newsletter_subscribers"
  on newsletter_subscribers for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can insert newsletter_subscribers"
  on newsletter_subscribers for insert
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can update newsletter_subscribers"
  on newsletter_subscribers for update
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can delete newsletter_subscribers"
  on newsletter_subscribers for delete
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
