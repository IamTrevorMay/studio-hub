-- Multi-source support: array of {type, config} objects
alter table report_configs add column if not exists data_sources jsonb;

-- Migrate existing single-source data into new array format
update report_configs
set data_sources = jsonb_build_array(
  jsonb_build_object('type', data_source_type, 'config', data_source_config)
)
where data_sources is null and data_source_type is not null;

-- Subscribe page customization
alter table report_configs add column if not exists subscribe_headline text;
alter table report_configs add column if not exists subscribe_description text;
alter table report_configs add column if not exists subscribe_accent_color text;
alter table report_configs add column if not exists subscribe_logo_url text;

-- Always HTML output now
alter table report_configs drop constraint if exists report_configs_output_format_check;
update report_configs set output_format = 'html' where output_format != 'html';
alter table report_configs alter column output_format set default 'html';

-- Relax old single-source constraint (kept for backward compat)
alter table report_configs drop constraint if exists report_configs_data_source_type_check;
