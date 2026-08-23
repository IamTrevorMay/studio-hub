// Per-tab mobile support level. Drives:
// - Sidebar drawer filtering (excluded tabs hidden on mobile)
// - DesktopOnlyScreen routing (excluded tabs that get visited via direct URL)
// - useReadOnlyOnMobile hook (pages hide add/edit/delete controls)
//
// Levels:
//   'full'      - full mobile redesign planned (Phase 2/3)
//   'condensed' - mobile-only condensed view (top KPIs, hidden deep tables)
//   'readonly'  - viewable on mobile but no add/edit/delete
//   'excluded'  - desktop-only; mobile shows DesktopOnlyScreen

export const MOBILE_SUPPORT = {
  // Daily drivers — full redesign
  dashboard: 'full',
  production: 'full',
  ideation: 'full',
  calendar: 'full',
  research: 'full',
  messages: 'full',
  admin: 'full',
  fl_dashboard: 'full',

  // Condensed views
  projects: 'condensed',
  channels: 'condensed',

  // Read-only on mobile
  deliverables: 'readonly',
  goals: 'readonly',
  business_dev: 'readonly',
  resources: 'readonly',
  // Invoicing has full create/edit on mobile
  invoicing: 'full',
  // Admin pages with mobile builds
  workflows: 'full',
  freelancers: 'full',
  ops: 'full',
  analytics: 'full',
  tracking: 'readonly',
  reviews: 'full',

  // Excluded — show DesktopOnlyScreen if visited
  assets: 'excluded',
  write: 'excluded',
  tools: 'excluded',
  screenwriter: 'excluded',
  fl_hours: 'excluded',
  fl_notifications: 'excluded',
  fl_profile: 'excluded',
  doc_editor: 'excluded',
  whiteboard: 'excluded',
  storyboard: 'excluded',
  sticky_board: 'excluded',
  post_show: 'excluded',
  teleprompter: 'excluded',
  telestration: 'excluded',
  organize: 'excluded',
  broadcast: 'excluded',
};

export function getMobileSupport(tabKey) {
  return MOBILE_SUPPORT[tabKey] || 'full';
}

export function isExcludedOnMobile(tabKey) {
  return MOBILE_SUPPORT[tabKey] === 'excluded';
}

export function isReadOnlyOnMobile(tabKey) {
  return MOBILE_SUPPORT[tabKey] === 'readonly';
}

// Filter a resolved nav tree (from useNavConfig) to drop entries that are
// excluded on mobile. Folders that end up with no surviving children are dropped too.
export function filterNavForMobile(resolvedNav) {
  const survivors = resolvedNav.filter((entry) => {
    if (entry.type === 'folder') return true;
    return !isExcludedOnMobile(entry.key);
  });

  // Build folder child counts among survivors
  const folderChildCount = {};
  survivors.forEach((entry) => {
    if (entry.type === 'item' && entry.folderId) {
      folderChildCount[entry.folderId] = (folderChildCount[entry.folderId] || 0) + 1;
    }
  });

  return survivors.filter((entry) => {
    if (entry.type !== 'folder') return true;
    return (folderChildCount[entry.id] || 0) > 0;
  });
}
