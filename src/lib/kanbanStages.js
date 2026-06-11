// Unified Content Kanban — shared stage constants.
// Mirror this file in supabase/functions/card-move/index.ts when changing labels.

export const CANONICAL_STAGES = ['queue', 'write', 'produce', 'edit', 'review', 'publish'];

export const BACKLOG_STAGE = 'backlog';

export const STAGE_LABELS_BY_TYPE = {
  mayday_video:      { queue: 'Queue', write: 'Script',  produce: 'Shoot',   edit: 'Edit', review: 'Review', publish: 'Publish' },
  tm_baseball_video: { queue: 'Queue', write: 'Script',  produce: 'Shoot',   edit: 'Edit', review: 'Review', publish: 'Publish' },
  podcast:           { queue: 'Queue', write: 'Outline', produce: 'Record',  edit: 'Edit', review: 'Review', publish: 'Publish' },
  short_form:        { queue: 'Queue', write: 'Concept', produce: 'Capture', edit: 'Cut',  review: 'Review', publish: 'Publish' },
};

export const PROJECT_TYPE_OPTIONS = [
  { value: 'mayday_video',      label: 'Mayday Video',     channel: 'More Mayday' },
  { value: 'tm_baseball_video', label: 'TM Baseball Video', channel: 'Trevor May Baseball' },
  { value: 'podcast',           label: 'Podcast',           channel: 'Podcast' },
  { value: 'short_form',        label: 'Short Form',        channel: 'Shorts' },
];

export const STAGE_COLORS = {
  queue:   '#8b5cf6',
  backlog: '#64748b',
  write:   '#3b82f6',
  produce: '#f59e0b',
  edit:    '#f97316',
  review:  '#ec4899',
  publish: '#22c55e',
};

export function labelFor(projectType, stage) {
  if (!projectType) return stage;
  return STAGE_LABELS_BY_TYPE[projectType]?.[stage] || stage;
}

export function typeLabel(projectType) {
  return PROJECT_TYPE_OPTIONS.find((t) => t.value === projectType)?.label || projectType || 'Untyped';
}
