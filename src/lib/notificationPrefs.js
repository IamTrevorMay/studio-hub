// Notification categories for per-user, per-surface (desktop/mobile) toggles.
// Preferences live in profiles.notification_prefs as sparse jsonb:
//   { desktop: { tasks: false }, mobile: { contractors: false } }
// A missing key means enabled — only opt-outs are stored, so new categories
// default to on for everyone. The send-push edge function mirrors this
// mapping (supabase/functions/send-push/index.ts) — keep the two in sync.

export const NOTIF_CATEGORIES = [
  { key: 'tasks', label: 'Tasks & Assignments', caption: 'New tasks and assignment updates' },
  { key: 'roadmap', label: 'Roadmap', caption: 'Due and overdue Roadmap items' },
  { key: 'contractors', label: 'Contractors', caption: 'Contractor comments, submissions, and hours' },
  { key: 'team', label: 'Team', caption: 'OOO requests and status changes' },
  { key: 'automations', label: 'Automations', caption: 'Tasks and alerts created by automations' },
  { key: 'other', label: 'Everything else', caption: 'Any alerts not covered above' },
];

const TYPE_TO_CATEGORY = {
  task_assigned: 'tasks',
  assignment: 'tasks',
  automation: 'automations',
  ooo_request: 'team',
  status_change: 'team',
};

export function categoryForType(type) {
  if (!type) return 'other';
  if (TYPE_TO_CATEGORY[type]) return TYPE_TO_CATEGORY[type];
  if (type.startsWith('bd_')) return 'roadmap';
  if (type.startsWith('fl_')) return 'contractors';
  return 'other';
}

// surface: 'desktop' | 'mobile'
export function isCategoryEnabled(prefs, surface, categoryKey) {
  return prefs?.[surface]?.[categoryKey] !== false;
}

export function isTypeEnabled(prefs, surface, type) {
  return isCategoryEnabled(prefs, surface, categoryForType(type));
}
