-- Image attachments for Messages (DMs) + Channels.
--   1. Dedicated public storage bucket `message-attachments`.
--   2. Per-user write RLS (path must start with the uploader's uid), public read.
--   3. Nullable `attachments` jsonb column on direct_messages + channel_messages,
--      holding an array of { url, name, width?, height? }. Multiple images per
--      message; content may be empty when at least one attachment is present.

-- ── Storage bucket (public) ────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', true)
on conflict (id) do nothing;

-- Uploaders may write only under their own uid folder:
--   `${auth.uid()}/${conversationOrChannelId}/${file}` → foldername[1] = uid.
drop policy if exists "message_attachments_insert" on storage.objects;
create policy "message_attachments_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read (public bucket — inline rendering via public URL).
drop policy if exists "message_attachments_select" on storage.objects;
create policy "message_attachments_select"
  on storage.objects for select
  to public
  using (bucket_id = 'message-attachments');

-- Owners can update / delete their own uploads.
drop policy if exists "message_attachments_update" on storage.objects;
create policy "message_attachments_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "message_attachments_delete" on storage.objects;
create policy "message_attachments_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Message columns ────────────────────────────────────────────────
alter table public.direct_messages  add column if not exists attachments jsonb;
alter table public.channel_messages add column if not exists attachments jsonb;
