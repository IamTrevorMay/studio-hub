-- Fix invoicing RLS policies to match the working bd_* pattern:
-- explicit "to authenticated" role and "with check" clause.

drop policy if exists "invoice_contacts_admin_assistant" on public.invoice_contacts;
create policy "invoice_contacts_admin_assistant" on public.invoice_contacts
  for all to authenticated
  using (public.is_admin_or_assistant(auth.uid()))
  with check (public.is_admin_or_assistant(auth.uid()));

drop policy if exists "invoices_admin_assistant" on public.invoices;
create policy "invoices_admin_assistant" on public.invoices
  for all to authenticated
  using (public.is_admin_or_assistant(auth.uid()))
  with check (public.is_admin_or_assistant(auth.uid()));

drop policy if exists "invoice_line_items_admin_assistant" on public.invoice_line_items;
create policy "invoice_line_items_admin_assistant" on public.invoice_line_items
  for all to authenticated
  using (public.is_admin_or_assistant(auth.uid()))
  with check (public.is_admin_or_assistant(auth.uid()));

drop policy if exists "invoice_templates_admin_assistant" on public.invoice_templates;
create policy "invoice_templates_admin_assistant" on public.invoice_templates
  for all to authenticated
  using (public.is_admin_or_assistant(auth.uid()))
  with check (public.is_admin_or_assistant(auth.uid()));
