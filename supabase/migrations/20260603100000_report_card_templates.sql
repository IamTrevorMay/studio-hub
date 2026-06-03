-- Templates for the Graphics-tier Report Cards tool (ported from
-- Triton's report_card_templates table). Each row is a saved Scene
-- (width/height/background + elements jsonb). Owner-only RLS — all
-- authed users can author + read their own templates.

create table public.report_card_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default 'Untitled Report Card',
  description text,
  category    text default 'custom',
  width       integer not null default 1920,
  height      integer not null default 1080,
  background  text not null default '#09090b',
  elements    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index report_card_templates_user_id_updated_at_idx
  on public.report_card_templates (user_id, updated_at desc);

alter table public.report_card_templates enable row level security;

create policy report_card_templates_select_own on public.report_card_templates
  for select using (user_id = auth.uid());

create policy report_card_templates_insert_self on public.report_card_templates
  for insert with check (user_id = auth.uid());

create policy report_card_templates_update_own on public.report_card_templates
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy report_card_templates_delete_own on public.report_card_templates
  for delete using (user_id = auth.uid());

create or replace function public.report_card_templates_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists report_card_templates_touch_updated_at on public.report_card_templates;
create trigger report_card_templates_touch_updated_at
  before update on public.report_card_templates
  for each row execute function public.report_card_templates_touch_updated_at();
