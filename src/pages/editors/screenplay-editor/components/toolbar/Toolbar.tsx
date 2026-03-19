import { useState, useEffect, useRef, useCallback } from 'react'
import type { ScriptElementType } from '../../types'
import type { WritingMode, ScreenplayTheme } from '../../lib/screenplay/preferences'

// ─── Types ───

export interface ToolbarProps {
  // Navigation
  onBack: () => void

  // Title
  scriptTitle: string
  onTitleChange: (title: string) => void

  // Panels
  sidebarOpen: boolean
  onToggleSidebar: () => void
  charPanelOpen: boolean
  onToggleCharPanel: () => void
  notesPanelOpen: boolean
  onToggleNotesPanel: () => void

  // Element type
  activeType: ScriptElementType | null
  onChangeType: (type: string) => void

  // Page count / word count / save
  pageCount: number
  wordCount: number
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'

  // File actions
  onSave: () => void
  onExportPDF: () => void
  onExportFDX: () => void
  onExportTXT: () => void

  // Edit actions
  onUndo: () => void
  onRedo: () => void
  findReplaceOpen: boolean
  onToggleFindReplace: () => void

  // Format
  showSceneNumbers: boolean
  onToggleSceneNumbers: () => void
  revisionMode: boolean
  onToggleRevisionMode: () => void

  // Writing mode & theme
  writingMode: WritingMode
  onWritingModeChange: (mode: WritingMode) => void
  theme: ScreenplayTheme
  onThemeChange: (theme: ScreenplayTheme) => void
  zoom: number
  onZoomChange: (zoom: number) => void
}

// ─── Element type definitions ───

const ELEMENT_TYPES: { type: string; label: string; short: string }[] = [
  { type: 'scene-heading', label: 'Scene Heading', short: 'SCENE' },
  { type: 'action', label: 'Action', short: 'ACT' },
  { type: 'character', label: 'Character', short: 'CHAR' },
  { type: 'dialogue', label: 'Dialogue', short: 'DIA' },
  { type: 'parenthetical', label: 'Parenthetical', short: 'PAREN' },
  { type: 'transition', label: 'Transition', short: 'TRANS' },
]

const ZOOM_LEVELS = [75, 80, 90, 100, 110, 125, 150]

// ─── Theme color tokens ───

const themeTokens = {
  dark: {
    chrome: 'rgba(255,255,255,0.02)',
    border: 'rgba(255,255,255,0.06)',
    text: '#e2e8f0',
    textMuted: 'rgba(255,255,255,0.35)',
    textSecondary: 'rgba(255,255,255,0.5)',
    textBright: 'rgba(255,255,255,0.8)',
    textDim: 'rgba(255,255,255,0.2)',
    textSubtle: 'rgba(255,255,255,0.25)',
    overlay: 'rgba(255,255,255,0.04)',
    overlayLight: 'rgba(255,255,255,0.06)',
    overlayMedium: 'rgba(255,255,255,0.08)',
    overlaySubtle: 'rgba(255,255,255,0.03)',
    overlayStrong: 'rgba(255,255,255,0.05)',
    dropdown: '#181828',
    dropdownBorder: 'rgba(255,255,255,0.1)',
    dropdownShadow: '0 8px 28px rgba(0,0,0,0.55)',
    accent: '#818cf8',
    accentLight: '#a5b4fc',
    accentBg: 'rgba(99,102,241,0.08)',
    accentBgStrong: 'rgba(99,102,241,0.12)',
    accentBorder: 'rgba(99,102,241,0.18)',
    accentBorderStrong: 'rgba(99,102,241,0.3)',
    inputBorder: 'rgba(99,102,241,0.35)',
    inputBg: 'rgba(255,255,255,0.04)',
    success: '#34d399',
    error: '#f87171',
    searchStroke: 'rgba(255,255,255,0.3)',
  },
  light: {
    chrome: 'rgba(0,0,0,0.02)',
    border: 'rgba(0,0,0,0.08)',
    text: '#1e293b',
    textMuted: 'rgba(0,0,0,0.4)',
    textSecondary: 'rgba(0,0,0,0.5)',
    textBright: 'rgba(0,0,0,0.8)',
    textDim: 'rgba(0,0,0,0.2)',
    textSubtle: 'rgba(0,0,0,0.25)',
    overlay: 'rgba(0,0,0,0.03)',
    overlayLight: 'rgba(0,0,0,0.05)',
    overlayMedium: 'rgba(0,0,0,0.07)',
    overlaySubtle: 'rgba(0,0,0,0.02)',
    overlayStrong: 'rgba(0,0,0,0.04)',
    dropdown: '#ffffff',
    dropdownBorder: 'rgba(0,0,0,0.12)',
    dropdownShadow: '0 8px 28px rgba(0,0,0,0.12)',
    accent: '#6366f1',
    accentLight: '#4f46e5',
    accentBg: 'rgba(99,102,241,0.08)',
    accentBgStrong: 'rgba(99,102,241,0.12)',
    accentBorder: 'rgba(99,102,241,0.2)',
    accentBorderStrong: 'rgba(99,102,241,0.35)',
    inputBorder: 'rgba(99,102,241,0.35)',
    inputBg: 'rgba(0,0,0,0.03)',
    success: '#16a34a',
    error: '#dc2626',
    searchStroke: 'rgba(0,0,0,0.3)',
  },
}

// ─── Toolbar Component ───

export default function Toolbar(props: ToolbarProps) {
  const {
    onBack,
    scriptTitle,
    onTitleChange,
    sidebarOpen,
    onToggleSidebar,
    charPanelOpen,
    onToggleCharPanel,
    notesPanelOpen,
    onToggleNotesPanel,
    activeType,
    onChangeType,
    pageCount,
    wordCount,
    saveStatus,
    onSave,
    onExportPDF,
    onExportFDX,
    onExportTXT,
    onUndo,
    onRedo,
    findReplaceOpen,
    onToggleFindReplace,
    showSceneNumbers,
    onToggleSceneNumbers,
    revisionMode,
    onToggleRevisionMode,
    writingMode,
    onWritingModeChange,
    theme,
    onThemeChange,
    zoom,
    onZoomChange,
  } = props

  const t = themeTokens[theme]
  const s = getStyles(t)

  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [gearOpen, setGearOpen] = useState(false)

  // Close menu on outside click
  const menuBarRef = useRef<HTMLDivElement>(null)
  const gearRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openMenu && !gearOpen) return
    const handle = (e: MouseEvent) => {
      if (openMenu && menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
      if (gearOpen && gearRef.current && !gearRef.current.contains(e.target as Node)) {
        setGearOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [openMenu, gearOpen])

  const toggleMenu = (name: string) => {
    setOpenMenu((prev) => (prev === name ? null : name))
  }

  const closeAndRun = (fn: () => void) => {
    setOpenMenu(null)
    fn()
  }

  // ─── Inline title editing ───
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(scriptTitle)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitleDraft(scriptTitle)
  }, [scriptTitle])

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [editingTitle])

  const commitTitle = () => {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== scriptTitle) {
      onTitleChange(trimmed)
    } else {
      setTitleDraft(scriptTitle)
    }
    setEditingTitle(false)
  }

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 's') {
        e.preventDefault()
        onSave()
      }
      if (mod && e.key === 'f' && writingMode === 'normal') {
        e.preventDefault()
        onToggleFindReplace()
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onSave, onToggleFindReplace, writingMode])

  const isMac = navigator.platform.includes('Mac')
  const modKey = isMac ? '⌘' : 'Ctrl+'

  const isMinimal = writingMode === 'focus' || writingMode === 'typewriter'
  const modeLabel = writingMode === 'focus' ? 'Focus' : writingMode === 'typewriter' ? 'Typewriter' : ''
  const currentMode: WritingMode = writingMode // capture before narrowing

  // ─── Minimal toolbar for focus/typewriter ───
  if (isMinimal) {
    return (
      <div style={s.root}>
        <button onClick={onBack} style={s.backBtn} title="Back to scripts">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8.5 3L4.5 7l4 4" />
          </svg>
        </button>

        <div style={s.sep} />

        {/* Mode pill */}
        <span style={s.modePill}>{modeLabel}</span>

        {/* Title */}
        <div style={s.titleArea}>
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle()
                if (e.key === 'Escape') {
                  setTitleDraft(scriptTitle)
                  setEditingTitle(false)
                }
              }}
              style={s.titleInput}
              spellCheck={false}
            />
          ) : (
            <span
              style={s.titleText}
              onClick={() => setEditingTitle(true)}
              title="Click to rename"
            >
              {scriptTitle || 'Untitled Screenplay'}
            </span>
          )}
        </div>

        {/* Word count */}
        <span style={s.pageCount}>
          {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
        </span>

        <div style={s.sep} />

        {/* Page count */}
        <span style={s.pageCount}>
          {pageCount} {pageCount === 1 ? 'pg' : 'pgs'}
        </span>

        {/* Gear popover */}
        <div ref={gearRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setGearOpen((v) => !v)}
            style={s.gearBtn}
            title="Writing mode settings"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="7" cy="7" r="2.5" />
              <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1.1 1.1M10.1 10.1l1.1 1.1M11.2 2.8l-1.1 1.1M3.9 10.1l-1.1 1.1" />
            </svg>
          </button>
          {gearOpen && (
            <div style={s.gearDropdown}>
              <button
                style={s.menuItem}
                onClick={() => {
                  setGearOpen(false)
                  onWritingModeChange('normal')
                }}
              >
                <span style={s.menuItemCheck}>{currentMode === 'normal' ? '✓' : ''}</span>
                <span style={s.menuItemLabel}>Normal Mode</span>
              </button>
              <button
                style={s.menuItem}
                onClick={() => {
                  setGearOpen(false)
                  onWritingModeChange('focus')
                }}
              >
                <span style={s.menuItemCheck}>{currentMode === 'focus' ? '✓' : ''}</span>
                <span style={s.menuItemLabel}>Focus Mode</span>
              </button>
              <button
                style={s.menuItem}
                onClick={() => {
                  setGearOpen(false)
                  onWritingModeChange('typewriter')
                }}
              >
                <span style={s.menuItemCheck}>{currentMode === 'typewriter' ? '✓' : ''}</span>
                <span style={s.menuItemLabel}>Typewriter Mode</span>
              </button>
              <div style={s.menuDivider} />
              <button
                style={s.menuItem}
                onClick={() => {
                  setGearOpen(false)
                  onThemeChange(theme === 'dark' ? 'light' : 'dark')
                }}
              >
                <span style={s.menuItemCheck}></span>
                <span style={s.menuItemLabel}>
                  {theme === 'dark' ? 'Industry Standard' : 'Mayday Night'}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Save indicator */}
        <span
          className={`screenplay-save-indicator${saveStatus === 'saved' ? ' screenplay-save-indicator-saved' : ''}`}
          style={s.saveIndicator}
        >
          {saveStatus === 'saving' && (
            <>
              <span className="screenplay-save-spinner" />
              Saving...
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={t.success} strokeWidth="2" style={{ marginRight: 4 }}>
                <path d="M2 6l3 3 5-5" />
              </svg>
              Saved
            </>
          )}
          {saveStatus === 'error' && (
            <span style={{ color: t.error }}>Save failed</span>
          )}
        </span>
      </div>
    )
  }

  // ─── Full toolbar (normal mode) ───
  return (
    <div style={s.root}>
      {/* ─── Back button ─── */}
      <button onClick={onBack} style={s.backBtn} title="Back to scripts">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8.5 3L4.5 7l4 4" />
        </svg>
      </button>

      {/* ─── Separator ─── */}
      <div style={s.sep} />

      {/* ─── Menu bar ─── */}
      <div ref={menuBarRef} style={s.menuBar}>
        {/* File */}
        <MenuButton label="File" isOpen={openMenu === 'file'} onClick={() => toggleMenu('file')} styles={s}>
          <MenuItem label="Save" shortcut={`${modKey}S`} onClick={() => closeAndRun(onSave)} styles={s} />
          <MenuDivider styles={s} />
          <MenuItem label="Export as PDF" onClick={() => closeAndRun(onExportPDF)} styles={s} />
          <MenuItem label="Export as FDX" desc="Final Draft" onClick={() => closeAndRun(onExportFDX)} styles={s} />
          <MenuItem label="Export as TXT" onClick={() => closeAndRun(onExportTXT)} styles={s} />
        </MenuButton>

        {/* Edit */}
        <MenuButton label="Edit" isOpen={openMenu === 'edit'} onClick={() => toggleMenu('edit')} styles={s}>
          <MenuItem label="Undo" shortcut={`${modKey}Z`} onClick={() => closeAndRun(onUndo)} styles={s} />
          <MenuItem label="Redo" shortcut={`⇧${modKey}Z`} onClick={() => closeAndRun(onRedo)} styles={s} />
          <MenuDivider styles={s} />
          <MenuItem
            label="Find & Replace"
            shortcut={`${modKey}F`}
            onClick={() => closeAndRun(onToggleFindReplace)}
            active={findReplaceOpen}
            styles={s}
          />
        </MenuButton>

        {/* Format */}
        <MenuButton label="Format" isOpen={openMenu === 'format'} onClick={() => toggleMenu('format')} styles={s}>
          {ELEMENT_TYPES.map((el) => (
            <MenuItem
              key={el.type}
              label={el.label}
              active={activeType === el.type}
              onClick={() => closeAndRun(() => onChangeType(el.type))}
              styles={s}
            />
          ))}
          <MenuDivider styles={s} />
          <MenuToggle
            label="Scene Numbers"
            checked={showSceneNumbers}
            onClick={() => closeAndRun(onToggleSceneNumbers)}
            styles={s}
          />
          <MenuToggle
            label="Revision Mode"
            checked={revisionMode}
            onClick={() => closeAndRun(onToggleRevisionMode)}
            styles={s}
          />
        </MenuButton>

        {/* View */}
        <MenuButton label="View" isOpen={openMenu === 'view'} onClick={() => toggleMenu('view')} styles={s}>
          <button style={s.menuItem} onClick={() => closeAndRun(() => onWritingModeChange('normal'))}>
            <span style={s.menuItemCheck}>{currentMode === 'normal' ? '✓' : ''}</span>
            <span style={s.menuItemLabel}>Normal</span>
          </button>
          <button style={s.menuItem} onClick={() => closeAndRun(() => onWritingModeChange('focus'))}>
            <span style={s.menuItemCheck}>{currentMode === 'focus' ? '✓' : ''}</span>
            <span style={s.menuItemLabel}>Focus Mode</span>
          </button>
          <button style={s.menuItem} onClick={() => closeAndRun(() => onWritingModeChange('typewriter'))}>
            <span style={s.menuItemCheck}>{currentMode === 'typewriter' ? '✓' : ''}</span>
            <span style={s.menuItemLabel}>Typewriter Mode</span>
          </button>
          <MenuDivider styles={s} />
          <button style={s.menuItem} onClick={() => closeAndRun(() => onThemeChange(theme === 'dark' ? 'light' : 'dark'))}>
            <span style={s.menuItemCheck}></span>
            <span style={s.menuItemLabel}>
              {theme === 'dark' ? 'Switch to Industry Standard' : 'Switch to Mayday Night'}
            </span>
          </button>
          <MenuDivider styles={s} />
          <MenuToggle
            label="Scene Navigator"
            checked={sidebarOpen}
            onClick={() => closeAndRun(onToggleSidebar)}
            styles={s}
          />
          <MenuToggle
            label="Characters"
            checked={charPanelOpen}
            onClick={() => closeAndRun(onToggleCharPanel)}
            styles={s}
          />
          <MenuToggle
            label="Notes"
            checked={notesPanelOpen}
            onClick={() => closeAndRun(onToggleNotesPanel)}
            styles={s}
          />
          <MenuDivider styles={s} />
          <div style={s.zoomRow}>
            <span style={s.zoomLabel}>Zoom</span>
            <div style={s.zoomControls}>
              <button
                style={s.zoomBtn}
                onClick={() => {
                  const idx = ZOOM_LEVELS.indexOf(zoom)
                  if (idx > 0) onZoomChange(ZOOM_LEVELS[idx - 1])
                }}
                disabled={zoom <= ZOOM_LEVELS[0]}
              >
                −
              </button>
              <span style={s.zoomValue}>{zoom}%</span>
              <button
                style={s.zoomBtn}
                onClick={() => {
                  const idx = ZOOM_LEVELS.indexOf(zoom)
                  if (idx < ZOOM_LEVELS.length - 1) onZoomChange(ZOOM_LEVELS[idx + 1])
                }}
                disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              >
                +
              </button>
            </div>
          </div>
        </MenuButton>
      </div>

      {/* ─── Separator ─── */}
      <div style={s.sep} />

      {/* ─── Element type indicator ─── */}
      <div style={s.typeIndicator}>
        {activeType
          ? ELEMENT_TYPES.find((e) => e.type === activeType)?.label ?? ''
          : ''}
      </div>

      {/* ─── Inline editable title ─── */}
      <div style={s.titleArea}>
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') {
                setTitleDraft(scriptTitle)
                setEditingTitle(false)
              }
            }}
            style={s.titleInput}
            spellCheck={false}
          />
        ) : (
          <span
            style={s.titleText}
            onClick={() => setEditingTitle(true)}
            title="Click to rename"
          >
            {scriptTitle || 'Untitled Screenplay'}
          </span>
        )}
      </div>

      {/* ─── Right side: word count + page count + save ─── */}
      <span style={s.pageCount}>
        {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
      </span>

      <div style={s.sep} />

      <span style={s.pageCount}>
        {pageCount} {pageCount === 1 ? 'pg' : 'pgs'}
      </span>

      <span
        className={`screenplay-save-indicator${saveStatus === 'saved' ? ' screenplay-save-indicator-saved' : ''}`}
        style={s.saveIndicator}
      >
        {saveStatus === 'saving' && (
          <>
            <span className="screenplay-save-spinner" />
            Saving...
          </>
        )}
        {saveStatus === 'saved' && (
          <>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={t.success} strokeWidth="2" style={{ marginRight: 4 }}>
              <path d="M2 6l3 3 5-5" />
            </svg>
            Saved
          </>
        )}
        {saveStatus === 'error' && (
          <span style={{ color: t.error }}>Save failed</span>
        )}
      </span>
    </div>
  )
}

// ─── Menu subcomponents ───

type Styles = Record<string, React.CSSProperties>

function MenuButton({
  label,
  isOpen,
  onClick,
  children,
  styles: s,
}: {
  label: string
  isOpen: boolean
  onClick: () => void
  children: React.ReactNode
  styles: Styles
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={onClick}
        style={{
          ...s.menuTrigger,
          ...(isOpen ? s.menuTriggerOpen : {}),
        }}
      >
        {label}
      </button>
      {isOpen && <div style={s.menuDropdown}>{children}</div>}
    </div>
  )
}

function MenuItem({
  label,
  shortcut,
  desc,
  onClick,
  active,
  styles: s,
}: {
  label: string
  shortcut?: string
  desc?: string
  onClick: () => void
  active?: boolean
  styles: Styles
}) {
  return (
    <button style={s.menuItem} onClick={onClick}>
      <span style={s.menuItemCheck}>{active ? '✓' : ''}</span>
      <span style={s.menuItemLabel}>{label}</span>
      {desc && <span style={s.menuItemDesc}>{desc}</span>}
      {shortcut && <span style={s.menuItemShortcut}>{shortcut}</span>}
    </button>
  )
}

function MenuToggle({
  label,
  checked,
  onClick,
  styles: s,
}: {
  label: string
  checked: boolean
  onClick: () => void
  styles: Styles
}) {
  return (
    <button style={s.menuItem} onClick={onClick}>
      <span style={s.menuItemCheck}>{checked ? '✓' : ''}</span>
      <span style={s.menuItemLabel}>{label}</span>
    </button>
  )
}

function MenuDivider({ styles: s }: { styles: Styles }) {
  return <div style={s.menuDivider} />
}

// ─── Find & Replace Bar ───

export interface FindReplaceBarProps {
  onClose: () => void
  editorRef: React.MutableRefObject<any>
  theme: ScreenplayTheme
}

export function FindReplaceBar({ onClose, editorRef, theme }: FindReplaceBarProps) {
  const t = themeTokens[theme]
  const fr = getFrStyles(t)

  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [matches, setMatches] = useState<Array<{ blockKey: string; index: number; length: number }>>([])
  const [currentMatch, setCurrentMatch] = useState(-1)
  const [filterType, setFilterType] = useState<string>('all')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const queryRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    queryRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  // Search
  const doSearch = useCallback(() => {
    if (!query || !editorRef.current) {
      setMatches([])
      setCurrentMatch(-1)
      return
    }

    const editor = editorRef.current
    const found: Array<{ blockKey: string; index: number; length: number }> = []

    editor.getEditorState().read(() => {
      const { $getRoot } = require('lexical')
      const root = $getRoot()
      const children = root.getChildren()

      for (const child of children) {
        // Filter by element type
        if (filterType !== 'all') {
          const nodeType = child.getType?.() || ''
          if (nodeType !== filterType) continue
        }

        const text = child.getTextContent() || ''
        const searchIn = caseSensitive ? text : text.toLowerCase()
        const searchFor = caseSensitive ? query : query.toLowerCase()

        let startIdx = 0
        while (startIdx < searchIn.length) {
          const idx = searchIn.indexOf(searchFor, startIdx)
          if (idx === -1) break
          found.push({ blockKey: child.getKey(), index: idx, length: searchFor.length })
          startIdx = idx + 1
        }
      }
    })

    setMatches(found)
    setCurrentMatch(found.length > 0 ? 0 : -1)
  }, [query, filterType, caseSensitive, editorRef])

  useEffect(() => {
    doSearch()
  }, [doSearch])

  // Navigate matches
  const goNext = () => {
    if (matches.length === 0) return
    setCurrentMatch((prev) => (prev + 1) % matches.length)
  }

  const goPrev = () => {
    if (matches.length === 0) return
    setCurrentMatch((prev) => (prev - 1 + matches.length) % matches.length)
  }

  // Replace current match
  const doReplace = useCallback(() => {
    if (currentMatch < 0 || !editorRef.current) return
    const match = matches[currentMatch]
    const editor = editorRef.current

    editor.update(() => {
      const { $getNodeByKey } = require('lexical')
      const node = $getNodeByKey(match.blockKey)
      if (!node) return

      const text = node.getTextContent()
      const before = text.slice(0, match.index)
      const after = text.slice(match.index + match.length)
      const newText = before + replace + after

      // Clear children and set new text
      const children = node.getChildren()
      children.forEach((c: any) => c.remove())
      const { $createTextNode } = require('lexical')
      node.append($createTextNode(newText))
    })

    // Re-search after replace
    setTimeout(doSearch, 50)
  }, [currentMatch, matches, replace, editorRef, doSearch])

  // Replace all
  const doReplaceAll = useCallback(() => {
    if (matches.length === 0 || !editorRef.current) return
    const editor = editorRef.current

    // Group matches by block key
    const byBlock: Record<string, Array<{ index: number; length: number }>> = {}
    for (const m of matches) {
      if (!byBlock[m.blockKey]) byBlock[m.blockKey] = []
      byBlock[m.blockKey].push({ index: m.index, length: m.length })
    }

    editor.update(() => {
      const { $getNodeByKey, $createTextNode } = require('lexical')

      const keys = Object.keys(byBlock)
      for (const key of keys) {
        const blockMatches = byBlock[key]
        const node = $getNodeByKey(key)
        if (!node) continue

        let text = node.getTextContent()
        // Process in reverse order so indices stay valid
        const sorted = [...blockMatches].sort((a, b) => b.index - a.index)
        for (const m of sorted) {
          text = text.slice(0, m.index) + replace + text.slice(m.index + m.length)
        }

        const children = node.getChildren()
        children.forEach((c: any) => c.remove())
        node.append($createTextNode(text))
      }
    })

    setTimeout(doSearch, 50)
  }, [matches, replace, editorRef, doSearch])

  const FILTER_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'scene-heading', label: 'Scene Headings' },
    { value: 'action', label: 'Action' },
    { value: 'character', label: 'Characters' },
    { value: 'dialogue', label: 'Dialogue' },
    { value: 'parenthetical', label: 'Parenthetical' },
    { value: 'transition', label: 'Transitions' },
  ]

  return (
    <div style={fr.root}>
      <div style={fr.row}>
        {/* Search input */}
        <div style={fr.inputGroup}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={t.searchStroke} strokeWidth="1.3" style={{ flexShrink: 0 }}>
            <circle cx="5.5" cy="5.5" r="4" />
            <path d="M8.5 8.5L11.5 11.5" />
          </svg>
          <input
            ref={queryRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? goPrev() : goNext()
              }
            }}
            placeholder="Find..."
            style={fr.input}
            spellCheck={false}
          />
        </div>

        {/* Replace input */}
        <div style={fr.inputGroup}>
          <input
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            placeholder="Replace..."
            style={fr.input}
            spellCheck={false}
          />
        </div>

        {/* Match count */}
        <span style={fr.matchCount}>
          {matches.length > 0 ? `${currentMatch + 1}/${matches.length}` : query ? 'No matches' : ''}
        </span>

        {/* Nav buttons */}
        <button style={fr.navBtn} onClick={goPrev} disabled={matches.length === 0} title="Previous">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 7l3-3 3 3" />
          </svg>
        </button>
        <button style={fr.navBtn} onClick={goNext} disabled={matches.length === 0} title="Next">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 5l3 3 3-3" />
          </svg>
        </button>

        {/* Replace buttons */}
        <button style={fr.actionBtn} onClick={doReplace} disabled={currentMatch < 0} title="Replace">
          Replace
        </button>
        <button style={fr.actionBtn} onClick={doReplaceAll} disabled={matches.length === 0} title="Replace All">
          All
        </button>

        {/* Close */}
        <button style={fr.closeBtn} onClick={onClose} title="Close (Esc)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>

      {/* ─── Options row ─── */}
      <div style={fr.optionsRow}>
        <button
          style={{
            ...fr.optionBtn,
            ...(caseSensitive ? fr.optionBtnActive : {}),
          }}
          onClick={() => setCaseSensitive((v) => !v)}
          title="Case sensitive"
        >
          Aa
        </button>

        <div style={fr.filterSep} />

        <span style={fr.filterLabel}>Search in:</span>
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            style={{
              ...fr.filterBtn,
              ...(filterType === opt.value ? fr.filterBtnActive : {}),
            }}
            onClick={() => setFilterType(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Style generators ───

type ThemeColors = typeof themeTokens.dark

function getStyles(t: ThemeColors): Record<string, React.CSSProperties> {
  return {
    root: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '4px 10px',
      borderBottom: `1px solid ${t.border}`,
      background: t.chrome,
      flexShrink: 0,
      minHeight: 38,
      userSelect: 'none',
    },
    backBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'none',
      border: 'none',
      color: t.textMuted,
      cursor: 'pointer',
      padding: '4px 6px',
      borderRadius: 4,
    },
    sep: {
      width: 1,
      height: 18,
      background: t.border,
      flexShrink: 0,
      margin: '0 2px',
    },
    menuBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 1,
    },
    menuTrigger: {
      background: 'none',
      border: 'none',
      borderRadius: 4,
      color: t.textSecondary,
      fontSize: 12,
      fontWeight: 500,
      cursor: 'pointer',
      padding: '4px 8px',
      fontFamily: 'inherit',
      transition: 'background 0.1s, color 0.1s',
    },
    menuTriggerOpen: {
      background: t.overlayLight,
      color: t.textBright,
    },
    menuDropdown: {
      position: 'absolute' as const,
      top: '100%',
      left: 0,
      marginTop: 2,
      background: t.dropdown,
      border: `1px solid ${t.dropdownBorder}`,
      borderRadius: 8,
      boxShadow: t.dropdownShadow,
      padding: '4px 0',
      zIndex: 200,
      minWidth: 200,
    },
    menuItem: {
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      width: '100%',
      padding: '6px 12px 6px 6px',
      background: 'transparent',
      border: 'none',
      color: t.text,
      fontSize: 12,
      fontWeight: 400,
      cursor: 'pointer',
      fontFamily: 'inherit',
      textAlign: 'left' as const,
      borderRadius: 0,
    },
    menuItemCheck: {
      width: 20,
      textAlign: 'center' as const,
      fontSize: 11,
      color: t.accent,
      flexShrink: 0,
    },
    menuItemLabel: {
      flex: 1,
    },
    menuItemDesc: {
      fontSize: 10,
      color: t.textSubtle,
      marginLeft: 8,
    },
    menuItemShortcut: {
      fontSize: 10,
      color: t.textDim,
      marginLeft: 16,
      fontFamily: 'inherit',
      flexShrink: 0,
    },
    menuDivider: {
      height: 1,
      background: t.border,
      margin: '4px 0',
    },
    zoomRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 12px 6px 26px',
    },
    zoomLabel: {
      fontSize: 12,
      color: t.text,
    },
    zoomControls: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
    },
    zoomBtn: {
      width: 22,
      height: 22,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: t.overlayStrong,
      border: `1px solid ${t.overlayMedium}`,
      borderRadius: 4,
      color: t.textSecondary,
      fontSize: 14,
      cursor: 'pointer',
      fontFamily: 'inherit',
      padding: 0,
    },
    zoomValue: {
      fontSize: 11,
      color: t.textSecondary,
      width: 40,
      textAlign: 'center' as const,
      fontVariantNumeric: 'tabular-nums',
    },
    typeIndicator: {
      padding: '3px 10px',
      background: t.accentBg,
      border: `1px solid ${t.accentBorder}`,
      borderRadius: 5,
      color: t.accentLight,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.3px',
      minWidth: 80,
      textAlign: 'center' as const,
      flexShrink: 0,
    },
    modePill: {
      padding: '3px 10px',
      background: t.accentBg,
      border: `1px solid ${t.accentBorder}`,
      borderRadius: 5,
      color: t.accentLight,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.3px',
      flexShrink: 0,
    },
    titleArea: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 12px',
    },
    titleText: {
      fontSize: 13,
      fontWeight: 600,
      color: t.text,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
      cursor: 'pointer',
      padding: '2px 8px',
      borderRadius: 4,
      border: '1px solid transparent',
      transition: 'border-color 0.15s',
      maxWidth: '100%',
    },
    titleInput: {
      fontSize: 13,
      fontWeight: 600,
      color: t.text,
      background: t.inputBg,
      border: `1px solid ${t.inputBorder}`,
      borderRadius: 4,
      padding: '2px 8px',
      fontFamily: 'inherit',
      outline: 'none',
      width: '100%',
      maxWidth: 300,
      textAlign: 'center' as const,
    },
    pageCount: {
      fontSize: 11,
      color: t.textMuted,
      padding: '0 6px',
      flexShrink: 0,
      fontVariantNumeric: 'tabular-nums',
    },
    saveIndicator: {
      display: 'flex',
      alignItems: 'center',
      fontSize: 11,
      color: t.textMuted,
      padding: '0 6px',
      borderLeft: `1px solid ${t.border}`,
      paddingLeft: 10,
      flexShrink: 0,
      minWidth: 60,
    },
    gearBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'none',
      border: 'none',
      color: t.textMuted,
      cursor: 'pointer',
      padding: '4px 6px',
      borderRadius: 4,
    },
    gearDropdown: {
      position: 'absolute' as const,
      top: '100%',
      right: 0,
      marginTop: 2,
      background: t.dropdown,
      border: `1px solid ${t.dropdownBorder}`,
      borderRadius: 8,
      boxShadow: t.dropdownShadow,
      padding: '4px 0',
      zIndex: 200,
      minWidth: 180,
    },
  }
}

function getFrStyles(t: ThemeColors): Record<string, React.CSSProperties> {
  return {
    root: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      padding: '6px 12px',
      borderBottom: `1px solid ${t.border}`,
      background: t.overlaySubtle,
      flexShrink: 0,
    },
    row: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    },
    inputGroup: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      background: t.overlay,
      border: `1px solid ${t.overlayMedium}`,
      borderRadius: 5,
      padding: '3px 8px',
      flex: 1,
      maxWidth: 220,
    },
    input: {
      flex: 1,
      background: 'transparent',
      border: 'none',
      color: t.text,
      fontSize: 12,
      fontFamily: 'inherit',
      outline: 'none',
      minWidth: 0,
    },
    matchCount: {
      fontSize: 10,
      color: t.textMuted,
      flexShrink: 0,
      minWidth: 48,
      textAlign: 'center' as const,
      fontVariantNumeric: 'tabular-nums',
    },
    navBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 22,
      height: 22,
      background: t.overlay,
      border: `1px solid ${t.border}`,
      borderRadius: 4,
      color: t.textMuted,
      cursor: 'pointer',
      padding: 0,
    },
    actionBtn: {
      padding: '3px 8px',
      background: t.overlay,
      border: `1px solid ${t.overlayMedium}`,
      borderRadius: 4,
      color: t.textSecondary,
      fontSize: 10,
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'inherit',
      flexShrink: 0,
    },
    closeBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 22,
      height: 22,
      background: 'none',
      border: 'none',
      color: t.textMuted,
      cursor: 'pointer',
      padding: 0,
      marginLeft: 2,
    },
    optionsRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      paddingLeft: 2,
    },
    optionBtn: {
      padding: '1px 6px',
      background: t.overlaySubtle,
      border: `1px solid ${t.border}`,
      borderRadius: 3,
      color: t.textMuted,
      fontSize: 10,
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'inherit',
    },
    optionBtnActive: {
      background: t.accentBgStrong,
      borderColor: t.accentBorderStrong,
      color: t.accentLight,
    },
    filterSep: {
      width: 1,
      height: 12,
      background: t.border,
      margin: '0 4px',
    },
    filterLabel: {
      fontSize: 10,
      color: t.textSubtle,
      marginRight: 2,
      flexShrink: 0,
    },
    filterBtn: {
      padding: '1px 6px',
      background: t.overlaySubtle,
      border: `1px solid ${t.border}`,
      borderRadius: 3,
      color: t.textMuted,
      fontSize: 9,
      fontWeight: 500,
      cursor: 'pointer',
      fontFamily: 'inherit',
      whiteSpace: 'nowrap' as const,
    },
    filterBtnActive: {
      background: t.accentBgStrong,
      borderColor: t.accentBorderStrong,
      color: t.accentLight,
    },
  }
}
