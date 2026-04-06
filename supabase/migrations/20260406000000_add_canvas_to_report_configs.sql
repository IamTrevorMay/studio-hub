-- Add canvas (ordered block array) to report_configs for the newsletter builder
alter table report_configs add column if not exists canvas jsonb;
