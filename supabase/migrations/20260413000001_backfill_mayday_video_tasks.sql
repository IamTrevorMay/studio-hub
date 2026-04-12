-- Backfill personal_tasks for existing mayday_videos that don't have one yet
insert into public.personal_tasks (created_by, content, category, status, mayday_video_id, position)
select
  p.id,
  v.title,
  'production',
  'backlog',
  v.id,
  coalesce((
    select max(pt.position) + 1
    from public.personal_tasks pt
    where pt.created_by = p.id and pt.status = 'backlog'
  ), 0)
from public.mayday_videos v
cross join (select id from public.profiles where role = 'admin' limit 1) p
where v.is_archived = false
  and not exists (
    select 1 from public.personal_tasks pt where pt.mayday_video_id = v.id
  );
