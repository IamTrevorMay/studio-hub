// localStorage persistence for Telestration tool

import { STORAGE_KEYS, DEFAULT_SETTINGS } from './telestrationConstants';

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
    console.error('Telestration storage write failed:', e);
  }
}

// --- Settings (tool preferences) ---

export function loadSettings() {
  return safeGet(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
}

export function saveSettings(settings) {
  safeSet(STORAGE_KEYS.settings, settings);
}

// --- Project (annotations + metadata) ---

export function loadProject() {
  return safeGet(STORAGE_KEYS.project, {
    annotations: [],
    sourceFileName: '',
  });
}

export function saveProject(project) {
  safeSet(STORAGE_KEYS.project, project);
}

export function clearProject() {
  try {
    localStorage.removeItem(STORAGE_KEYS.project);
  } catch {}
}
