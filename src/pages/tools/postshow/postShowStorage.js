// LocalStorage persistence for Clipping Tool data.
//
// Session (current source file + clips) is intentionally per-device — the
// source video lives on the local disk and there's no point syncing the
// half-edited cut list to other machines. Recipients / settings are also
// per-device for now; we plan to migrate them to Supabase later (per the
// "user content must sync across machines" rule). Punted at user's request.

const STORAGE_KEYS = {
  session: 'postshow_session',
  recipients: 'postshow_recipients',
  settings: 'postshow_settings',
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

// --- Session ---

export function loadSession() {
  return safeGet(STORAGE_KEYS.session, {
    sourceFileName: '',
    showDate: new Date().toISOString().slice(0, 10),
    clips: [],
  });
}

export function saveSession(session) {
  safeSet(STORAGE_KEYS.session, session);
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

// --- Recipients ---
//
// Each recipient stores a Drive folder ID + display name (selected via the
// folder picker). The legacy `driveFolderPath` / `discordChannelId` /
// `discordUserId` fields were dropped when the Discord notify step was
// removed; load() upgrades any old rows in localStorage to the new shape.

export function loadRecipients() {
  const raw = safeGet(STORAGE_KEYS.recipients, [
    { id: 'aaron', name: 'Aaron', driveFolderId: '', driveFolderName: '' },
    { id: 'alana', name: 'Alana', driveFolderId: '', driveFolderName: '' },
  ]);
  return raw.map(r => ({
    id: r.id,
    name: r.name || '',
    driveFolderId: r.driveFolderId || '',
    driveFolderName: r.driveFolderName || r.driveFolderPath || '',
  }));
}

export function saveRecipients(recipients) {
  safeSet(STORAGE_KEYS.recipients, recipients);
}

// --- Settings ---

export function loadSettings() {
  const raw = safeGet(STORAGE_KEYS.settings, {});
  return {
    defaultOutputFormat: raw.defaultOutputFormat || 'mp4',
    framePerfect: raw.framePerfect !== false, // default true
    autoKanbanSync: raw.autoKanbanSync !== false, // default true
  };
}

export function saveSettings(settings) {
  safeSet(STORAGE_KEYS.settings, settings);
}
