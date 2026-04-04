-- Report Configs: admin-defined recurring report definitions
create table if not exists report_configs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  slug text not null unique,
  data_source_type text not null check (data_source_type in ('rss', 'triton_api', 'supabase_query')),
  data_source_config jsonb not null default '{}'::jsonb,
  prompt_template text not null default '',
  output_format text not null default 'markdown' check (output_format in ('html', 'markdown', 'json')),
  schedule text,
  delivery jsonb not null default '{"inbox": true, "email": false}'::jsonb,
  enabled boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table report_configs enable row level security;

create policy "Admins can read report_configs"
  on report_configs for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can insert report_configs"
  on report_configs for insert
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can update report_configs"
  on report_configs for update
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can delete report_configs"
  on report_configs for delete
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

-- Report Runs: generated report output per config per day
create table if not exists report_runs (
  id uuid primary key default gen_random_uuid(),
  report_config_id uuid not null references report_configs(id) on delete cascade,
  date date not null,
  title text,
  summary text,
  content text,
  source_count integer default 0,
  metadata jsonb default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  unique (report_config_id, date)
);

alter table report_runs enable row level security;

create policy "Admins can read report_runs"
  on report_runs for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can insert report_runs"
  on report_runs for insert
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can update report_runs"
  on report_runs for update
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
