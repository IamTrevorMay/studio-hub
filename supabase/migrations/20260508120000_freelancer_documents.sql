-- Freelancer documents table
create table public.freelancer_documents (
  id uuid primary key default gen_random_uuid(),
  freelancer_id uuid not null references public.profiles(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  title text not null,
  description text,
  doc_type text not null default 'signing' check (doc_type in ('signing', 'reference')),
  storage_path text not null,
  file_name text not null,
  signed_at timestamptz,
  signed_name text,
  signature_storage_path text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS
alter table public.freelancer_documents enable row level security;

-- Admins: full access
create policy "Admins full access on freelancer_documents"
  on public.freelancer_documents for all
  using ((select role from public.profiles where id = auth.uid()) = 'admin');

-- Freelancers: read own docs
create policy "Freelancers read own docs"
  on public.freelancer_documents for select
  using (freelancer_id = auth.uid());

-- Freelancers: sign (update) own docs
create policy "Freelancers sign own docs"
  on public.freelancer_documents for update
  using (freelancer_id = auth.uid())
  with check (freelancer_id = auth.uid());

-- Add title column to invitations table
alter table public.invitations add column if not exists title text;

-- Storage bucket for freelancer documents
insert into storage.buckets (id, name, public)
values ('freelancer-documents', 'freelancer-documents', false)
on conflict (id) do nothing;

-- Admin upload policy
create policy "Admins upload freelancer docs"
  on storage.objects for insert
  with check (bucket_id = 'freelancer-documents' and (select role from public.profiles where id = auth.uid()) = 'admin');

-- Admin + owner read policy
create policy "Read freelancer docs"
  on storage.objects for select
  using (bucket_id = 'freelancer-documents' and (
    (select role from public.profiles where id = auth.uid()) = 'admin'
    or auth.uid()::text = (storage.foldername(name))[1]
  ));

-- Admin delete policy
create policy "Admins delete freelancer docs"
  on storage.objects for delete
  using (bucket_id = 'freelancer-documents' and (select role from public.profiles where id = auth.uid()) = 'admin');
