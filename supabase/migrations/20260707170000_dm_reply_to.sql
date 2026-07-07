-- Reply-to on direct messages (iOS Messages-style quoted replies).
-- If the original is deleted the reply survives with reply_to_id null —
-- the UI shows "Original message deleted" for fetched-but-missing targets.
alter table public.direct_messages
  add column if not exists reply_to_id uuid references public.direct_messages(id) on delete set null;
