-- Allow 'report' as an item_type in research_inbox_state
alter table research_inbox_state
  drop constraint if exists research_inbox_state_item_type_check;

alter table research_inbox_state
  add constraint research_inbox_state_item_type_check
  check (item_type in ('brief', 'cards', 'trends', 'report'));
