-- Sponsor Reads: ad copy/scripts per sponsor with payout amounts
create table public.sponsor_reads (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references public.sponsors(id) on delete cascade,
  payout numeric(10,2),
  long_form text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.sponsor_reads enable row level security;

create policy "Authenticated users can select sponsor_reads"
  on public.sponsor_reads for select to authenticated using (true);

create policy "Authenticated users can insert sponsor_reads"
  on public.sponsor_reads for insert to authenticated with check (true);

create policy "Authenticated users can update sponsor_reads"
  on public.sponsor_reads for update to authenticated using (true) with check (true);

create policy "Authenticated users can delete sponsor_reads"
  on public.sponsor_reads for delete to authenticated using (true);
