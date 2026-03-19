import { create } from 'zustand'

// ── Page setup types ──

export type PageSizeName = 'letter' | 'a4' | 'legal'
export type MarginPreset = 'normal' | 'narrow' | 'wide' | 'custom'
export type Orientation = 'portrait' | 'landscape'

export interface PageDimensions {
  width: number
  height: number
}

export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

export const PAGE_SIZES: Record<PageSizeName, PageDimensions> = {
  letter: { width: 816, height: 1056 },
  a4:     { width: 794, height: 1123 },
  legal:  { width: 816, height: 1344 },
}

export const MARGIN_PRESETS: Record<Exclude<MarginPreset, 'custom'>, Margins> = {
  normal: { top: 1, right: 1, bottom: 1, left: 1 },
  narrow: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
  wide:   { top: 1, right: 1.5, bottom: 1, left: 1.5 },
}

export interface PageSetup {
  pageSize: PageSizeName
  marginPreset: MarginPreset
  margins: Margins
  orientation: Orientation
  showPageBreaks: boolean
}

const DEFAULT_PAGE_SETUP: PageSetup = {
  pageSize: 'letter',
  marginPreset: 'normal',
  margins: { top: 1, right: 1, bottom: 1, left: 1 },
  orientation: 'portrait',
  showPageBreaks: true,
}

// ── Persistence helpers ──

const SETTINGS_KEY = 'maydaydocs-settings'

interface PersistedSettings {
  zoom: number
  pageSetup: PageSetup
  authorName: string
  theme: 'light' | 'dark'
  defaultFont: string
  defaultPageSize: PageSizeName
}

const DEFAULT_SETTINGS: PersistedSettings = {
  zoom: 100,
  pageSetup: DEFAULT_PAGE_SETUP,
  authorName: 'You',
  theme: 'dark',
  defaultFont: 'Arial, sans-serif',
  defaultPageSize: 'letter',
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        zoom: parsed.zoom ?? DEFAULT_SETTINGS.zoom,
        pageSetup: { ...DEFAULT_PAGE_SETUP, ...parsed.pageSetup },
        authorName: parsed.authorName ?? DEFAULT_SETTINGS.authorName,
        theme: parsed.theme ?? DEFAULT_SETTINGS.theme,
        defaultFont: parsed.defaultFont ?? DEFAULT_SETTINGS.defaultFont,
        defaultPageSize: parsed.defaultPageSize ?? DEFAULT_SETTINGS.defaultPageSize,
      }
    }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

function persistCurrentSettings(get: () => EditorState) {
  const s = get()
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    zoom: s.zoom,
    pageSetup: s.pageSetup,
    authorName: s.authorName,
    theme: s.theme,
    defaultFont: s.defaultFont,
    defaultPageSize: s.defaultPageSize,
  }))
}

// ── Computed page helpers ──

export function getEffectivePageDimensions(setup: PageSetup): PageDimensions {
  const base = PAGE_SIZES[setup.pageSize]
  if (setup.orientation === 'landscape') {
    return { width: base.height, height: base.width }
  }
  return base
}

export function getMarginsInPx(margins: Margins): { top: number; right: number; bottom: number; left: number } {
  return {
    top: margins.top * 96,
    right: margins.right * 96,
    bottom: margins.bottom * 96,
    left: margins.left * 96,
  }
}

// ── Store ──

interface EditorState {
  isSaving: boolean
  lastSavedAt: number | null
  zoom: number
  pageSetup: PageSetup
  authorName: string
  focusMode: boolean
  theme: 'light' | 'dark'
  defaultFont: string
  defaultPageSize: PageSizeName

  // UI
  setZoom: (zoom: number) => void
  setSaving: (saving: boolean) => void
  setLastSavedAt: (time: number | null) => void
  toggleFocusMode: () => void
  setTheme: (theme: 'light' | 'dark') => void

  // Settings
  setPageSetup: (setup: Partial<PageSetup>) => void
  setAuthorName: (name: string) => void
  setDefaultFont: (font: string) => void
  setDefaultPageSize: (size: PageSizeName) => void
}

const initialSettings = loadSettings()

// Apply theme before first render
document.documentElement.dataset.theme = initialSettings.theme

export const useEditorStore = create<EditorState>((set, get) => ({
  isSaving: false,
  lastSavedAt: null,
  zoom: initialSettings.zoom,
  pageSetup: initialSettings.pageSetup,
  authorName: initialSettings.authorName,
  focusMode: false,
  theme: initialSettings.theme,
  defaultFont: initialSettings.defaultFont,
  defaultPageSize: initialSettings.defaultPageSize,

  setZoom: (zoom) => {
    const clamped = Math.min(200, Math.max(50, zoom))
    set({ zoom: clamped })
    persistCurrentSettings(get)
  },

  setSaving: (isSaving) => set({ isSaving }),
  setLastSavedAt: (lastSavedAt) => set({ lastSavedAt }),

  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme
    set({ theme })
    persistCurrentSettings(get)
  },

  setPageSetup: (partial) => {
    set((s) => ({ pageSetup: { ...s.pageSetup, ...partial } }))
    persistCurrentSettings(get)
  },

  setAuthorName: (authorName) => {
    set({ authorName })
    persistCurrentSettings(get)
  },

  setDefaultFont: (defaultFont) => {
    set({ defaultFont })
    persistCurrentSettings(get)
  },

  setDefaultPageSize: (defaultPageSize) => {
    set({ defaultPageSize })
    persistCurrentSettings(get)
  },
}))
