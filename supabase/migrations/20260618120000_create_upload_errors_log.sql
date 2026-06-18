-- Captures freelancer/deliverable upload failures so admins can diagnose
-- without needing the user to relay the error toast. Written from both the
-- browser (source='client') and the drive-upload-init edge function
-- (source='server', includes the verbose Drive error the browser never sees).

create table if not exists public.upload_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  source text not null default 'client',        -- 'client' | 'server'
  phase text,                                    -- 'init' | 'put' | 'unknown'
  filename text,
  mime_type text,
  size_bytes bigint,
  status_code int,
  error text,
  context jsonb,
  created_at timestamptz not null default now()
);

create index if not exists upload_errors_created_at_idx on public.upload_errors (created_at desc);

alter table public.upload_errors enable row level security;

-- Any signed-in user may log their own upload failure (client-side capture).
create policy "users insert own upload errors"
  on public.upload_errors for insert
  to authenticated
  with check (user_id = auth.uid());

-- Admins can read the log.
create policy "admins read upload errors"
  on public.upload_errors for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
