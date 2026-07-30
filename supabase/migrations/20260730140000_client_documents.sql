-- Client Portal part 5: documents.
-- client_documents table (admin-issued signing/reference docs + client
-- self-uploads), a dedicated private client-documents bucket, a contract-claim
-- RPC for the signup flow, and a client branch in get_notification_summary.

-- 1. Table.
create table public.client_documents (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.profiles(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  title       text not null,
  description text,
  doc_type    text not null default 'signing' check (doc_type in ('signing','reference','upload')),
  storage_path text not null,
  file_name   text not null,
  signed_at   timestamptz,
  signed_name text,
  signature_storage_path text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index client_documents_client_idx on public.client_documents(client_id);

alter table public.client_documents enable row level security;

create policy "admin full access on client_documents" on public.client_documents
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "client read own docs" on public.client_documents
  for select using (client_id = auth.uid());
create policy "client insert own uploads" on public.client_documents
  for insert with check (client_id = auth.uid() and public.is_client(auth.uid())
                         and uploaded_by = auth.uid() and doc_type = 'upload');
create policy "client update own docs" on public.client_documents
  for update using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "client delete own uploads" on public.client_documents
  for delete using (client_id = auth.uid() and doc_type = 'upload' and uploaded_by = auth.uid());

-- Signing docs: non-admins may only touch the attestation fields.
create or replace function public.client_doc_lock_fields()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if public.is_admin(auth.uid()) then
    return NEW;
  end if;
  if OLD.doc_type in ('signing','reference') then
    if NEW.client_id     is distinct from OLD.client_id
      or NEW.uploaded_by is distinct from OLD.uploaded_by
      or NEW.title       is distinct from OLD.title
      or NEW.description is distinct from OLD.description
      or NEW.doc_type    is distinct from OLD.doc_type
      or NEW.storage_path is distinct from OLD.storage_path
      or NEW.file_name   is distinct from OLD.file_name
    then
      raise exception 'Only the signature fields may be updated on studio documents';
    end if;
  end if;
  return NEW;
end;
$$;
create trigger client_doc_lock_fields_trg
  before update on public.client_documents
  for each row execute function public.client_doc_lock_fields();

-- 2. Private bucket. Path conventions: <clientId>/... for issued docs and
-- self-uploads; pending/... for invite-time contracts uploaded before the
-- client account exists.
insert into storage.buckets (id, name, public)
values ('client-documents', 'client-documents', false)
on conflict (id) do nothing;

create policy "client-docs admin insert" on storage.objects for insert
  with check (bucket_id = 'client-documents' and public.is_admin(auth.uid()));
create policy "client-docs client upload own folder" on storage.objects for insert
  with check (bucket_id = 'client-documents'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.is_client(auth.uid()));
create policy "client-docs read" on storage.objects for select
  using (bucket_id = 'client-documents' and (
    public.is_admin(auth.uid())
    or (storage.foldername(name))[1] = auth.uid()::text));
create policy "client-docs admin delete" on storage.objects for delete
  using (bucket_id = 'client-documents' and public.is_admin(auth.uid()));
create policy "client-docs client delete own uploads" on storage.objects for delete
  using (bucket_id = 'client-documents'
         and (storage.foldername(name))[1] = auth.uid()::text
         and public.is_client(auth.uid()));
-- Invite-time contract stays under pending/; the owner may read it once a
-- client_documents row of theirs references that exact path.
create policy "client-docs read own pending contract" on storage.objects for select
  using (bucket_id = 'client-documents'
         and (storage.foldername(name))[1] = 'pending'
         and exists (select 1 from public.client_documents cd
                     where cd.client_id = auth.uid() and cd.storage_path = name));

-- 3. Contract claim RPC (called by AuthPage setup after a client accepts an
-- invite). Server-side, so no fragile download/re-upload dance and no need for
-- the invitee to read the invitations table.
create or replace function public.claim_client_contract()
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_email text;
  v_inv record;
begin
  if not public.is_client(auth.uid()) then
    return null;
  end if;
  select email into v_email from profiles where id = auth.uid();
  if v_email is null then
    return null;
  end if;
  select invited_by, contract_storage_path, contract_file_name, contract_needs_signing
    into v_inv
    from invitations
   where lower(email) = lower(v_email)
     and role = 'client'
     and contract_storage_path is not null
   order by created_at desc
   limit 1;
  if not found then
    return null;
  end if;
  if not exists (select 1 from client_documents
                 where client_id = auth.uid()
                   and storage_path = v_inv.contract_storage_path) then
    insert into client_documents (client_id, uploaded_by, title, doc_type, storage_path, file_name)
    values (auth.uid(),
            coalesce(v_inv.invited_by, auth.uid()),
            coalesce(v_inv.contract_file_name, 'Contract'),
            case when coalesce(v_inv.contract_needs_signing, true) then 'signing' else 'reference' end,
            v_inv.contract_storage_path,
            coalesce(v_inv.contract_file_name, 'contract.pdf'));
  end if;
  return jsonb_build_object('storage_path', v_inv.contract_storage_path,
                            'file_name', v_inv.contract_file_name);
end;
$$;
revoke execute on function public.claim_client_contract() from anon;

-- 4. get_notification_summary: current live body (20260729120000) + client
-- unsigned-docs branch.
CREATE OR REPLACE FUNCTION public.get_notification_summary(p_user_id uuid, p_role text, p_dashboard_last_seen timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  result jsonb;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_announcement_count int := 0; v_notification_count int := 0; v_proposal_count int := 0;
  v_unsigned_doc_count int := 0; v_stuck_comment_count int := 0; v_fl_comment_count int := 0;
  v_task_count int := 0; v_assignment_count int := 0;
begin
  p_user_id := auth.uid();
  if p_user_id is null then
    return jsonb_build_object('unread_announcement_count',0,'unread_notification_count',0,'pending_proposal_count',0,'unsigned_doc_count',0,'stuck_comment_count',0,'fl_comment_count',0,'my_task_count',0,'new_assignment_count',0,'agency_unresolved_count',0);
  end if;
  select role into p_role from public.profiles where id = p_user_id;
  select count(*) into v_announcement_count from announcements a
    where a.target_date = v_today and not exists (select 1 from announcement_reads ar where ar.announcement_id = a.id and ar.user_id = p_user_id);
  select count(*) into v_notification_count from notifications where user_id = p_user_id and is_read = false;
  select count(*) into v_proposal_count from ad_read_proposals where status = 'pending';
  if p_role in ('freelancer','contractor') then
    select count(*) into v_unsigned_doc_count from contractor_documents where contractor_id = p_user_id and doc_type = 'signing' and signed_at is null;
  end if;
  if p_role = 'client' then
    select count(*) into v_unsigned_doc_count from client_documents where client_id = p_user_id and doc_type = 'signing' and signed_at is null;
  end if;
  if p_role = 'admin' then
    select count(*) into v_stuck_comment_count from notifications where user_id = p_user_id and type = 'fl_stuck' and is_read = false;
    select count(*) into v_fl_comment_count from notifications where user_id = p_user_id and type = 'fl_comment' and is_read = false;
  end if;
  select count(*) into v_task_count from tasks
    where assignee_id = p_user_id
      and status in ('pending','active','on_hold')
      and (snoozed_until is null or snoozed_until < now())
      and coalesce(count_in_badge, true) = true;
  if p_role in ('freelancer','contractor') then
    select count(*) into v_assignment_count from contractor_assignments where contractor_id = p_user_id and status = 'assigned';
  end if;
  result := jsonb_build_object('unread_announcement_count',v_announcement_count,'unread_notification_count',v_notification_count,'pending_proposal_count',v_proposal_count,'unsigned_doc_count',v_unsigned_doc_count,'stuck_comment_count',v_stuck_comment_count,'fl_comment_count',v_fl_comment_count,'my_task_count',v_task_count,'new_assignment_count',v_assignment_count,'agency_unresolved_count',0);
  return result;
end; $function$;

notify pgrst, 'reload schema';
