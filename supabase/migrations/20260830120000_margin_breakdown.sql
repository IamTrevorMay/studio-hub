-- Breakdown view (Accounting → Breakdown): the margin-target model.
--
-- Ports Mayday_Margin_Workbook.xlsx into the app so the pricing model reads
-- off real Tiller / payroll / assignment data instead of hand-fed cells.
--
-- The shape of the thing:
--   • Auto-fill wherever the data exists, blank where it doesn't.
--   • Every manual number the operator types lands in `margin_inputs` — one
--     table, so "Recalculate" is a scoped DELETE rather than a per-table sweep.
--   • Fields with no auto source (membership assumptions, SaaS tiers) survive a
--     Recalculate; overridden auto fields snap back. The field registry in
--     src/lib/marginModel.js decides which is which.
--
-- Access is STRICT admin (is_strict_admin), matching the Accounting page.
-- Directors are held out of the whole page by ROLE_RESTRICTED_NAV_KEYS, and
-- this data is payroll-adjacent, so the DB agrees with the UI rather than
-- leaning on the nav gate alone.

-- ── 1. Settings — one row, jsonb, same shape as bd_settings ─────────
-- data holds: category_map (expense category → classification), revenue_map
-- (revenue category → bucket), overhead_recovery_pct, contingency_pct,
-- business_split. Seed defaults live in marginModel.js; this only stores the
-- operator's overrides, so new Tiller categories can be tagged without a
-- migration.
create table if not exists public.margin_settings (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.margin_settings (id) values (1) on conflict (id) do nothing;

-- ── 2. People — the labour-rate roster ─────────────────────────────
-- profile_id set  → salary / hourly rate auto-fills from payroll.
-- profile_id null → a planned or unpaid line the operator types entirely
--                   ("Editor 3 (planned)", an owner line paying nothing yet).
create table if not exists public.margin_people (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete set null,
  label       text not null,
  position    integer not null default 0,
  archived_at timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists margin_people_position_idx on public.margin_people (position);
create unique index if not exists margin_people_profile_uniq
  on public.margin_people (profile_id) where profile_id is not null;

-- ── 3. Products — what gets priced ─────────────────────────────────
-- The match_* columns key a product to reported hours. They AND together;
-- null means "don't filter on this". Left null entirely, the product has no
-- auto hours and the operator types them.
--
--   match_content_type    contractor_assignments.content_type ('video'|'podcast')
--   match_assignment_type contractor_assignments.assignment_type
--   match_sub_role        assignee profiles.sub_role — the only thing that
--                         separates long-form from short-form editing
--   match_client_work     true = assignment created by a client account,
--                         false = internal, null = either
--   match_task_keyword    case-insensitive substring of tasks.title, so
--                         hour-reporting tasks count toward a product too
create table if not exists public.margin_products (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  bucket                text not null default 'labour' check (bucket in ('labour', 'recurring')),
  -- Recurring rows carry their own field set (workbook tab 5) keyed off this.
  recurring_kind        text check (recurring_kind is null or recurring_kind in ('membership', 'saas', 'merch')),
  -- Which readout row this product's revenue and direct cost roll into. This
  -- is what lets the Readout derive a direct cost per row instead of asking
  -- for it, and lets rows with no Tiller revenue category (tracers,
  -- instruction, SaaS) fall back to price x units.
  readout_row           text not null default 'labour_content',
  unit_label            text not null default 'per unit',
  target_margin         numeric not null default 0.30 check (target_margin >= 0 and target_margin < 1),
  rework_pct            numeric not null default 0 check (rework_pct >= 0 and rework_pct <= 1),
  headroom_pct          numeric not null default 0 check (headroom_pct >= 0 and headroom_pct < 1),
  actual_price_cents    integer,
  match_content_type    text,
  match_assignment_type text,
  match_sub_role        text,
  match_client_work     boolean,
  match_task_keyword    text,
  position              integer not null default 0,
  archived_at           timestamptz,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists margin_products_position_idx on public.margin_products (position);

-- The workbook's seven labour products, with its target margins and rework
-- allowances, plus the tab-5 recurring rows. Both halves are seeded because
-- tab 5 is in scope for v1 and starting it empty would just mean retyping the
-- spreadsheet. Only seeded on a fresh table, so a re-run never resurrects
-- rows that were deleted on purpose.
insert into public.margin_products
  (name, bucket, recurring_kind, readout_row, unit_label, target_margin, rework_pct, position,
   match_content_type, match_assignment_type, match_sub_role, match_client_work)
select * from (values
  ('YouTube long-form video',            'labour',    null,         'labour_content',       'per video',   0.28, 0.15,  1, 'video', null,   'Long Form Editor',  false),
  ('Short-form / social clip',           'labour',    null,         'labour_content',       'per clip',    0.28, 0.15,  2, 'video', null,   'Short Form Editor', false),
  ('Production services — client edit',  'labour',    null,         'labour_production',    'per video',   0.30, 0.20,  3, null,    'edit', null,                true),
  ('Production services — retainer',     'labour',    null,         'labour_production',    'per month',   0.30, 0.20,  4, null,    null,   null,                null),
  ('Golf shot tracer',                   'labour',    null,         'labour_tracers',       'per tracer',  0.30, 0.10,  5, null,    null,   null,                null),
  ('Pitching lesson',                    'labour',    null,         'labour_instruction',   'per hour',    0.35, 0.05,  6, null,    null,   null,                null),
  ('Biomechanics assessment',            'labour',    null,         'labour_instruction',   'per session', 0.35, 0.10,  7, null,    null,   null,                null),
  -- Recurring. Substack IS the membership, so its revenue auto-fills from the
  -- Substack Income category; member count stays manual (see marginModel.js).
  ('Membership (Substack)',              'recurring', 'membership', 'recurring_membership', 'per member',  0.00, 0.00, 10, null,    null,   null,                null),
  ('Facility SaaS — Starter',            'recurring', 'saas',       'recurring_saas',       'per month',   0.00, 0.00, 11, null,    null,   null,                null),
  ('Facility SaaS — Standard',           'recurring', 'saas',       'recurring_saas',       'per month',   0.00, 0.00, 12, null,    null,   null,                null),
  ('Facility SaaS — Pro',                'recurring', 'saas',       'recurring_saas',       'per month',   0.00, 0.00, 13, null,    null,   null,                null),
  ('Merch — Tee',                        'recurring', 'merch',      'recurring_merch',      'per unit',    0.45, 0.00, 20, null,    null,   null,                null),
  ('Merch — Hoodie',                     'recurring', 'merch',      'recurring_merch',      'per unit',    0.45, 0.00, 21, null,    null,   null,                null),
  ('Merch — Hat',                        'recurring', 'merch',      'recurring_merch',      'per unit',    0.45, 0.00, 22, null,    null,   null,                null)
) as seed
where not exists (select 1 from public.margin_products);

-- ── 4. Inputs — every manual number on the page ────────────────────
create table if not exists public.margin_inputs (
  id         uuid primary key default gen_random_uuid(),
  section    text not null check (section in ('overhead', 'labour', 'model', 'products', 'recurring', 'readout')),
  field_key  text not null,
  -- text, not uuid: it keys a margin_people id, a margin_products id, OR a
  -- readout row slug ('labour_content'). One column for all three keeps
  -- Recalculate a single scoped DELETE.
  --
  -- NOT NULL with an empty-string sentinel for page-level fields, so a single
  -- total unique index covers every case. A nullable column would need partial
  -- indexes, and PostgREST's upsert cannot infer a partial index as an
  -- ON CONFLICT target — every save would fail at runtime.
  subject_id text not null default '',
  value      numeric,
  note       text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- One value per field per subject.
create unique index if not exists margin_inputs_keyed_uniq
  on public.margin_inputs (section, field_key, subject_id);
create index if not exists margin_inputs_section_idx on public.margin_inputs (section);

-- ── 5. Snapshots — the quarterly close ─────────────────────────────
-- Written by the "Close quarter" button, not by cron. data is the whole
-- readout at that moment (same jsonb-blob approach as monthly_reports).
create table if not exists public.margin_snapshots (
  id         uuid primary key default gen_random_uuid(),
  period_end date not null,
  label      text not null,
  data       jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists margin_snapshots_period_uniq on public.margin_snapshots (period_end);
create index if not exists margin_snapshots_period_idx on public.margin_snapshots (period_end desc);

-- ── 6. Decision log — workbook tab 8 ───────────────────────────────
create table if not exists public.margin_decisions (
  id              uuid primary key default gen_random_uuid(),
  decided_on      date not null default current_date,
  product_id      uuid references public.margin_products(id) on delete set null,
  product_label   text not null,
  what_changed    text not null,
  old_price_cents integer,
  new_price_cents integer,
  reason          text,
  grandfathered   boolean not null default true,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists margin_decisions_decided_idx on public.margin_decisions (decided_on desc);

-- ── RLS — strict admin on all six ──────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'margin_settings', 'margin_people', 'margin_products',
    'margin_inputs', 'margin_snapshots', 'margin_decisions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_strict_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_strict_admin()) with check (public.is_strict_admin())',
      t || '_strict_admin_all', t
    );
  end loop;
end $$;

-- ── updated_at maintenance ─────────────────────────────────────────
create or replace function public.margin_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['margin_settings', 'margin_people', 'margin_products', 'margin_inputs'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.margin_touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end $$;

comment on table public.margin_inputs is
  'Every hand-entered value on the Breakdown page. Recalculate deletes only the rows whose field has an auto source (see FIELDS in src/lib/marginModel.js); manual-only fields survive.';
comment on table public.margin_products is
  'Priced products. match_* columns AND together to key a product to reported hours on contractor_assignments / tasks.';
