-- Create beat_sheet_folders table for dynamic folder management
create table if not exists beat_sheet_folders (
  id text primary key,
  name text not null,
  position int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Seed existing folders
insert into beat_sheet_folders (id, name, position) values
  ('mayday', 'Mayday', 0),
  ('tm_baseball', 'TM Baseball', 1),
  ('ideas', 'Ideas', 2)
on conflict (id) do nothing;

-- RLS: all authenticated users can manage folders (matches beat_sheets policy)
alter table beat_sheet_folders enable row level security;

create policy "Authenticated users can read folders"
  on beat_sheet_folders for select
  to authenticated
  using (true);

create policy "Authenticated users can insert folders"
  on beat_sheet_folders for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update folders"
  on beat_sheet_folders for update
  to authenticated
  using (true);

create policy "Authenticated users can delete folders"
  on beat_sheet_folders for delete
  to authenticated
  using (true);

-- Add to realtime publication
alter publication supabase_realtime add table beat_sheet_folders;
