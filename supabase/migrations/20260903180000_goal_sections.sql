-- Goal sections: funnels on the Tracking page.
--
-- The Goals area was two fixed blocks — a standalone Weekly list and a Yearly
-- grid with monthly goals nested inside each yearly card. It becomes an
-- arbitrary list of user-defined Sections ("funnels"), each holding goals of
-- any period, laid out as Weekly → Monthly → Yearly subsections. A subsection
-- with no goals in it is hidden entirely.
--
-- Two consequences for the data model:
--
-- 1. Monthly goals stop being children of a yearly goal. The content-scope
--    rows in monthly_goals move into `goals` as category='monthly', so all
--    three periods live in one table with one shape and one renderer.
--    monthly_goals itself STAYS — BusinessDev.js still uses it for scope='bd'
--    roadmap goals, which are a different feature entirely.
--
-- 2. `goals.category` now carries the period (weekly|monthly|yearly) and
--    `section_id` carries the grouping. Deleting a section cascades to its
--    goals, matching the typed-confirmation delete in the UI.

create table if not exists public.goal_sections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  position    integer not null default 0,
  scope       text not null default 'content',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists goal_sections_scope_position_idx
  on public.goal_sections (scope, position);

alter table public.goal_sections enable row level security;

drop policy if exists "goal_sections_select" on public.goal_sections;
create policy "goal_sections_select" on public.goal_sections
  for select to authenticated using (true);

drop policy if exists "goal_sections_write" on public.goal_sections;
create policy "goal_sections_write" on public.goal_sections
  for all to authenticated using (is_admin()) with check (is_admin());

alter table public.goals
  add column if not exists section_id uuid references public.goal_sections(id) on delete cascade;

create index if not exists goals_section_idx on public.goals (section_id);

do $$
declare
  socials   uuid;
  long_form uuid;
  owner_id  uuid;
begin
  -- Attribute the seeded sections to an admin so created_by is never null.
  select id into owner_id from public.profiles where role = 'admin' order by created_at limit 1;

  insert into public.goal_sections (name, position, scope, created_by)
    values ('Socials Funnel', 0, 'content', owner_id)
    returning id into socials;
  insert into public.goal_sections (name, position, scope, created_by)
    values ('Long Form Funnel', 1, 'content', owner_id)
    returning id into long_form;

  -- The five recurring post-cadence goals become the Socials Funnel.
  update public.goals
     set section_id = socials
   where scope = 'content' and category = 'weekly' and section_id is null;

  -- The two YouTube view goals become the Long Form Funnel.
  update public.goals
     set section_id = long_form
   where scope = 'content' and category = 'yearly' and section_id is null;

  -- Monthly goals that hung off those yearly goals move across as first-class
  -- monthly goals in the same section. content_type_filter ('video'/'short')
  -- is already a key in the shared post-type vocabulary, so it transfers
  -- straight into `metrics` as a post_count goal.
  insert into public.goals
    (title, category, goal_type, target_value, current_value,
     metrics, platform_account_ids, scope, section_id, created_by, created_at)
  select mg.title, 'monthly', 'post_count', mg.target_value, 0,
         to_jsonb(array[mg.content_type_filter]), mg.platform_account_ids,
         'content', long_form, mg.created_by, mg.created_at
    from public.monthly_goals mg
   where mg.scope = 'content'
     and mg.parent_goal_id is not null;

  -- Their source rows are now duplicates.
  delete from public.monthly_goals
   where scope = 'content' and parent_goal_id is not null;

  -- "Total Short Form Posts" had no parent, so the old UI — which only drew
  -- monthlies through their parent yearly card — never rendered it. It has
  -- been invisible and unmaintained since it was created; dropped rather than
  -- resurrected.
  delete from public.monthly_goals
   where scope = 'content' and parent_goal_id is null;
end $$;
