-- Add source_type to research_feeds to distinguish news vs newsletter sources
alter table research_feeds add column if not exists source_type text not null default 'news' check (source_type in ('news', 'newsletter'));

-- Enable RLS on research_feeds if not already enabled
alter table research_feeds enable row level security;

-- Policies (skip if they already exist)
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'research_feeds' and policyname = 'Authenticated users can read feeds') then
    create policy "Authenticated users can read feeds" on research_feeds for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'research_feeds' and policyname = 'Authenticated users can insert feeds') then
    create policy "Authenticated users can insert feeds" on research_feeds for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'research_feeds' and policyname = 'Authenticated users can delete feeds') then
    create policy "Authenticated users can delete feeds" on research_feeds for delete to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'research_feeds' and policyname = 'Authenticated users can update feeds') then
    create policy "Authenticated users can update feeds" on research_feeds for update to authenticated using (true);
  end if;
end $$;
