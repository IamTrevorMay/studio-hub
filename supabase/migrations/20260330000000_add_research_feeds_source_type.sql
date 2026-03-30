-- Add source_type to research_feeds to distinguish news vs newsletter sources
alter table research_feeds add column if not exists source_type text not null default 'news' check (source_type in ('news', 'newsletter'));

-- Enable RLS on research_feeds if not already enabled
alter table research_feeds enable row level security;

-- Allow authenticated users to read all feeds
create policy "Authenticated users can read feeds"
  on research_feeds for select
  to authenticated
  using (true);

-- Allow authenticated users to insert feeds
create policy "Authenticated users can insert feeds"
  on research_feeds for insert
  to authenticated
  with check (true);

-- Allow authenticated users to delete feeds they manage
create policy "Authenticated users can delete feeds"
  on research_feeds for delete
  to authenticated
  using (true);

-- Allow authenticated users to update feeds
create policy "Authenticated users can update feeds"
  on research_feeds for update
  to authenticated
  using (true);
