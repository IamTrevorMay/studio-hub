-- Beat sheet Research view: one long-form research document per beat sheet,
-- plus an admin-managed gallery of starter templates.
--
-- Scoped to is_staff() rather than the "any authenticated user" rule the
-- beat_sheets table itself still carries. The Beat Sheet page only appears in
-- the staff nav, so nothing loses access, and a new table is the wrong place
-- to widen an existing hole.

-- ── templates ───────────────────────────────────────────────────────────────
create table public.research_doc_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  -- Same shape as the doc-editor's other tables: { html: '<p>…</p>' }.
  content     jsonb not null default '{}'::jsonb,
  position    int not null default 0,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index research_doc_templates_position_idx
  on public.research_doc_templates(position, created_at);

alter table public.research_doc_templates enable row level security;

create policy "staff read research templates"
  on public.research_doc_templates for select
  using (public.is_staff(auth.uid()));

create policy "admin manage research templates"
  on public.research_doc_templates for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── the doc itself ──────────────────────────────────────────────────────────
-- One row per beat sheet. The unique constraint is what makes "exactly one
-- research doc" true at the DB level, so two tabs opening Research at the same
-- moment can't create a pair of docs that then diverge.
create table public.beat_sheet_research_docs (
  id            uuid primary key default gen_random_uuid(),
  beat_sheet_id uuid not null unique references public.beat_sheets(id) on delete cascade,
  content       jsonb not null default '{}'::jsonb,
  -- Free-text blurb shown above the outline in the left rail, the way Docs
  -- puts Summary above Outline. Plain text, not rich content.
  summary       text,
  template_id   uuid references public.research_doc_templates(id) on delete set null,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.beat_sheet_research_docs enable row level security;

create policy "staff manage research docs"
  on public.beat_sheet_research_docs for all
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

-- ── starter templates ───────────────────────────────────────────────────────
insert into public.research_doc_templates (name, description, position, content) values
(
  'Topic Research',
  'Background, key facts, sources, and open questions for a single subject.',
  10,
  jsonb_build_object('html',
    '<h1>Topic Research</h1>' ||
    '<h2>The question</h2><p>What are we actually trying to find out?</p>' ||
    '<h2>Background</h2><p></p>' ||
    '<h2>Key facts</h2><ul><li><p></p></li></ul>' ||
    '<h2>Numbers worth citing</h2><table><tbody>' ||
      '<tr><th><p>Stat</p></th><th><p>Value</p></th><th><p>Source</p></th></tr>' ||
      '<tr><td><p></p></td><td><p></p></td><td><p></p></td></tr>' ||
    '</tbody></table>' ||
    '<h2>Sources</h2><ol><li><p></p></li></ol>' ||
    '<h2>Open questions</h2><ul><li><p></p></li></ul>'
  )
),
(
  'Interview Prep',
  'Guest bio, angle, question ladder, and the moments to chase.',
  20,
  jsonb_build_object('html',
    '<h1>Interview Prep</h1>' ||
    '<h2>Guest</h2><p>Name, what they do, why now.</p>' ||
    '<h2>The angle</h2><p>The one thing this conversation is about.</p>' ||
    '<h2>Warm-up</h2><ol><li><p></p></li></ol>' ||
    '<h2>Core questions</h2><ol><li><p></p></li></ol>' ||
    '<h2>If they open the door</h2><ul><li><p></p></li></ul>' ||
    '<h2>Do not ask</h2><ul><li><p></p></li></ul>' ||
    '<h2>Clip moments to chase</h2><ul><li><p></p></li></ul>'
  )
),
(
  'Fact Check',
  'Claim-by-claim verification with a verdict and a source for each line.',
  30,
  jsonb_build_object('html',
    '<h1>Fact Check</h1>' ||
    '<p>One row per claim. A claim is not cleared until the source column is filled in.</p>' ||
    '<table><tbody>' ||
      '<tr><th><p>Claim</p></th><th><p>Verdict</p></th><th><p>Source</p></th><th><p>Notes</p></th></tr>' ||
      '<tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr>' ||
    '</tbody></table>' ||
    '<h2>Corrections to make on script</h2><ul><li><p></p></li></ul>'
  )
),
(
  'Competitor Breakdown',
  'What comparable videos did, what worked, and what we are taking.',
  40,
  jsonb_build_object('html',
    '<h1>Competitor Breakdown</h1>' ||
    '<h2>Videos reviewed</h2><table><tbody>' ||
      '<tr><th><p>Video</p></th><th><p>Channel</p></th><th><p>Views</p></th><th><p>Why it worked</p></th></tr>' ||
      '<tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr>' ||
    '</tbody></table>' ||
    '<h2>Hooks they used</h2><ul><li><p></p></li></ul>' ||
    '<h2>Structure patterns</h2><ul><li><p></p></li></ul>' ||
    '<h2>Gaps nobody covered</h2><ul><li><p></p></li></ul>' ||
    '<h2>What we are taking</h2><ul><li><p></p></li></ul>'
  )
);
