-- Per-user opt-in for browser desktop notifications (Notification API).
-- Toggled from the Dashboard settings modal; checked client-side before firing.
alter table public.profiles
  add column if not exists desktop_notifications_enabled boolean not null default false;
