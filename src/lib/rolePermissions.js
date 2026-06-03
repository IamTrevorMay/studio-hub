// Hardcoded role → restricted nav-key map. The baseline is full admin
// access; each role here lists the nav keys (matching NAV_ITEMS in
// src/pages/AppLayout.js) that the role CANNOT see or visit.
//
// Adding a new role:
//   1. Add the role string to profiles.role check constraint
//      (see supabase/migrations/*_director_roles.sql for the pattern).
//   2. Append it to public.is_admin / public.is_admin_or_assistant if it
//      should keep admin-tier DB access (UI-only restriction).
//   3. Add an entry below with its restricted nav keys.
//
// Restriction is UI-only — these users still pass is_admin() at the DB
// layer. RLS does not block them from the underlying tables; the nav
// hide + route guard is the enforcement boundary.

export const ROLE_RESTRICTED_NAV_KEYS = {
  director_creative: new Set([
    'payroll',
    'business_dev',
    'workflows',
    'accounting',
    'admin',
  ]),
  director_comms: new Set([
    'payroll',
    'business_dev',
    'workflows',
    'accounting',
    'admin',
  ]),
  // Producer: member-tier visibility + Broadcast access only. Mirrors
  // freelancer-style restriction but keeps the broadcast nav row visible.
  producer: new Set([
    'payroll',
    'business_dev',
    'workflows',
    'accounting',
    'admin',
    'contractors',
    'jobs',
    'analytics',
  ]),
};

// Roles that can access Broadcast (the per-project ACL is enforced at
// the DB layer; this is just the gate that opens the nav row).
export const BROADCAST_TIER_ROLES = new Set([
  'admin',
  'director_creative',
  'director_comms',
  'producer',
]);

export function canAccessBroadcast(role) {
  return BROADCAST_TIER_ROLES.has(role);
}

export function getRestrictedNavKeys(role) {
  return ROLE_RESTRICTED_NAV_KEYS[role] || new Set();
}

export function canAccessNavKey(role, key) {
  return !getRestrictedNavKeys(role).has(key);
}

// Admin-tier roles for client-side gating. Mirrors the DB is_admin()
// helper. New admin-tier roles must be added here AND to the DB function.
export const ADMIN_TIER_ROLES = new Set([
  'admin',
  'director_creative',
  'director_comms',
]);

export function isAdminTier(role) {
  return ADMIN_TIER_ROLES.has(role);
}
