-- Progress cards: tracks short-form video production pipeline
-- Cards are created/moved by sync-progress-cards edge function
-- based on Google Drive folder contents.

create table public.progress_cards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'editing'
    check (status in ('write_film','editing','ready','scheduled')),
  content_type text not null default 'short'
    check (content_type in ('short','long')),
  drive_file_id text,
  ready_drive_file_id text,
  moved_to_scheduled_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Unique on lowercase title among non-archived cards
create unique index progress_cards_title_uniq
  on public.progress_cards (lower(title))
  where archived_at is null;

-- Admin-only RLS
alter table public.progress_cards enable row level security;
create policy "admin_all" on public.progress_cards
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Cron: every 2 minutes
select cron.schedule(
  'sync-progress-cards',
  '*/2 * * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-progress-cards?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$cron$
);
