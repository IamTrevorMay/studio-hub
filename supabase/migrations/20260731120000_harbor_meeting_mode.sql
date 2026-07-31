-- Harbor meeting mode (Phase A) — add a session mode alongside the existing
-- podcast/remote-recording flow.
--
-- A 'meeting' session is Google-Meet-lite: guests skip the green room (they're
-- admitted on join, not parked in the lobby), recording defaults OFF (the host
-- can toggle it on, reusing the same per-track pipeline), and the seat cap is
-- larger than a podcast's 4. Existing sessions default to mode 'recording', so
-- their behavior is unchanged. See HARBOR_MEETING_MODE_PLAN.md.

alter table public.harbor_sessions
  add column if not exists mode text not null default 'recording'
    check (mode in ('recording','meeting')),
  add column if not exists record_enabled boolean not null default false,
  add column if not exists max_participants smallint not null default 4
    check (max_participants between 2 and 16),
  -- Link back to the Bridge calendar event that spawned this meeting (Phase C).
  -- The reciprocal FK + calendar_events columns are added in the Phase C
  -- migration so this one stays self-contained.
  add column if not exists calendar_event_id uuid;

comment on column public.harbor_sessions.mode is
  'recording = podcast/remote-recording (green room + on-demand recording); meeting = Google-Meet-lite (skip lobby, recording off by default).';
comment on column public.harbor_sessions.record_enabled is
  'Meeting mode only: host opt-in to the per-track recording pipeline. Ignored in recording mode (which always records on demand).';
comment on column public.harbor_sessions.max_participants is
  'Seat cap enforced by harbor-join and the WebRTC mesh. 4 for recording; ~6 for meetings on the P2P mesh (raise once an SFU lands).';

-- RLS unchanged: the staff all-columns policies from Phase 1 already cover the
-- new columns, and harbor-join writes with the service role.
