-- Admin-only notes area on the contractor profile (Contractor Mode → Team →
-- full profile view). contractor_profiles already carries admin-writable
-- payment fields, so this column inherits the same admin-update RLS.
alter table public.contractor_profiles add column if not exists admin_notes text;
