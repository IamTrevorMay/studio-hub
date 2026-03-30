-- Add suggestions field to research_trends for topic recommendations with grades
alter table research_trends add column if not exists suggestions jsonb default '[]'::jsonb;
