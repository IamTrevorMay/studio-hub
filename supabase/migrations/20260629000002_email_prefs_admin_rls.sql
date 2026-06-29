-- Allow admins to read and write email_notification_preferences for any user,
-- so they can manage contractor notification settings.

create policy "admin_read" on public.email_notification_preferences
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "admin_insert" on public.email_notification_preferences
  for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "admin_update" on public.email_notification_preferences
  for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "admin_delete" on public.email_notification_preferences
  for delete to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
