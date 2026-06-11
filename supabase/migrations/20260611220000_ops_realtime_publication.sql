-- Add Ops dashboard tables to the realtime publication so the page receives
-- live updates instead of relying solely on tab-refocus or polling.

alter publication supabase_realtime add table public.ingestion_logs;
alter publication supabase_realtime add table public.platform_accounts;
