// Unified Content Kanban — shared stage constants.
// Mirror this file in supabase/functions/card-move/index.ts when changing labels.

export const CANONICAL_STAGES = ['queue', 'write', 'pre_production', 'film', 'review', 'edit', 'post_production', 'publish'];

export const BACKLOG_STAGE = 'backlog';

export const STAGE_LABELS_BY_TYPE = {
  mayday_video: {
    queue: 'Queue',
    write: 'Beat Sheet + Broadcast',
    pre_production: 'Filming Prep',
    film: 'Film + Assign Editor',
    review: 'Review & Add B-Roll',
    edit: 'Wait on Edit',
    post_production: 'Thumbnail & Schedule',
    publish: 'Published',
  },
  tm_baseball_video: {
    queue: 'Queue',
    write: 'Beat Sheet',
    pre_production: 'Pre-Production',
    film: 'Film',
    review: 'Review + Storyboard',
    edit: 'Arrange + Edit',
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
    edit: 'Cut + Caption',
    post_production: 'Schedule',
    publish: 'Published',
  },
};

// Per-stage task description (the body of the task that lands in My Tasks).
// Falls through to "Moved from {prevLabel}." when undefined.
export const STAGE_DESCRIPTIONS_BY_TYPE = {
  mayday_video: {
    write: 'Complete a beat sheet & update Broadcast.',
    pre_production: 'Finalize beat sheet & push script to teleprompter.',
    film: 'Film the full video & create the assignment for the editor.',
    review: '',
    edit: 'Monitor editor progress. *Task auto-completes when the editor marks their contractor assignment complete.*',
    post_production: 'Build the thumbnail & schedule the upload.',
  },
  tm_baseball_video: {
    write: 'Complete a beat sheet.',
    pre_production: 'Lock shot list, gear, location.',
    film: 'Run pre shoot tests, then shoot per shot list.',
    review: '1. Review footage from shoot\n2. Storyboard the video structure & build a plan for next steps\n3. Locate & gather any music, assets, or additional b-roll you may need.\n4. Record any VO or corrections & add to assets.',
    edit: 'Arrange & Edit the video.',
    post_production: 'Build the thumbnail, schedule the upload, close out the workflow.',
  },
  podcast: {
    write: 'Draft topic outline + show notes skeleton.',
    pre_production: 'Confirm guest if necessary, share rundown, test audio chain.',
    film: 'Run the recording session. REMEMBER: Record local redundancies for audio & video',
    edit: 'Edit audio + video (if necessary).',
    post_production: 'Write show notes, schedule release.',
  },
  short_form: {
    write: 'Lock the hook, beats, on-screen text.',
    film: 'Capture all footage on shot list.',
    edit: 'Cut + add captions/text/thumbnail frame.',
    post_production: 'Schedule across platforms.',
  },
};

// Stages each type pre-skips on project creation. Admin can un-skip per project.
export const TYPE_DEFAULT_SKIPS = {
  mayday_video: [],
  tm_baseball_video: [],
  podcast: ['review'],
  short_form: ['pre_production', 'review'],
};

// Default stage assignees seeded into project_stage_assignments on creation, keyed by type → stage → [profile id].
// Edit these ids when team members change.
export const TYPE_DEFAULT_ASSIGNEES = {
  mayday_video: {
    queue: [],
    write: ['aff29906-eda8-4c3f-8a1e-a550b5bbe45d'],            // David Korn
    pre_production: [
      'c3290048-436b-46c6-b3f0-fdf7923d0c3b',                   // Trevor May
      '7b1e50e0-cede-409d-a160-1aa6d1e232a9',                   // Henry Neiman
      'ed7541f9-213d-4868-9147-5e638cbb6883',                   // Caleb Bartholomae
    ],
    film: ['c3290048-436b-46c6-b3f0-fdf7923d0c3b'],             // Trevor May
    review: [],
    edit: ['dc5d43c8-60e2-4721-8b81-aed9aa12aab6'],             // Aaron Diament
    post_production: ['c3290048-436b-46c6-b3f0-fdf7923d0c3b'],  // Trevor May
    publish: [],
  },
};

// Rows ready for insert into project_stage_assignments for a freshly created project.
export function defaultAssigneeRowsForType(projectType, projectId) {
  const map = TYPE_DEFAULT_ASSIGNEES[projectType];
  if (!map) return [];
  const rows = [];
  for (const [stage, userIds] of Object.entries(map)) {
    for (const userId of userIds) {
      rows.push({ project_id: projectId, stage, user_id: userId });
    }
  }
  return rows;
}

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
