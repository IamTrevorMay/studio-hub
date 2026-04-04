-- Allow public reads on enabled report configs for the subscribe page
create policy "Public can read enabled report_configs"
  on report_configs for select
  using (enabled = true);
