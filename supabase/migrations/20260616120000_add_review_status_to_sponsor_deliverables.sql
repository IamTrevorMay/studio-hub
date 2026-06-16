alter table public.sponsor_deliverables
  add column if not exists review_status text not null default 'not_submitted';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sponsor_deliverables_review_status_check'
      and conrelid = 'public.sponsor_deliverables'::regclass
  ) then
    alter table public.sponsor_deliverables
      add constraint sponsor_deliverables_review_status_check
      check (review_status in ('not_submitted','pending','accepted'));
  end if;
end $$;
