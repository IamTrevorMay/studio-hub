-- Harbor: auto-end abandoned sessions, and stop deletes that would strand
-- recordings.
--
-- Background. The archiver only considers sessions with status='ended'. Two
-- ways a session never gets there:
--   1. Recording works while a session is still 'scheduled', and the UI only
--      offered an End control in 'live' — so it could capture gigabytes and
--      have no exit. (Fixed client-side in CallStage.js alongside this.)
--   2. The host closes the tab instead of pressing End. Nothing server-side
--      ever reconciled that, so the chunks sat in the capture buffer forever.
--
-- This migration handles (2), which no client fix can cover.

-- ── 1. Sweeper ─────────────────────────────────────────────────────────
--
-- Ends sessions that clearly ran and then went quiet.
--
-- Deliberately conservative: a session is only a candidate if it HAS TRACKS.
-- A 'scheduled' session with no tracks is a booking for a future show — that
-- is exactly what harbor_sessions.scheduled_at is for — and auto-ending those
-- would cancel next week's podcast.
--
-- Idle threshold is 12h, comfortably past harbor-track's 6h ENDED_GRACE_MS so
-- we never end a session while a guest's flush is still landing. The archiver
-- then waits its own 6h after ended_at, so the earliest a file moves is ~18h
-- after the last byte arrived.
create or replace function public.harbor_end_idle_sessions(p_idle_hours int default 12)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ended int;
begin
  with candidates as (
    select s.id,
           greatest(
             coalesce(max(t.updated_at), s.created_at),
             coalesce(s.started_at, s.created_at)
           ) as last_activity
    from public.harbor_sessions s
    join public.harbor_tracks t on t.session_id = s.id
    where s.status in ('scheduled', 'live')
    group by s.id, s.started_at, s.created_at
  )
  update public.harbor_sessions s
     set status   = 'ended',
         -- Stamp the end at the last real activity, not now(). The archiver
         -- measures its grace from ended_at, and the NAS folder is named from
         -- it — a session recorded last night should file under last night.
         ended_at = c.last_activity
    from candidates c
   where s.id = c.id
     and c.last_activity < now() - make_interval(hours => p_idle_hours)
     and s.status in ('scheduled', 'live');

  get diagnostics v_ended = row_count;

  if v_ended > 0 then
    raise notice 'harbor_end_idle_sessions: ended % idle session(s)', v_ended;
  end if;
  return v_ended;
end;
$$;

comment on function public.harbor_end_idle_sessions(int) is
  'Ends Harbor sessions that have tracks but have been idle past the threshold, so the NAS archiver can pick them up. Sessions with no tracks (future bookings) are never touched.';

revoke all on function public.harbor_end_idle_sessions(int) from public, anon, authenticated;

-- Hourly. The archiver polls every 5 minutes anyway, so this only needs to be
-- frequent enough that nothing waits a whole day to become eligible.
select cron.unschedule('harbor-end-idle-sessions')
where exists (select 1 from cron.job where jobname = 'harbor-end-idle-sessions');

select cron.schedule(
  'harbor-end-idle-sessions',
  '20 * * * *',
  $$select public.harbor_end_idle_sessions();$$
);

-- ── 2. Delete guard ────────────────────────────────────────────────────
--
-- Storage objects are not foreign-keyed to harbor_sessions, so deleting a
-- session row does NOT delete its recordings — it orphans them. The archiver's
-- session sweep is keyed on the session row, so once it is gone nothing can
-- ever find or clean those objects. That is how the 19-byte Phase-2 test
-- object became permanently unreachable (see api/harbor/README.md).
--
-- Block the delete while any track still holds bytes that never made it to the
-- NAS. Archived and empty tracks are fine — their chunks are already purged or
-- never existed.
create or replace function public.harbor_guard_session_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unsaved int;
  v_bytes   bigint;
begin
  select count(*), coalesce(sum(t.bytes_uploaded), 0)
    into v_unsaved, v_bytes
    from public.harbor_tracks t
   where t.session_id = old.id
     and t.nas_path is null
     and coalesce(t.bytes_uploaded, 0) > 0;

  if v_unsaved > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Cannot delete Harbor session "%s": %s recording(s) totalling %s MB have not been archived to the NAS yet.',
        old.title, v_unsaved, round(v_bytes / 1048576.0)
      ),
      hint = 'End the session and let the archiver run, or confirm the files exist on the NAS. Deleting now would orphan the recordings permanently.';
  end if;

  return old;
end;
$$;

drop trigger if exists harbor_sessions_guard_delete on public.harbor_sessions;
create trigger harbor_sessions_guard_delete
  before delete on public.harbor_sessions
  for each row
  execute function public.harbor_guard_session_delete();

comment on function public.harbor_guard_session_delete() is
  'Blocks deleting a Harbor session while any track still has bytes in the capture buffer and no nas_path — deleting would orphan those objects with nothing left to reference them.';
