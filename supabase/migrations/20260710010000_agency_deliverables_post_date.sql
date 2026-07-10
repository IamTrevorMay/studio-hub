-- Expose the linked video event's date on agency_deliverables so the portal
-- can show a Post Date column. Only the event's start_date leaks through —
-- agency accounts still cannot read calendar_events directly (RLS excludes
-- them), and the view runs with owner privileges behind is_agency/is_admin.
CREATE OR REPLACE VIEW public.agency_deliverables
WITH (security_barrier) AS
SELECT d.id, d.title, d.deliverable_type, d.channel, d.platforms,
       d.status, d.review_status, d.film_status,
       d.due_date, d.slot_date, d.delivered, d.completed_at,
       d.created_at, d.updated_at, d.campaign_id, d.sponsor_id,
       c.name AS brand_name, s.name AS sponsor_name,
       ev.start_date AS post_date
FROM public.sponsor_deliverables d
LEFT JOIN public.sponsor_campaigns c ON c.id = d.campaign_id
LEFT JOIN public.sponsors s ON s.id = d.sponsor_id
LEFT JOIN public.calendar_events ev ON ev.id = d.video_event_id
WHERE public.is_agency(auth.uid()) OR public.is_admin(auth.uid());
