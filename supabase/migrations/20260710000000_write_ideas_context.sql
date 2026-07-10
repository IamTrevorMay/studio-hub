-- Long-form context notes on Ideas board items ("+ context" on the Ideas page).
alter table public.write_ideas
  add column if not exists context text;
