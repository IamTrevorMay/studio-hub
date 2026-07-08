-- Push notifications for new direct messages ("Messages & Channels" category).
--
-- Deliberately does NOT insert into public.notifications: the bell dropdown
-- lists recent rows regardless of read state, and Messages already has its
-- own unread badge — a bell entry per DM would flood the list. Instead each
-- new DM is forwarded straight to the send-push edge function as a synthetic
-- notification (type 'message'), one per recipient with a push subscription.
-- send-push applies the recipient's mobile "messages" category pref; desktop
-- OS notifications fire client-side off the direct_messages realtime stream
-- (NotificationContext).

create or replace function public.forward_dm_to_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_name text;
  recipient uuid;
begin
  select coalesce(nullif(nickname, ''), nullif(full_name, ''), 'Someone')
    into sender_name
    from public.profiles
   where id = new.user_id;

  for recipient in
    select cp.user_id
      from public.conversation_participants cp
     where cp.conversation_id = new.conversation_id
       and cp.user_id <> new.user_id
       and exists (select 1 from public.push_subscriptions s where s.user_id = cp.user_id)
  loop
    perform net.http_post(
      url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := jsonb_build_object('notification', jsonb_build_object(
        'id', new.id,
        'user_id', recipient,
        'type', 'message',
        'title', 'New message from ' || sender_name,
        'body', left(coalesce(new.content, ''), 100),
        'link_tab', 'messages'
      ))
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists direct_messages_push_trigger on public.direct_messages;
create trigger direct_messages_push_trigger
  after insert on public.direct_messages
  for each row
  execute function public.forward_dm_to_push();
