-- Per-channel role access. NULL / empty = open to everyone (backward compatible).
-- A non-empty array restricts the channel to those roles; admin-tier roles
-- (admin, director_creative, director_comms) always retain access in the UI.
-- Enforcement is client-side, consistent with the app's existing channel gating
-- (channels/channel_messages have no RLS — see src/lib/rolePermissions.js note).
alter table public.channels
  add column if not exists allowed_roles text[];
