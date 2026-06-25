-- Backfill queue: tracks missing data days that need re-syncing.
create table if not exists sync_backfill_queue (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references platform_accounts(id) on delete cascade,
  target_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  retries int not null default 0,
  max_retries int not null default 3,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- Prevent duplicate entries for the same account+date
create unique index if not exists sync_backfill_queue_acct_date_idx
  on sync_backfill_queue (platform_account_id, target_date);

-- RLS: admin-only
DO $$ BEGIN
  alter table sync_backfill_queue enable row level security;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  create policy "admin_all_sync_backfill_queue"
    on sync_backfill_queue
    for all
    using (
      exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    )
    with check (
      exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
