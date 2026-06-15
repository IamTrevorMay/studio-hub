-- Add content_type column to freelancer_assignments
-- 'video' = requires file submission via Drive upload (existing behavior)
-- 'podcast' = completed externally, just needs manual sign-off
alter table freelancer_assignments
  add column content_type text not null default 'video'
  check (content_type in ('video', 'podcast'));
