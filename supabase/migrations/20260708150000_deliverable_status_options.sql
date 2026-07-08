-- Deliverables "Review" column becomes "Status" with a production-pipeline
-- option set: queued / writing / filming / ready_for_review / in_review /
-- complete. Existing values map onto the closest new stage.

alter table public.sponsor_deliverables
  drop constraint if exists sponsor_deliverables_review_status_check;

update public.sponsor_deliverables
   set review_status = case review_status
     when 'not_submitted' then 'queued'
     when 'pending'       then 'in_review'
     when 'accepted'      then 'complete'
     else review_status
   end
 where review_status in ('not_submitted', 'pending', 'accepted');

alter table public.sponsor_deliverables
  add constraint sponsor_deliverables_review_status_check
  check (review_status = any (array['queued', 'writing', 'filming', 'ready_for_review', 'in_review', 'complete']));

alter table public.sponsor_deliverables
  alter column review_status set default 'queued';
