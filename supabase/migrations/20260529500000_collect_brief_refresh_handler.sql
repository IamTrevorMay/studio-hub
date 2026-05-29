-- Set on_complete_handler for collect_brief so it refreshes deliverables
-- from the DB before the write_ad_reads fan-out. This ensures deliverables
-- added after proposal acceptance are included.
UPDATE public.workflow_steps
SET on_complete_handler = 'ad_read:refresh_deliverables'
WHERE step_key = 'collect_brief';
