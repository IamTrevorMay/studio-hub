# Harbor Meeting Mode — Implementation Plan

**Status:** on branch `claude/harbor-meeting-mode` (build passes) ·
**Decided:** 2026-07-31
- **Phase A** — committed (`ab42c7b6`). Migration + `harbor-join` deploy still needed to run live.
- **Phase B** — implemented, NOT committed. Frontend-only (present-mode screen share);
  no migration or edge fn — just an SPA redeploy. Chose replaceTrack "present mode"
  (your tile becomes your screen) over a separate simultaneous tile: zero renegotiation,
  zero new signaling; a true second tile pairs with the SFU in Phase D.
- **Phases C–D** — pending.

## Deploy checklist for Phase A (before it works live)
- [ ] Apply migration `20260731120000_harbor_meeting_mode.sql` to the main Supabase project.
- [ ] `supabase functions deploy harbor-join --no-verify-jwt` (guest-side mode/cap/skip-lobby).
- [ ] Rebuild/redeploy the SPA (Vercel) so HarborHome/Room/Join/CallStage ship.
- [ ] Smoke test: create a meeting → guest link joins straight in (no green room);
      host toggles recording on → REC works → NAS archive picks it up.

Add a Google-Meet-lite **meeting mode** to Harbor. A meeting is Harbor with the
podcast ceremony turned *off* (no green room, no forced recording) and a couple
of meeting behaviors turned *on* (skip-lobby join, optional recording,
screen share, calendar-spawned instances). ~80% of the work reuses the existing
mesh (`src/lib/harbor/mesh.js`), signaling (`signaling.js`), and call UI
(`CallStage.js`), all of which are already mode-agnostic.

## Locked decisions

1. **Mesh now, SFU later.** Ship on the existing 4-person P2P mesh (raise cap to
   ~6). Introduce a transport seam now so an SFU (LiveKit) slots in additively
   later. Mesh holds to ~5–6 participants.
2. **Recording optional, off by default** in meetings. Reuses the existing
   per-track record → chunk-upload → NAS-archiver pipeline unchanged.
3. **Staff + external guest link.** Reuse the tokenized `guest_token` +
   `harbor-join` + resume-key flow, but meeting-mode joins skip the green room.
4. **Calendar-spawned meetings.** Toggling "meeting" on a Bridge calendar event
   auto-generates a linked Harbor meeting instance (via DB trigger).

## Architectural context

- **Bridge and Harbor are the same SPA.** Bridge is the null-segment "classic
  tab world" (owns Calendar at `src/pages/Calendar.js`); Harbor is the
  `/harbor` segment. They share auth, the Supabase client, and routing — a
  calendar event can deep-link straight to `/harbor/room/<sessionId>`.
- **Transport seam (do this in Phase A):** `CallStage` should consume a generic
  "room" object exposing `onRemoteStream(clientId, stream)` /
  `onPeerState(clientId, state)` / `onPeerRemoved(clientId)` and the
  `setAudioEnabled` / `setVideoEnabled` / `close` surface that `HarborMesh`
  already exposes. `HarborMesh` becomes one implementation; a future
  `HarborSfuRoom` (LiveKit) becomes a sibling chosen by participant count or a
  session flag. Keep the Supabase Realtime signaling channel either way.

---

## Phase A — Meeting mode on the existing mesh (ships first)

### A1. Schema — `harbor_sessions` (new migration)
```sql
alter table public.harbor_sessions
  add column if not exists mode text not null default 'recording'
    check (mode in ('recording','meeting')),
  add column if not exists record_enabled boolean not null default false,
  add column if not exists max_participants smallint not null default 4,
  add column if not exists calendar_event_id uuid;  -- FK added in Phase C
```
- Every existing session defaults to `mode='recording'` → **zero behavior change**
  for podcasts.
- `record_enabled` is honored only in meeting mode; recording mode records as today.
- `max_participants` makes the cap data, not code (meeting rows seed ~6).

### A2. De-hardcode the 4-participant cap
The cap is baked in three spots — thread `session.max_participants` through all:
- `src/lib/harbor/mesh.js` — `HARBOR_MAX_PARTICIPANTS` / `MAX_REMOTE_PEERS`
  become constructor params derived from the session.
- `supabase/functions/harbor-join/index.ts` — `MAX_PARTICIPANTS` reads
  `session.max_participants` from the row it already fetches.
- `src/pages/harbor/HarborJoin.js` — the "session is full (4 max)" copy.

### A3. Join flow — skip the green room in meeting mode
- `harbor-join` already selects the session; add `mode`, `max_participants` to
  that select. On fresh join: insert `state: session.mode === 'meeting'
  ? 'admitted' : 'lobby'`. Everything else (resume-key, capacity recheck,
  uniform 404s) is untouched.
- Staff still join via RLS as today.

### A4. Create + list meetings — `HarborHome.js`
- "Start meeting" button → inserts `harbor_sessions {mode:'meeting',
  max_participants:6, title}`, then opens the room.
- Distinguish meeting vs recording sessions in the list (mode pill).

### A5. Room UI — `HarborRoom.js` / `CallStage.js`
- Read `session.mode`. Meeting mode: no green-room panel, no producer/guest
  framing, hide the recording controls unless `record_enabled`.
- Recording toggle (host) flips `record_enabled` + sends the existing `'record'`
  command — the rest of the record/upload/archive path is already built and
  mode-agnostic.

**A ships:** a usable staff-or-guest meeting room on existing infra, optional
recording, up to ~6 people.

---

## Phase B — Screen share (net-new; useful in both modes)
- `navigator.mediaDevices.getDisplayMedia()` → add the screen track to each peer
  connection. The mesh's perfect-negotiation already renegotiates on a mid-call
  track add, so no signaling changes.
- `CallStage`: a "Share screen" button + a dedicated screen tile (or
  promote-to-main layout). Stop-share removes the track.
- Confirmed absent today (no `getDisplayMedia` in the codebase).

---

## Phase C — Bridge calendar integration (auto-generate)

### C1. Schema — `calendar_events`
```sql
alter table public.calendar_events
  add column if not exists is_meeting boolean not null default false,
  add column if not exists harbor_session_id uuid
    references public.harbor_sessions(id) on delete set null;
-- and the reciprocal FK from A1:
alter table public.harbor_sessions
  add constraint harbor_sessions_calendar_event_fk
  foreign key (calendar_event_id) references public.calendar_events(id)
  on delete set null;
```
> Note: `calendar_events` is not created by any in-repo migration (older/external
> table) — verify its exact name/columns in the live DB before writing this.

### C2. Auto-generate via trigger (preferred over client-side)
- `AFTER UPDATE ON calendar_events`: when `is_meeting` flips `false → true` and
  `harbor_session_id IS NULL`, insert a `harbor_sessions` row
  (`mode='meeting'`, title from the event, `calendar_event_id = NEW.id`,
  `max_participants=6`) and set `NEW.harbor_session_id`.
- Trigger (not button code) means it fires no matter what sets the flag —
  including the Google Calendar sync path.

### C3. Calendar UI — `Calendar.js` (+ `CalendarMobile.js`)
- "Video meeting" toggle in the event editor → sets `is_meeting`.
- On a meeting event: a **Join** button (deep-link `/harbor/room/<harbor_session_id>`)
  and a copyable external **guest link** (from the session's `guest_token`).

### C4. Decision to lock before building
- **Recurring events:** one persistent room reused each occurrence (recommended
  start) vs. a fresh session per occurrence.

---

## Phase D — SFU + TURN (scale-up, when meetings outgrow the mesh)
- **SFU:** add LiveKit (self-hostable as an always-on daemon alongside the
  server-infrastructure stack; good React SDK). `HarborSfuRoom` implements the
  Phase-A transport interface; chosen by participant count or a session flag.
  Signaling channel + presence carry over.
- **TURN (cross-cutting, do sooner if NAT failures bite):** stand up `coturn`
  and append its config at the `>>> TURN CONFIG POINT <<<` in
  `mesh.js`'s `ICE_SERVERS`. Nothing else in the mesh changes. STUN-only today
  means strict-NAT users see `connectionState 'failed'` — more painful for
  frequent internal meetings than for occasional podcast guests.

---

## Suggested sequence
**A → B → C** delivers a fully usable, calendar-spawned meeting tool on existing
infrastructure. **D + TURN** is the scale-up when you actually need >6 people or
hit NAT failures.

## Files touched (quick map)
| Area | Files |
| --- | --- |
| Schema | new migrations for `harbor_sessions` (A1) + `calendar_events`/trigger (C1–C2) |
| Mesh cap | `src/lib/harbor/mesh.js`, `supabase/functions/harbor-join/index.ts`, `src/pages/harbor/HarborJoin.js` |
| Room | `src/pages/harbor/HarborRoom.js`, `src/pages/harbor/CallStage.js`, `src/pages/harbor/HarborHome.js` |
| Screen share | `src/pages/harbor/CallStage.js` (+ mesh track add) |
| Calendar | `src/pages/Calendar.js`, `src/pages/CalendarMobile.js` |
| Transport seam | `src/lib/harbor/mesh.js` (interface) + future `sfu.js` |
