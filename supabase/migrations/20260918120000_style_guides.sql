-- Style Guides: review-timeline comments distilled into per-client / studio
-- rule cards.
--
-- Shape
--   style_guides            one per scope: the single 'mayday' guide, or one
--                           'client' guide per client account. Created lazily
--                           by the style-guide edge function the first time a
--                           review feeding that guide is processed.
--   style_guide_rules       the cards. AI output always lands as 'suggested';
--                           only a human flips a card to 'active' (or
--                           'dismissed'). Manual cards can be added by hand.
--   style_guide_rule_refs   evidence: which comment on which review, at which
--                           timestamp, produced or reinforced a card.
--   review_comment_insights one row per processed comment — what makes
--                           "Update Style Guide" idempotent and the backfill
--                           safe to re-run.
--   style_guide_runs        audit of each update press (counts for the toast).
--
-- Routing: a review born from a client assignment or shared to a client feeds
-- that client's guide — every commenter's notes included, staff too. Anything
-- else feeds the Mayday guide. `style_guide_client_for_review()` is the single
-- source of that rule (edge function calls it).
--
-- Visibility
--   admin-tier   every guide, every card (suggested / active / dismissed)
--   staff        Mayday guide, active cards only, read-only
--   client       own guide, active cards only; may add / edit / delete cards
--   contractor   guides of clients they're linked to (client_editors), active
--                cards only, read-only
-- Suggestions are admin-side: a client never sees raw AI output.
--
-- All AI writes (rules with source='ai', refs, insights, runs) go through the
-- service-role edge function — no authenticated policy grants them, so nobody
-- can forge evidence.

-- ── Guides ──────────────────────────────────────────────────────────────────
create table if not exists public.style_guides (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('mayday', 'client')),
  client_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint style_guides_scope_client check (
    (scope = 'mayday' and client_id is null) or (scope = 'client' and client_id is not null)
  )
);
create unique index if not exists style_guides_mayday_uniq on public.style_guides ((1)) where scope = 'mayday';
create unique index if not exists style_guides_client_uniq on public.style_guides (client_id) where scope = 'client';

-- ── Rules (cards) ───────────────────────────────────────────────────────────
create table if not exists public.style_guide_rules (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.style_guides(id) on delete cascade,
  category text not null check (category in (
    'pacing_cuts', 'audio_music', 'graphics_text', 'sponsor_brand',
    'transitions_effects', 'story_content', 'color_look', 'delivery_export'
  )),
  text text not null check (length(btrim(text)) > 0),
  status text not null default 'suggested' check (status in ('suggested', 'active', 'dismissed')),
  source text not null default 'ai' check (source in ('ai', 'manual')),
  ref_count integer not null default 0,
  position integer not null default 0,
  first_review_id uuid references public.reviews(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,   -- null = AI
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  dismissed_by uuid references public.profiles(id) on delete set null,
  dismissed_at timestamptz,
  edited_by uuid references public.profiles(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists style_guide_rules_guide_idx on public.style_guide_rules (guide_id, status, category, position);

-- ── Evidence ────────────────────────────────────────────────────────────────
create table if not exists public.style_guide_rule_refs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.style_guide_rules(id) on delete cascade,
  comment_id uuid references public.review_comments(id) on delete set null,
  review_id uuid references public.reviews(id) on delete cascade,
  version_id uuid references public.review_versions(id) on delete set null,
  review_title text,
  version_label text,
  timestamp_seconds numeric,
  excerpt text not null,
  author_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Plain (non-partial) so PostgREST upserts can target it; null comment_ids
-- are distinct under the default NULLS DISTINCT so manual refs never collide.
create unique index if not exists style_guide_rule_refs_uniq
  on public.style_guide_rule_refs (rule_id, comment_id);
create index if not exists style_guide_rule_refs_rule_idx on public.style_guide_rule_refs (rule_id, created_at);

-- ── Processed-comment ledger ────────────────────────────────────────────────
create table if not exists public.review_comment_insights (
  comment_id uuid primary key references public.review_comments(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  guide_id uuid not null references public.style_guides(id) on delete cascade,
  reusable boolean not null,
  category text,
  normalized_text text,
  rule_id uuid references public.style_guide_rules(id) on delete set null,
  processed_at timestamptz not null default now()
);
create index if not exists review_comment_insights_review_idx on public.review_comment_insights (review_id);

-- ── Run audit ───────────────────────────────────────────────────────────────
create table if not exists public.style_guide_runs (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.style_guides(id) on delete cascade,
  review_id uuid references public.reviews(id) on delete set null,
  run_by uuid references public.profiles(id) on delete set null,
  comments_processed integer not null default 0,
  new_rules integer not null default 0,
  refs_added integer not null default 0,
  created_at timestamptz not null default now()
);

-- ── Routing helper ──────────────────────────────────────────────────────────
-- The client a review's comments belong to, or null for the Mayday guide.
-- Assignment-born reviews win; otherwise the earliest share.
create or replace function public.style_guide_client_for_review(p_review uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.review_client_id(p_review),
    (select s.client_id from public.review_client_shares s
       where s.review_id = p_review
       order by s.created_at asc limit 1)
  );
$$;

-- ── Visibility helper ───────────────────────────────────────────────────────
create or replace function public.can_view_style_guide(p_guide uuid, p_uid uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.style_guides g
    where g.id = p_guide
      and (
        public.is_admin(p_uid)
        or (g.scope = 'mayday' and public.is_staff(p_uid))
        or g.client_id = p_uid
        or exists (select 1 from public.client_editors ce
                   where ce.client_id = g.client_id and ce.contractor_id = p_uid)
      )
  );
$$;

-- Client owns the guide (the only non-admin write path).
create or replace function public.owns_style_guide(p_guide uuid, p_uid uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.style_guides g
                 where g.id = p_guide and g.client_id = p_uid and public.is_client(p_uid));
$$;

-- ── Rule guard trigger ──────────────────────────────────────────────────────
-- Service role (auth.uid() null) passes untouched. Admin-tier gets bookkeeping
-- stamps. A client may only add manual active cards and edit text / category /
-- position on active cards of their own guide — never status, ref_count,
-- source, or the AI's suggested / dismissed cards.
create or replace function public.style_guide_rules_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.updated_at := now();
  if v_uid is null then
    return new;                                           -- service role
  end if;

  if public.is_admin(v_uid) then
    if tg_op = 'INSERT' then
      new.created_by := coalesce(new.created_by, v_uid);
      if new.source = 'manual' and new.status = 'active' then
        new.accepted_by := v_uid; new.accepted_at := now();
      end if;
      return new;
    end if;
    if new.status is distinct from old.status then
      if new.status = 'active' then
        new.accepted_by := v_uid; new.accepted_at := now();
        new.dismissed_by := null; new.dismissed_at := null;
      elsif new.status = 'dismissed' then
        new.dismissed_by := v_uid; new.dismissed_at := now();
      end if;
    end if;
    if new.text is distinct from old.text or new.category is distinct from old.category then
      new.edited_by := v_uid; new.edited_at := now();
      -- Editing a suggestion's wording is an acceptance.
      if old.status = 'suggested' and new.status = 'suggested' then
        new.status := 'active'; new.accepted_by := v_uid; new.accepted_at := now();
      end if;
    end if;
    new.ref_count := old.ref_count;                       -- evidence count is AI-owned
    return new;
  end if;

  -- Client on their own guide.
  if not public.owns_style_guide(new.guide_id, v_uid) then
    raise exception 'Not allowed to modify this style guide';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'active';
    new.source := 'manual';
    new.ref_count := 0;
    new.first_review_id := null;
    new.created_by := v_uid;
    new.accepted_by := v_uid; new.accepted_at := now();
    return new;
  end if;
  if old.status <> 'active' then
    raise exception 'Only active rules can be edited';
  end if;
  if new.guide_id <> old.guide_id or new.status <> old.status or new.source <> old.source
     or new.ref_count <> old.ref_count or new.first_review_id is distinct from old.first_review_id
     or new.created_by is distinct from old.created_by
     or new.accepted_by is distinct from old.accepted_by or new.accepted_at is distinct from old.accepted_at
     or new.dismissed_by is distinct from old.dismissed_by or new.dismissed_at is distinct from old.dismissed_at then
    raise exception 'Only the rule text, category, and order can be changed';
  end if;
  if new.text is distinct from old.text or new.category is distinct from old.category then
    new.edited_by := v_uid; new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists style_guide_rules_guard on public.style_guide_rules;
create trigger style_guide_rules_guard
  before insert or update on public.style_guide_rules
  for each row execute function public.style_guide_rules_guard();

-- Any rule change bumps the guide.
create or replace function public.style_guides_touch()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.style_guides set updated_at = now()
   where id = coalesce(new.guide_id, old.guide_id);
  return coalesce(new, old);
end;
$$;
drop trigger if exists style_guide_rules_touch on public.style_guide_rules;
create trigger style_guide_rules_touch
  after insert or update or delete on public.style_guide_rules
  for each row execute function public.style_guides_touch();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.style_guides enable row level security;
alter table public.style_guide_rules enable row level security;
alter table public.style_guide_rule_refs enable row level security;
alter table public.review_comment_insights enable row level security;
alter table public.style_guide_runs enable row level security;

drop policy if exists "style_guides select" on public.style_guides;
create policy "style_guides select" on public.style_guides
  for select to authenticated
  using (public.can_view_style_guide(id, auth.uid()));

drop policy if exists "style_guides admin write" on public.style_guides;
create policy "style_guides admin write" on public.style_guides
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Cards: visibility follows the guide; non-admins see active cards only.
drop policy if exists "style_guide_rules select" on public.style_guide_rules;
create policy "style_guide_rules select" on public.style_guide_rules
  for select to authenticated
  using (
    public.can_view_style_guide(guide_id, auth.uid())
    and (status = 'active' or public.is_admin())
  );

drop policy if exists "style_guide_rules insert" on public.style_guide_rules;
create policy "style_guide_rules insert" on public.style_guide_rules
  for insert to authenticated
  with check (public.is_admin() or public.owns_style_guide(guide_id, auth.uid()));

drop policy if exists "style_guide_rules update" on public.style_guide_rules;
create policy "style_guide_rules update" on public.style_guide_rules
  for update to authenticated
  using (public.is_admin() or (public.owns_style_guide(guide_id, auth.uid()) and status = 'active'))
  with check (public.is_admin() or public.owns_style_guide(guide_id, auth.uid()));

drop policy if exists "style_guide_rules delete" on public.style_guide_rules;
create policy "style_guide_rules delete" on public.style_guide_rules
  for delete to authenticated
  using (public.is_admin() or (public.owns_style_guide(guide_id, auth.uid()) and status = 'active'));

-- Evidence: readable wherever the card is; written only by the service role.
drop policy if exists "style_guide_rule_refs select" on public.style_guide_rule_refs;
create policy "style_guide_rule_refs select" on public.style_guide_rule_refs
  for select to authenticated
  using (exists (
    select 1 from public.style_guide_rules r
    where r.id = rule_id
      and public.can_view_style_guide(r.guide_id, auth.uid())
      and (r.status = 'active' or public.is_admin())
  ));

drop policy if exists "review_comment_insights admin select" on public.review_comment_insights;
create policy "review_comment_insights admin select" on public.review_comment_insights
  for select to authenticated using (public.is_admin());

drop policy if exists "style_guide_runs admin select" on public.style_guide_runs;
create policy "style_guide_runs admin select" on public.style_guide_runs
  for select to authenticated using (public.is_admin());

grant select on public.style_guides, public.style_guide_rules, public.style_guide_rule_refs,
  public.review_comment_insights, public.style_guide_runs to authenticated;
grant insert, update, delete on public.style_guide_rules to authenticated;
grant insert, update, delete on public.style_guides to authenticated;

comment on table public.style_guides is 'Per-client / studio style guides distilled from review timeline comments by the style-guide edge function.';
comment on column public.style_guide_rules.status is 'suggested = AI proposal (admin-only); active = in the guide; dismissed = rejected, still absorbs matching comments so it never resurfaces as new.';
