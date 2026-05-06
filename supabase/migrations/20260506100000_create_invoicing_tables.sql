-- ════════════════════════════════════════════════════════════
-- Invoicing tables for Mayday Studio
-- ════════════════════════════════════════════════════════════

-- Helper: check if user is admin or assistant
create or replace function public.is_admin_or_assistant(uid uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.profiles where id = uid and role in ('admin', 'assistant')
  );
$$;
grant execute on function public.is_admin_or_assistant(uuid) to authenticated;

-- Auto-numbering sequence for invoices
create sequence if not exists invoice_number_seq start 1 increment 1;

-- ────────────────────────────────────────────────────────────
-- invoice_contacts — reusable bill-to / pay-to parties
-- ────────────────────────────────────────────────────────────
create table if not exists public.invoice_contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  company       text,
  email         text,
  phone         text,
  address_line1 text,
  address_line2 text,
  city          text,
  state         text,
  zip           text,
  country       text,
  notes         text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.invoice_contacts enable row level security;
create policy "invoice_contacts_admin_assistant" on public.invoice_contacts
  for all using (public.is_admin_or_assistant(auth.uid()));

-- ────────────────────────────────────────────────────────────
-- invoice_templates — saved templates for reuse
-- ────────────────────────────────────────────────────────────
create table if not exists public.invoice_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  direction   text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  line_items  jsonb not null default '[]'::jsonb,
  notes       text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.invoice_templates enable row level security;
create policy "invoice_templates_admin_assistant" on public.invoice_templates
  for all using (public.is_admin_or_assistant(auth.uid()));

-- ────────────────────────────────────────────────────────────
-- invoices — main invoice record
-- ────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  integer unique not null default nextval('invoice_number_seq'),
  direction       text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  status          text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  contact_id      uuid references public.invoice_contacts(id) on delete set null,
  issue_date      date,
  due_date        date,
  paid_date       date,
  subtotal_cents  bigint not null default 0,
  notes           text,
  template_id     uuid references public.invoice_templates(id) on delete set null,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.invoices enable row level security;
create policy "invoices_admin_assistant" on public.invoices
  for all using (public.is_admin_or_assistant(auth.uid()));

-- ────────────────────────────────────────────────────────────
-- invoice_line_items — freeform rows per invoice
-- ────────────────────────────────────────────────────────────
create table if not exists public.invoice_line_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  description text not null default '',
  quantity    numeric(12,4) not null default 1,
  rate_cents  bigint not null default 0,
  total_cents bigint not null default 0,
  position    integer not null default 0,
  created_at  timestamptz default now()
);

alter table public.invoice_line_items enable row level security;
create policy "invoice_line_items_admin_assistant" on public.invoice_line_items
  for all using (public.is_admin_or_assistant(auth.uid()));

-- ────────────────────────────────────────────────────────────
-- updated_at triggers
-- ────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create trigger invoice_contacts_updated_at
  before update on public.invoice_contacts
  for each row execute function public.set_updated_at();

create trigger invoice_templates_updated_at
  before update on public.invoice_templates
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- Realtime publication
-- ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.invoices;
alter publication supabase_realtime add table public.invoice_line_items;
alter publication supabase_realtime add table public.invoice_contacts;
alter publication supabase_realtime add table public.invoice_templates;
