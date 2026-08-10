-- Google Calendar → Studio pull-back sync (reverse direction).
--
-- Studio→Google already exists (google-calendar-sync, fired from Calendar.js on
-- discrete user actions). This adds the other direction: a polling job that reads
-- the mapped Google calendars and applies edits back onto calendar_events —
-- but ONLY for rows that Studio itself created and pushed, i.e. rows that already
-- carry a google_event_id. Google events with no matching row are ignored, so
-- nothing new is ever imported into Studio.
--
-- This table holds the per-(admin, calendar) incremental syncToken so each run
-- only asks Google for what changed since last time.

create table if not exists public.google_calendar_sync_state (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  google_calendar_id text not null,
  sync_token         text,
  last_synced_at     timestamptz,
  last_status        text,
  last_error         text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (user_id, google_calendar_id)
);

alter table public.google_calendar_sync_state enable row level security;

-- Admins can see their own sync state (Ops / AdminPanel surfacing). All writes
-- happen through the edge function under the service role, which bypasses RLS.
drop policy if exists "gcal_sync_state_select_own" on public.google_calendar_sync_state;
create policy "gcal_sync_state_select_own"
  on public.google_calendar_sync_state
  for select
  using (user_id = auth.uid() and public.is_admin(auth.uid()));

-- The pull job's hot path is "find the Studio row for this Google event id".
create index if not exists idx_calendar_events_google_event_id
  on public.calendar_events (google_event_id)
  where google_event_id is not null;
