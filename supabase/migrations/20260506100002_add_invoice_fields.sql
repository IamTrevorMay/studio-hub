alter table public.invoices
  add column if not exists po_number          text,
  add column if not exists payment_terms      text,
  add column if not exists tax_rate           numeric(6,4) default 0,
  add column if not exists tax_cents          bigint not null default 0,
  add column if not exists discount_cents     bigint not null default 0,
  add column if not exists shipping_cents     bigint not null default 0,
  add column if not exists amount_paid_cents  bigint not null default 0,
  add column if not exists total_cents        bigint not null default 0,
  add column if not exists payment_instructions text,
  add column if not exists terms_conditions   text,
  add column if not exists sender_tax_id      text;
