-- Report Sections: reusable building blocks that compose a report.
-- Each section owns its own data source and rendering logic (prompt or template).

create table if not exists report_sections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  kind text not null default 'custom' check (kind in ('brief', 'cards', 'trends', 'news', 'custom')),
  data_source jsonb not null default '{}'::jsonb,
  prompt_template text not null default '',
  render_template text not null default '',
  is_seed boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists report_sections_kind_idx on report_sections(kind);

alter table report_sections enable row level security;

create policy "Admins can read report_sections"
  on report_sections for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can insert report_sections"
  on report_sections for insert
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can update report_sections"
  on report_sections for update
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "Admins can delete report_sections"
  on report_sections for delete
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin') and is_seed = false);
