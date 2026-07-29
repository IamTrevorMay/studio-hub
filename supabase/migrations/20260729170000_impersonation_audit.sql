-- Audit trail for admin "View as…" contractor impersonation (true-impersonation
-- feature). Every mint of a scoped contractor token is logged here. Rows are
-- inserted by the impersonate-contractor edge function (service role); admins
-- can read the trail. No client-side insert/update/delete policy.
create table if not exists public.impersonation_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  target_id uuid references public.profiles(id) on delete set null,
  target_role text,
  target_sub_role text,
  created_at timestamptz not null default now()
);

alter table public.impersonation_audit enable row level security;

drop policy if exists "admins read impersonation_audit" on public.impersonation_audit;
create policy "admins read impersonation_audit"
  on public.impersonation_audit for select
  using (public.is_admin(auth.uid()));

create index if not exists impersonation_audit_created_idx
  on public.impersonation_audit (created_at desc);
