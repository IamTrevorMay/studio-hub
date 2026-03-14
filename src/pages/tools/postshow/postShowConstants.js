// Post-Show Workflow Automation Constants & Data Models

export const PHASES = [
  { key: 'cut', label: 'Cut', description: 'Mark timestamps and batch cut video clips' },
  { key: 'upload', label: 'Upload', description: 'Assign and upload clips to Google Drive' },
  { key: 'notify', label: 'Notify', description: 'Send Discord notifications to editors' },
  { key: 'kanban', label: 'Kanban', description: 'Sync clips to project board cards' },
];

export const PHASE_COLORS = {
  cut: '#6366f1',
  upload: '#3b82f6',
  notify: '#f59e0b',
  kanban: '#22c55e',
};

export const CLIP_TYPES = ['short', 'long'];

export const OUTPUT_FORMATS = ['mp4', 'mov'];

// Default recipients — user can edit these in settings
export const DEFAULT_RECIPIENTS = [
  { id: 'aaron', name: 'Aaron', driveFolderPath: '', discordChannelId: '', discordUserId: '' },
  { id: 'alana', name: 'Alana', driveFolderPath: '', discordChannelId: '', discordUserId: '' },
];

export const DISCORD_TEMPLATE_TYPES = ['video_assignment', 'podcast_assignment'];

export const CLIP_STATUSES = ['pending', 'cutting', 'cut', 'uploading', 'uploaded', 'notified', 'synced', 'error'];

export const STATUS_LABELS = {
  pending: 'Pending',
  cutting: 'Cutting',
  cut: 'Cut',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  notified: 'Notified',
  synced: 'Synced',
  error: 'Error',
};

export const STATUS_COLORS = {
  pending: '#64748b',
  cutting: '#f59e0b',
  cut: '#6366f1',
  uploading: '#3b82f6',
  uploaded: '#22c55e',
  notified: '#ec4899',
  synced: '#10b981',
  error: '#ef4444',
};

// Create a blank clip object
export function createClip(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    title: '',
    startTime: '',
    endTime: '',
    type: 'short',
    timeSensitive: false,
    postByDate: '',
    showDate: new Date().toISOString().slice(0, 10),
    assignee: '',
    driveFolder: '',
    status: 'pending',
    outputFormat: 'mp4',
    ...overrides,
  };
}

// Create a blank podcast assignment object
export function createPodcastAssignment(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    title: '',
    startTime: '',
    endTime: '',
    assignee: '',
    discordChannelId: '',
    status: 'pending',
    ...overrides,
  };
}

// Parse HH:MM:SS to total seconds
export function parseTimestamp(ts) {
  if (!ts) return null;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

// Format seconds to HH:MM:SS
export function formatTimestamp(seconds) {
  if (seconds == null || isNaN(seconds)) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

// Validate a timestamp string
export function isValidTimestamp(ts) {
  if (!ts) return false;
  return /^\d{1,2}:\d{2}:\d{2}$/.test(ts) && parseTimestamp(ts) !== null;
}

// Validate clip has required fields for cutting
export function isClipReady(clip) {
  return clip.title.trim() !== '' &&
    isValidTimestamp(clip.startTime) &&
    isValidTimestamp(clip.endTime) &&
    parseTimestamp(clip.endTime) > parseTimestamp(clip.startTime);
}
