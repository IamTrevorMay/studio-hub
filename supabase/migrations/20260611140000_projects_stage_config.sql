alter table public.projects
  add column if not exists stage_config jsonb not null default '{}'::jsonb;

comment on column public.projects.stage_config is
  'Per-stage settings keyed by stage name. Shape: { write: { skip: true }, edit: {...} }. card-move advances past stages where skip=true.';
