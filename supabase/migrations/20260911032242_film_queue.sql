-- Film Queue: Ideas → Film Queue pipeline (write → review → approve → pack →
-- film → edit) without a project card.
--
-- Every beat sheet gains the three-state status + scheduling fields; queue
-- membership is a separate film_queue_items row (only sheets enqueued from
-- Ideas enter the line). Sessions are manually dated; the 6am lock job packs
-- them and generates a call sheet + prompter script.

-- ── beat_sheets: status + scheduling fields ─────────────────────────────────
alter table public.beat_sheets
  add column if not exists status text not null default 'drafting',
  add column if not exists estimated_minutes integer,
  add column if not exists film_date date,
  add column if not exists approved_at timestamptz;

alter table public.beat_sheets
  add constraint beat_sheets_status_check
  check (status in ('drafting', 'ready_for_review', 'approved'));

-- ── film_sessions ───────────────────────────────────────────────────────────
-- One row per filming session. The next session is the earliest unlocked row
-- with session_date >= today. The 6am job locks the row dated today.
create table if not exists public.film_sessions (
  id            uuid primary key default gen_random_uuid(),
  session_date  date not null,
  locked_at     timestamptz,
  packed_minutes integer,
  packed_count  integer,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists film_sessions_date_idx
  on public.film_sessions(session_date, locked_at);

-- ── film_queue_items ────────────────────────────────────────────────────────
-- Queue membership + assignments. Assignments deliberately live here, not on
-- beat_sheets. `state` tracks the physical pipeline: queued (writing through
-- packing), filmed (sent to the editor — the edit pile), done (cut delivered).
create table if not exists public.film_queue_items (
  id             uuid primary key default gen_random_uuid(),
  beat_sheet_id  uuid not null unique references public.beat_sheets(id) on delete cascade,
  queue_type     text not null check (queue_type in ('mayday', 'tm_baseball', 'short_form', 'ad')),
  writer_id      uuid references public.profiles(id) on delete set null,
  editor_id      uuid references public.profiles(id) on delete set null,
  state          text not null default 'queued' check (state in ('queued', 'filmed', 'done')),
  session_id     uuid references public.film_sessions(id) on delete set null,
  slate_order    integer,
  video_url      text,
  cut_url        text,
  filmed_at      timestamptz,
  -- Carried over from the source idea so nothing is lost when the idea row is
  -- deleted on enqueue. Shown in the Film Queue item modal.
  source_context text,
  source_titles  jsonb not null default '[]'::jsonb,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists film_queue_items_state_idx
  on public.film_queue_items(state, session_id);

-- ── call_sheets ─────────────────────────────────────────────────────────────
-- Generated snapshot of a locked session. `items` freezes the packed sheets
-- (title, type, minutes, beats) so later edits don't rewrite history.
create table if not exists public.call_sheets (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid references public.film_sessions(id) on delete set null,
  session_date date not null,
  slate_count  integer not null default 0,
  items        jsonb not null default '[]'::jsonb,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists call_sheets_created_idx
  on public.call_sheets(created_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Staff read everywhere. Writes are admin-tier: assignment edits happen in the
-- Film Queue view (admins only), and the pipeline transitions run through edge
-- functions with the service role, which bypasses RLS.
alter table public.film_sessions enable row level security;
alter table public.film_queue_items enable row level security;
alter table public.call_sheets enable row level security;

create policy "staff read film sessions"
  on public.film_sessions for select
  using (public.is_staff(auth.uid()));

create policy "admin manage film sessions"
  on public.film_sessions for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "staff read film queue items"
  on public.film_queue_items for select
  using (public.is_staff(auth.uid()));

create policy "admin manage film queue items"
  on public.film_queue_items for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "staff read call sheets"
  on public.call_sheets for select
  using (public.is_staff(auth.uid()));

create policy "admin manage call sheets"
  on public.call_sheets for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── Ideas: the new "Ad" type tag ────────────────────────────────────────────
insert into public.idea_tags (label, color, position)
values ('Ad', '#38bdf8', 4)
on conflict (label) do nothing;
