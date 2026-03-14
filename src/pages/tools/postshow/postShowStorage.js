// LocalStorage persistence for Post-Show workflow data

const STORAGE_KEYS = {
  session: 'postshow_session',
  recipients: 'postshow_recipients',
  settings: 'postshow_settings',
  discordTemplates: 'postshow_discord_templates',
};

function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('PostShow storage write failed:', e);
  }
}

// --- Session (clips, source file, podcast assignments) ---

export function loadSession() {
  return safeGet(STORAGE_KEYS.session, {
    sourceFileName: '',
    sourceFilePath: '',
    showDate: new Date().toISOString().slice(0, 10),
    clips: [],
    podcastAssignments: [],
  });
}

export function saveSession(session) {
  safeSet(STORAGE_KEYS.session, session);
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

// --- Recipients ---

export function loadRecipients() {
  return safeGet(STORAGE_KEYS.recipients, [
    { id: 'aaron', name: 'Aaron', driveFolderPath: '', discordChannelId: '', discordUserId: '' },
    { id: 'alana', name: 'Alana', driveFolderPath: '', discordChannelId: '', discordUserId: '' },
  ]);
}

export function saveRecipients(recipients) {
  safeSet(STORAGE_KEYS.recipients, recipients);
}

// --- Settings ---

export function loadSettings() {
  return safeGet(STORAGE_KEYS.settings, {
    defaultOutputFormat: 'mp4',
    apiBaseUrl: 'http://localhost:4400',
    googleDriveConnected: false,
    discordConnected: false,
    discordBotToken: '',
    autoKanbanSync: true,
  });
}

export function saveSettings(settings) {
  safeSet(STORAGE_KEYS.settings, settings);
}

// --- Discord Templates ---

export function loadDiscordTemplates() {
  return safeGet(STORAGE_KEYS.discordTemplates, {
    video_assignment: {
      name: 'Video Assignment',
      template: 'New video assignment for {assignee}:\n\nTitle: {title}\nType: {type}\nTime-Sensitive: {timeSensitive}\nPost By: {postByDate}\nShow Date: {showDate}\nDrive Link: {driveLink}\n\nPlease begin editing at your earliest convenience.',
    },
    podcast_assignment: {
      name: 'Podcast Assignment',
      template: 'New podcast clip assignment for {assignee}:\n\nTitle: {title}\nTimestamp: {startTime} - {endTime}\n\nPlease cut and prepare this segment.',
    },
  });
}

export function saveDiscordTemplates(templates) {
  safeSet(STORAGE_KEYS.discordTemplates, templates);
}
