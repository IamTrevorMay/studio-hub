import { create } from 'zustand'
import type { JSONContent } from '@tiptap/react'
import type { DocumentSource } from '../types'

// Maps source table for future Supabase queries
const TABLE_MAP: Record<DocumentSource, string> = {
  concept_documents: 'concept_documents',
  show_documents: 'show_documents',
  resource_documents: 'resource_documents',
}

const PARENT_KEY_MAP: Record<DocumentSource, string> = {
  concept_documents: 'concept_id',
  show_documents: 'show_id',
  resource_documents: 'folder_id',
}

const STORAGE_KEY = 'maydaydocs-documents'
const SETTINGS_KEY = 'maydaydocs-settings'

// ── Page setup types ──

export type PageSizeName = 'letter' | 'a4' | 'legal'
export type MarginPreset = 'normal' | 'narrow' | 'wide' | 'custom'
export type Orientation = 'portrait' | 'landscape'

export interface PageDimensions {
  width: number  // in px at 96dpi
  height: number
}

export interface Margins {
  top: number    // in inches
  right: number
  bottom: number
  left: number
}

export const PAGE_SIZES: Record<PageSizeName, PageDimensions> = {
  letter: { width: 816, height: 1056 },  // 8.5 × 11 in
  a4:     { width: 794, height: 1123 },  // 210 × 297 mm
  legal:  { width: 816, height: 1344 },  // 8.5 × 14 in
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

// ── Comment types ──

export interface Comment {
  id: string
  author: string
  text: string
  createdAt: string
}

export interface CommentThread {
  id: string
  comments: Comment[]
  resolved: boolean
  createdAt: string
}

// ── Document type ──

export interface LocalDocument {
  id: string
  title: string
  content: JSONContent
  createdAt: string
  updatedAt: string
  wordCount: number
  comments: CommentThread[]
}

// ── Persistence helpers ──

function loadDocuments(): LocalDocument[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistDocuments(docs: LocalDocument[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs))
}

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

function generateId(): string {
  return crypto.randomUUID()
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
  activeDocumentId: string | null
  documents: LocalDocument[]
  isSidebarOpen: boolean
  isSaving: boolean
  lastSavedAt: number | null
  zoom: number
  pageSetup: PageSetup
  authorName: string
  focusMode: boolean
  theme: 'light' | 'dark'
  defaultFont: string
  defaultPageSize: PageSizeName

  // Document CRUD
  createDocument: () => string
  deleteDocument: (id: string) => void
  setActiveDocument: (id: string | null) => void
  updateTitle: (id: string, title: string) => void
  updateContent: (id: string, content: JSONContent, wordCount: number) => void
  saveToLocalStorage: () => void

  // Comments
  addCommentThread: (docId: string, thread: CommentThread) => void
  addReply: (docId: string, threadId: string, comment: Comment) => void
  resolveThread: (docId: string, threadId: string) => void
  unresolveThread: (docId: string, threadId: string) => void
  deleteThread: (docId: string, threadId: string) => void

  // UI
  toggleSidebar: () => void
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

const initialDocs = loadDocuments()
const initialSettings = loadSettings()

// Apply theme before first render
document.documentElement.dataset.theme = initialSettings.theme

export const useEditorStore = create<EditorState>((set, get) => ({
  activeDocumentId: initialDocs.length > 0 ? initialDocs[0].id : null,
  documents: initialDocs.map((d) => ({ ...d, comments: d.comments ?? [] })),
  isSidebarOpen: true,
  isSaving: false,
  lastSavedAt: null,
  zoom: initialSettings.zoom,
  pageSetup: initialSettings.pageSetup,
  authorName: initialSettings.authorName,
  focusMode: false,
  theme: initialSettings.theme,
  defaultFont: initialSettings.defaultFont,
  defaultPageSize: initialSettings.defaultPageSize,

  createDocument: () => {
    const id = generateId()
    const now = new Date().toISOString()
    const doc: LocalDocument = {
      id,
      title: 'Untitled',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      createdAt: now,
      updatedAt: now,
      wordCount: 0,
      comments: [],
    }
    set((s) => {
      const documents = [doc, ...s.documents]
      persistDocuments(documents)
      return { documents, activeDocumentId: id }
    })
    return id
  },

  deleteDocument: (id) => {
    set((s) => {
      const documents = s.documents.filter((d) => d.id !== id)
      persistDocuments(documents)
      const activeDocumentId =
        s.activeDocumentId === id
          ? documents.length > 0
            ? documents[0].id
            : null
          : s.activeDocumentId
      return { documents, activeDocumentId }
    })
  },

  setActiveDocument: (id) => set({ activeDocumentId: id }),

  updateTitle: (id, title) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, title, updatedAt: new Date().toISOString() } : d
      ),
    }))
  },

  updateContent: (id, content, wordCount) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, content, wordCount, updatedAt: new Date().toISOString() } : d
      ),
    }))
  },

  saveToLocalStorage: () => {
    const { documents } = get()
    persistDocuments(documents)
    set({ lastSavedAt: Date.now(), isSaving: false })
  },

  addCommentThread: (docId, thread) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId ? { ...d, comments: [...d.comments, thread] } : d
      ),
    }))
    get().saveToLocalStorage()
  },

  addReply: (docId, threadId, comment) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              comments: d.comments.map((t) =>
                t.id === threadId ? { ...t, comments: [...t.comments, comment] } : t
              ),
            }
          : d
      ),
    }))
    get().saveToLocalStorage()
  },

  resolveThread: (docId, threadId) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              comments: d.comments.map((t) =>
                t.id === threadId ? { ...t, resolved: true } : t
              ),
            }
          : d
      ),
    }))
    get().saveToLocalStorage()
  },

  unresolveThread: (docId, threadId) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              comments: d.comments.map((t) =>
                t.id === threadId ? { ...t, resolved: false } : t
              ),
            }
          : d
      ),
    }))
    get().saveToLocalStorage()
  },

  deleteThread: (docId, threadId) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? { ...d, comments: d.comments.filter((t) => t.id !== threadId) }
          : d
      ),
    }))
    get().saveToLocalStorage()
  },

  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),

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

export { TABLE_MAP, PARENT_KEY_MAP }
