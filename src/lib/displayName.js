// Display name resolution for social / communication contexts.
// Admin contexts (Payroll, Assignments, Workflows, BD, etc.) keep showing
// profile.full_name directly — that's the legal name.
//
// Social contexts (chat, DMs, posts, comments, channel rosters, mentions,
// header user widget) should call getDisplayName(profile) instead so the
// user's nickname shows up where appropriate.

export function getDisplayName(profile) {
  if (!profile) return '';
  if (profile.nickname && profile.nickname.trim()) return profile.nickname.trim();
  const full = (profile.full_name || '').trim();
  if (!full) return '';
  return full.split(/\s+/)[0];
}

export function getDisplayInitial(profile) {
  const name = getDisplayName(profile);
  return name?.[0]?.toUpperCase() || '?';
}
