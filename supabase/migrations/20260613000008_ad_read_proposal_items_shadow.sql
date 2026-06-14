-- Shadow migration for ad_read_proposal_items.
--
-- This table exists in production but its original CREATE was never
-- captured in the migration history (likely added via the Supabase
-- dashboard back when the proposals feature shipped). Deliverables.js
-- + MyTasks.js both read from it, so any fresh environment (CI, a new
-- branch, a local reset) would 404 on those queries.
--
-- We use `create table if not exists` + idempotent policy creation so
-- this migration is a no-op against any environment that already has
-- the table, but reconstructs it cleanly otherwise. Schema mirrors the
-- live production definition exactly: pk(id), FK proposal_id →
-- ad_read_proposals(id) on cascade delete, four authenticated-only
-- RLS policies.

create table if not exists public.ad_read_proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.ad_read_proposals(id) on delete cascade,
  title text not null,
  deliverable_type text not null,
  channel text,
  due_month text,
  pay numeric,
  position integer not null default 0,
  created_at timestamptz default now()
);

alter table public.ad_read_proposal_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='ad_read_proposal_items'
      and policyname='Authenticated users can view proposal items'
  ) then
    create policy "Authenticated users can view proposal items"
      on public.ad_read_proposal_items for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='ad_read_proposal_items'
      and policyname='Authenticated users can create proposal items'
  ) then
    create policy "Authenticated users can create proposal items"
      on public.ad_read_proposal_items for insert to authenticated with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='ad_read_proposal_items'
      and policyname='Authenticated users can update proposal items'
  ) then
    create policy "Authenticated users can update proposal items"
      on public.ad_read_proposal_items for update to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='ad_read_proposal_items'
      and policyname='Authenticated users can delete proposal items'
  ) then
    create policy "Authenticated users can delete proposal items"
      on public.ad_read_proposal_items for delete to authenticated using (true);
  end if;
end$$;
