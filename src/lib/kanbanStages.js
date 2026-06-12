// Unified Content Kanban — shared stage constants.
// Mirror this file in supabase/functions/card-move/index.ts when changing labels.

export const CANONICAL_STAGES = ['queue', 'write', 'pre_production', 'film', 'review', 'edit', 'post_production', 'publish'];

export const BACKLOG_STAGE = 'backlog';

export const STAGE_LABELS_BY_TYPE = {
  mayday_video: {
    queue: 'Queue',
    write: 'Beat Sheet + Broadcast',
    pre_production: 'Filming Prep',
    film: 'Film & Send to Editor',
    review: 'Review & Add B-Roll',
    edit: 'Wait on Edit',
    post_production: 'Thumbnail & Schedule',
    publish: 'Published',
  },
  tm_baseball_video: {
    queue: 'Queue',
    write: 'Beat Sheet + Broadcast',
    pre_production: 'Pre-Production',
    film: 'Film',
    review: 'Review & Add B-Roll',
    edit: 'Edit',
    post_production: 'Thumbnail & Schedule',
    publish: 'Published',
  },
  podcast: {
    queue: 'Queue',
    write: 'Outline',
    pre_production: 'Prep Guest + Rundown',
    film: 'Record',
    review: 'Review',
    edit: 'Edit',
    post_production: 'Show Notes + Schedule',
    publish: 'Published',
  },
  short_form: {
    queue: 'Queue',
    write: 'Concept',
    pre_production: 'Pre-Production',
    film: 'Capture',
    review: 'Review',
    edit: 'Cut',
    post_production: 'Thumbnail + Schedule',
    publish: 'Published',
  },
};

// Per-stage task description (the body of the task that lands in My Tasks).
// Falls through to "Moved from {prevLabel}." when undefined.
export const STAGE_DESCRIPTIONS_BY_TYPE = {
  mayday_video: {
    write: 'Complete beat sheet & update Broadcast.',
    pre_production: 'Finalize beat sheet & push script to teleprompter.',
    film: "Pick the editor. Task auto-completes when the editor's contractor assignment is created.",
    review: '1. Review the Beat Sheet for B-Roll\n2. Add where you see gaps\n3. Download B-Roll files, name them to match Video tags in Beat Sheet\n4. Upload into project folder.',
    edit: 'Monitor editor progress. Task auto-completes when the editor marks their contractor assignment complete.',
    post_production: 'Build the thumbnail, schedule the upload, close out the workflow.',
  },
  tm_baseball_video: {
    write: 'Complete beat sheet & update Broadcast.',
    pre_production: 'Lock shot list, gear, location.',
    film: 'Shoot per shot list.',
    review: '1. Review the Beat Sheet for B-Roll\n2. Add where you see gaps\n3. Download B-Roll files, name them to match Video tags in Beat Sheet\n4. Upload into project folder.',
    edit: 'Cut the video.',
    post_production: 'Build the thumbnail, schedule the upload, close out the workflow.',
  },
  podcast: {
    write: 'Draft topic outline + show notes skeleton.',
    pre_production: 'Confirm guest, share rundown, test audio chain.',
    film: 'Run the recording session.',
    edit: 'Edit audio + video.',
    post_production: 'Write show notes, schedule release.',
  },
  short_form: {
    write: 'Lock the hook, beats, on-screen text.',
    film: 'Capture all footage on shot list.',
    edit: 'Cut + add captions/text.',
    post_production: 'Build thumb, schedule across platforms.',
  },
};

// Stages each type pre-skips on project creation. Admin can un-skip per project.
export const TYPE_DEFAULT_SKIPS = {
  mayday_video: [],
  tm_baseball_video: [],
  podcast: ['review'],
  short_form: ['pre_production', 'review'],
};

export const PROJECT_TYPE_OPTIONS = [
  { value: 'mayday_video',      label: 'Mayday Video',     channel: 'More Mayday' },
  { value: 'tm_baseball_video', label: 'TM Baseball Video', channel: 'Trevor May Baseball' },
  { value: 'podcast',           label: 'Podcast',           channel: 'Podcast' },
  { value: 'short_form',        label: 'Short Form',        channel: 'Shorts' },
];

export const TYPE_COLORS = {
  mayday_video:      { fg: '#f87171', bg: 'rgba(248,113,113,0.15)', border: 'rgba(248,113,113,0.35)' },
  tm_baseball_video: { fg: '#34d399', bg: 'rgba(52,211,153,0.15)',  border: 'rgba(52,211,153,0.35)' },
  podcast:           { fg: '#c084fc', bg: 'rgba(192,132,252,0.15)', border: 'rgba(192,132,252,0.35)' },
  short_form:        { fg: '#fbbf24', bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.35)' },
};

export function typeColors(projectType) {
  return TYPE_COLORS[projectType] || { fg: '#94a3b8', bg: 'rgba(148,163,184,0.15)', border: 'rgba(148,163,184,0.35)' };
}

export const STAGE_COLORS = {
  queue:           '#8b5cf6',
  backlog:         '#64748b',
  write:           '#3b82f6',
  pre_production:  '#0ea5e9',
  film:            '#f59e0b',
  review:          '#ec4899',
  edit:            '#f97316',
  post_production: '#a855f7',
  publish:         '#22c55e',
};

export function labelFor(projectType, stage) {
  if (!projectType) return stage;
  return STAGE_LABELS_BY_TYPE[projectType]?.[stage] || stage;
}

export function descriptionFor(projectType, stage) {
  if (!projectType) return null;
  return STAGE_DESCRIPTIONS_BY_TYPE[projectType]?.[stage] || null;
}

export function defaultStageConfigForType(projectType) {
  const skips = TYPE_DEFAULT_SKIPS[projectType] || [];
  const cfg = {};
  for (const stage of skips) cfg[stage] = { skip: true };
  return cfg;
}

export function typeLabel(projectType) {
  return PROJECT_TYPE_OPTIONS.find((t) => t.value === projectType)?.label || projectType || 'Untyped';
}
