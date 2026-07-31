-- Harbor meeting mode (Phase C) — spawn a Harbor meeting from a Bridge
-- calendar event.
--
-- Toggling is_meeting on a calendar event auto-creates a linked meeting
-- session. Implemented as a trigger (not client code) so it fires regardless
-- of what sets the flag — the Calendar editor OR the Google Calendar sync
-- path. See HARBOR_MEETING_MODE_PLAN.md.

alter table public.calendar_events
  add column if not exists is_meeting boolean not null default false,
  add column if not exists harbor_session_id uuid
    references public.harbor_sessions(id) on delete set null;

-- Reciprocal FK for the calendar_event_id column Phase A added on
-- harbor_sessions (Phase A left it unconstrained so its migration stayed
-- self-contained). on delete set null: deleting the event orphans the session
-- (it may hold recordings) rather than cascading it away.
alter table public.harbor_sessions
  drop constraint if exists harbor_sessions_calendar_event_fk;
alter table public.harbor_sessions
  add constraint harbor_sessions_calendar_event_fk
  foreign key (calendar_event_id) references public.calendar_events(id)
  on delete set null;

-- Auto-generate the meeting session.
--   * SECURITY DEFINER so the insert into the staff-RLS'd harbor_sessions
--     succeeds no matter which staff user — or the service-role Google sync —
--     flipped the flag.
--   * AFTER (not BEFORE): the calendar_events row must already exist before we
--     point the new session's calendar_event_id FK at it. We then write
--     harbor_session_id back with a targeted UPDATE that does NOT touch
--     is_meeting, so `update of is_meeting` never re-fires this trigger — no
--     recursion, no infinite loop.
create or replace function public.harbor_ensure_meeting_session()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
begin
  -- guest_token + channel_secret come from their column defaults; recording
  -- defaults off (meeting mode); 6-seat cap matches the mesh ceiling.
  insert into public.harbor_sessions
    (title, mode, max_participants, record_enabled, created_by, calendar_event_id, scheduled_at)
  values
    (coalesce(nullif(btrim(new.title), ''), 'Meeting'), 'meeting', 6, false,
     new.created_by, new.id, new.start_date)
  returning id into v_session_id;

  update public.calendar_events
    set harbor_session_id = v_session_id
    where id = new.id;

  return null; -- AFTER trigger: return value ignored
end;
$$;

revoke execute on function public.harbor_ensure_meeting_session() from anon, public;

drop trigger if exists trg_harbor_ensure_meeting_session on public.calendar_events;
create trigger trg_harbor_ensure_meeting_session
  after insert or update of is_meeting on public.calendar_events
  for each row
  when (new.is_meeting is true and new.harbor_session_id is null)
  execute function public.harbor_ensure_meeting_session();
