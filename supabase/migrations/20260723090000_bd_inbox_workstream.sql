-- Allow 'inbox' as a bd_initiatives.workstream value.
-- Powers the Roadmap quick-capture flow: one-line quick-add inserts initiatives
-- with status='ideas' + workstream='inbox'; they surface in a per-phase Inbox
-- section and get triaged into a real workstream via the initiative edit form.
alter table public.bd_initiatives
  drop constraint if exists bd_initiatives_workstream_check;

alter table public.bd_initiatives
  add constraint bd_initiatives_workstream_check
  check (workstream in (
    'inbox','facility','product','marketing','sales','operations','finance','tech'
  ));
