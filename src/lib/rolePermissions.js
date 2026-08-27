// Role hierarchy (restructured 2026-07-29; client added 2026-07-30).
//
// Top-level roles:  admin · director · member · contractor · client
//   - Director sub-roles:   communications | creative   (profiles.sub_role)
//   - Contractor sub-roles: the former "titles"         (profiles.sub_role)
//   - admin / member / client have no sub-role.
//   - client is an external customer with a locked portal (like contractor) —
//     NOT admin-tier, NOT in STAFF_ROLES, genuinely RLS-fenced at the DB.
//
// Removed roles: assistant (folded into Director), producer (unused),
// partner (portal removed). LEGACY_DIRECTOR_ROLES are the pre-restructure
// director values that still exist in the DB until the CONTRACT migration
// flips them to 'director'; they are kept in every accept-list so the deploy
// window is seamless, and are safe to prune once CONTRACT is applied.
//
// The baseline is full admin access; each role in ROLE_RESTRICTED_NAV_KEYS
// lists the nav keys it CANNOT see or visit. Restriction is UI-only — these
// users still pass is_admin() at the DB layer; the nav hide + route guard is
// the enforcement boundary.
//
// Adding a new role:
//   1. Add the role string to the profiles.role check constraint.
//   2. Append it to public.is_admin if it should keep admin-tier DB access.
//   3. Add an entry below with its restricted nav keys (if admin-tier).

export const LEGACY_DIRECTOR_ROLES = ['director_creative', 'director_comms'];

// Any value that means "Director" (canonical + legacy-during-window).
export const DIRECTOR_ROLES = ['director', ...LEGACY_DIRECTOR_ROLES];

export function isDirectorRole(role) {
  return DIRECTOR_ROLES.includes(role);
}

// Director sub-roles (profiles.sub_role when role === 'director').
export const DIRECTOR_SUB_ROLES = ['communications', 'creative'];

// Contractor sub-roles (the former "titles"). Display/organizational for now;
// used by the AdminPanel picker and the admin "View as…" portal preview.
export const CONTRACTOR_SUB_ROLES = [
  'Long Form Editor', 'Short Form Editor', 'Podcast Editor',
  'Graphic Designer', 'Developer', 'Writer', 'Producer', 'Production/Camera',
];

// Member sub-roles (internal staff job functions). Display/organizational only,
// same as the contractor list — no feature gating hangs off these yet.
export const MEMBER_SUB_ROLES = [
  'Editor', 'Executive Producer', 'Associate Producer', 'Writer', 'Researcher',
];

export const DIRECTOR_SUB_ROLE_LABELS = {
  communications: 'Director of Communications',
  creative: 'Director of Creative',
};

// ── Client role (external customers, locked portal) ──

export const CLIENT_ROLE = 'client';

export function isClientRole(role) {
  return role === CLIENT_ROLE;
}

// Contractor sub-roles that act as client-facing editors. Mirrors the DB
// client_editors_validate() trigger — keep in sync.
export const EDITOR_SUB_ROLES = ['Long Form Editor', 'Short Form Editor', 'Podcast Editor'];

export function isEditorSubRole(subRole) {
  return EDITOR_SUB_ROLES.includes(subRole);
}

// Who can manage clients (invite, assign editors, issue documents): admins and
// the Creative Director. UI-only gate — the DB layer passes is_admin() for all
// directors, like the other ROLE_RESTRICTED_NAV_KEYS boundaries.
export function canManageClients(role, subRole) {
  return role === 'admin' || (isDirectorRole(role) && subRole === 'creative');
}

// Internal, non-contractor staff roles (for team pickers / staff queries).
export const STAFF_ROLES = ['admin', 'director', 'member', ...LEGACY_DIRECTOR_ROLES];

const DIRECTOR_RESTRICTED = new Set([
  'payroll',
  'business_dev',
  'workflows',
  'accounting',
  'admin',
]);

export const ROLE_RESTRICTED_NAV_KEYS = {
  director: DIRECTOR_RESTRICTED,
  // Legacy director values — identical restrictions until CONTRACT.
  director_creative: DIRECTOR_RESTRICTED,
  director_comms: DIRECTOR_RESTRICTED,
};

// Roles that can access Broadcast. Producer (deleted) is gone; Broadcast is now
// admin + director. The per-project ACL is still enforced at the DB layer.
export const BROADCAST_TIER_ROLES = new Set(['admin', ...DIRECTOR_ROLES]);

export function canAccessBroadcast(role) {
  return BROADCAST_TIER_ROLES.has(role);
}

export function getRestrictedNavKeys(role) {
  return ROLE_RESTRICTED_NAV_KEYS[role] || new Set();
}

export function canAccessNavKey(role, key) {
  return !getRestrictedNavKeys(role).has(key);
}

// Admin-tier roles for client-side gating. Mirrors the DB is_admin() helper.
// New admin-tier roles must be added here AND to the DB function.
export const ADMIN_TIER_ROLES = new Set(['admin', ...DIRECTOR_ROLES]);

export function isAdminTier(role) {
  return ADMIN_TIER_ROLES.has(role);
}
