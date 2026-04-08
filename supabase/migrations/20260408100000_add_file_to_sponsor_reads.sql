alter table public.sponsor_reads
  add column file_path text,
  add column file_type text,
  add column file_size bigint,
  add column original_filename text;
