-- Ashley analytics reads. VERSIONED — many rows per week_start; Refresh inserts a
-- new working version, never overwrites. `points` holds the tactical, per-surface
-- diagnostics as a JSON array; each point carries a benchmark date-stamp and
-- reserved action-target fields so a point can be turned into a task or logged as
-- a Business Dev decision. "Save" (is_saved=true) pins a version and freezes its
-- per-point action state so a later Refresh can't clobber an actioned read.
create table if not exists public.ashley_reads (
  id             uuid primary key default gen_random_uuid(),
  week_start     date not null,
  week_end       date not null,
  version_number int not null,           -- 1-based, per week_start (see unique index)
  is_saved       boolean not null default false,  -- pinned by admin "Save"
  label          text,                   -- optional human label for a saved version
  -- Which surfaces this read covers, e.g. ['yt_long','yt_short','tiktok'].
  surfaces       text[] not null default '{}',
  headline       text,                   -- one punchy sentence for the whole week
  -- points: array of objects — schema in spec §4.4. Kept as jsonb (not a child
  -- table) because points are read/rendered as a unit and never queried individually.
  points         jsonb not null default '[]'::jsonb,
  -- coverage/quality flags so the UI can render honesty banners like weekly-report.
  meta           jsonb not null default '{}'::jsonb,  -- { generation_failed?, ctr_available?, data_completeness_pct }
  model          text,                   -- CLAUDE_MODEL used, for auditability
  generated_by   text not null default 'cron' check (generated_by in ('cron','admin')),
  generated_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- Unique version per week — mirrors script_review_versions_review_version_uniq.
-- Next version_number is computed read-max-then-insert; the racing loser fails
-- with 23505 and the caller recomputes + retries (see edge-fn storage-write spec §4.5).
create unique index if not exists ashley_reads_week_version_uniq
  on public.ashley_reads (week_start, version_number);

-- Fast "latest working version for this week" and "saved versions" lookups.
create index if not exists ashley_reads_week_idx
  on public.ashley_reads (week_start, version_number desc);
create index if not exists ashley_reads_saved_idx
  on public.ashley_reads (week_start) where is_saved;

alter table public.ashley_reads enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'ashley_reads_admin_all' and tablename = 'ashley_reads'
  ) then
    create policy "ashley_reads_admin_all" on public.ashley_reads
      for all using (
        exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      );
  end if;
end $$;
