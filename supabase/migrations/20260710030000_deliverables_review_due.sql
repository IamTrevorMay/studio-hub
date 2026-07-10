-- "Review Due" — date the ad must be submitted for review by. Set by staff
-- on the Deliverables page; agency portal shows it read-only via the view.
ALTER TABLE public.sponsor_deliverables
  ADD COLUMN IF NOT EXISTS review_due date;

CREATE OR REPLACE VIEW public.agency_deliverables
WITH (security_barrier) AS
SELECT d.id, d.title, d.deliverable_type, d.channel, d.platforms,
       d.status, d.review_status, d.film_status,
       d.due_date, d.slot_date, d.delivered, d.completed_at,
       d.created_at, d.updated_at, d.campaign_id, d.sponsor_id,
       c.name AS brand_name, s.name AS sponsor_name,
       ev.start_date AS post_date,
       d.video_url,
       d.review_due
FROM public.sponsor_deliverables d
LEFT JOIN public.sponsor_campaigns c ON c.id = d.campaign_id
LEFT JOIN public.sponsors s ON s.id = d.sponsor_id
LEFT JOIN public.calendar_events ev ON ev.id = d.video_event_id
WHERE public.is_agency(auth.uid()) OR public.is_admin(auth.uid());
