-- Reports are now composed of an ordered list of sections.
-- The old data_sources + prompt_template columns are kept nullable for backward
-- compatibility with existing runs, but the UI composes reports via section_ids.

alter table report_configs add column if not exists section_ids uuid[] not null default '{}';

-- Drop not-null on legacy columns so new configs can skip them
alter table report_configs alter column prompt_template drop not null;
alter table report_configs alter column data_source_type drop not null;
alter table report_configs alter column data_source_config drop not null;
