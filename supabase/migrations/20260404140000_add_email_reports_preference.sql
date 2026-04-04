-- Add email reports opt-in to profiles
alter table profiles add column if not exists email_reports_enabled boolean not null default false;

-- Default admins to enabled
update profiles set email_reports_enabled = true where role = 'admin';
