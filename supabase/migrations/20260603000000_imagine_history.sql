-- Per-user history for the Graphics tool (ported from Triton's Imagine).
-- Each row records one exported render so the user can restore filters or
-- redownload the thumbnail later. Owner-only access; non-admin tier.

create table public.imagine_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  widget_id     text not null,
  title         text not null,
  filters       jsonb not null default '{}'::jsonb,
  size          jsonb not null default '{}'::jsonb,
  thumbnail_url text,
  created_at    timestamptz not null default now()
);

create index imagine_history_user_id_created_at_idx
  on public.imagine_history (user_id, created_at desc);

alter table public.imagine_history enable row level security;

create policy imagine_history_select_own on public.imagine_history
  for select using (user_id = auth.uid());

create policy imagine_history_insert_self on public.imagine_history
  for insert with check (user_id = auth.uid());

create policy imagine_history_delete_own on public.imagine_history
  for delete using (user_id = auth.uid());

-- Storage bucket for the thumbnails (public read so the UI can <img src=...>
-- without minting signed URLs every render).
insert into storage.buckets (id, name, public)
values ('imagine-thumbnails', 'imagine-thumbnails', true)
on conflict (id) do nothing;

create policy "imagine-thumbs read" on storage.objects
  for select using (bucket_id = 'imagine-thumbnails');

create policy "imagine-thumbs write" on storage.objects
  for insert with check (
    bucket_id = 'imagine-thumbnails' and auth.uid() is not null
  );

create policy "imagine-thumbs delete" on storage.objects
  for delete using (
    bucket_id = 'imagine-thumbnails' and owner = auth.uid()
  );
