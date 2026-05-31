-- Reusable Google Drive folder watch primitive.
--   drive_watches — one row per actively-monitored folder
--   drive_events  — every detected file event in a watched folder
--
-- v1 runs in 'poll' mode: a pg_cron job calls drive-watch-poll every minute,
-- which lists each folder for files with modifiedTime > last_seen_time and
-- inserts events. Schema also supports 'watch' mode (Drive files.watch push
-- notifications) for future use once the webhook domain is verified — the
-- channel_id / resource_id / webhook_token / expiration columns sit unused
-- in poll mode.
--
-- Consumer features (workflow tasks, ingest pipelines, etc.) subscribe to
-- drive_events via Realtime or poll where processed_at is null.

-- ─── Tables ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.drive_watches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id       text NOT NULL,
  label           text NOT NULL,
  mode            text NOT NULL DEFAULT 'poll' CHECK (mode IN ('poll','watch')),
  channel_id      uuid,
  resource_id     text,
  webhook_token   text,
  expiration      timestamptz,
  last_seen_time  timestamptz NOT NULL DEFAULT now(),
  stopped_at      timestamptz,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_watches_active_folder
  ON public.drive_watches (folder_id) WHERE stopped_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_watches_channel ON public.drive_watches (channel_id);
CREATE INDEX IF NOT EXISTS idx_drive_watches_expiration ON public.drive_watches (expiration) WHERE stopped_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_watches_active_poll
  ON public.drive_watches (last_seen_time) WHERE stopped_at IS NULL AND mode = 'poll';

CREATE TABLE IF NOT EXISTS public.drive_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id                 uuid NOT NULL REFERENCES public.drive_watches(id) ON DELETE CASCADE,
  drive_file_id            text NOT NULL,
  file_name                text,
  mime_type                text,
  parent_folder_id         text,
  web_view_link            text,
  created_time             timestamptz,
  modified_time            timestamptz,
  event_type               text NOT NULL CHECK (event_type IN ('added','modified','trashed')),
  uploader_email           text,
  uploader_display_name    text,
  uploader_permission_id   text,
  payload                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watch_id, drive_file_id, event_type)
);
CREATE INDEX IF NOT EXISTS idx_drive_events_watch ON public.drive_events (watch_id);
CREATE INDEX IF NOT EXISTS idx_drive_events_unprocessed
  ON public.drive_events (created_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_events_uploader_email ON public.drive_events (uploader_email);

-- ─── RLS (admin-only) ────────────────────────────────────────
ALTER TABLE public.drive_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_events  ENABLE ROW LEVEL SECURITY;

CREATE POLICY drive_watches_admin_all ON public.drive_watches
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY drive_events_admin_all ON public.drive_events
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Edge functions (drive-watch-register, drive-watch-poll, drive-watch-stop)
-- use the service role to bypass RLS for inserts/updates.
