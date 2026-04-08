const SETTINGS_KEY = 'studio-hub-teleprompter-settings';
const SCRIPT_KEY = 'studio-hub-teleprompter-script';

const DEFAULT_SETTINGS = {
  speed: 3,
  fontSize: 36,
  mirrored: false,
  textColor: '#ffffff',
  fontFamily: 'sans-serif',
  textAlign: 'center',
  textOpacity: 0.95,
  margins: 10,
  countdownSeconds: 3,
  layout: 'overlay',
  showCamera: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // quota exceeded — silently ignore
  }
}

export function loadScript() {
  try {
    return localStorage.getItem(SCRIPT_KEY) || '';
  } catch {
    return '';
  }
}

export function saveScript(text) {
  try {
    localStorage.setItem(SCRIPT_KEY, text);
  } catch {
    // quota exceeded
  }
}

