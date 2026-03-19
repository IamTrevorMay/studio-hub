import { useState, useCallback, useRef, useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  type ElementNode,
} from 'lexical'
import { $isNoteMarkNode } from '../../nodes/NoteMarkNode'
import { $unwrapNoteMarkById } from '../editor/NotesPlugin'
import type { ScriptNote, NoteColor } from '../../types'

// ─── Color config ───

const NOTE_COLORS: { color: NoteColor; label: string; bg: string; fgDark: string }[] = [
  { color: 'yellow', label: 'Yellow', bg: '#fbbf24', fgDark: '#fbbf24' },
  { color: 'green', label: 'Green', bg: '#34d399', fgDark: '#34d399' },
  { color: 'pink', label: 'Pink', bg: '#f472b6', fgDark: '#f472b6' },
  { color: 'blue', label: 'Blue', bg: '#60a5fa', fgDark: '#60a5fa' },
]

function colorBg(c: NoteColor): string {
  return NOTE_COLORS.find((nc) => nc.color === c)?.bg || '#fbbf24'
}

// ─── Format relative time ───

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ─── Main Component ───

export default function NotesPanel({
  notes,
  onNotesChange,
  onClose,
}: {
  notes: ScriptNote[]
  onNotesChange: (notes: ScriptNote[]) => void
  onClose: () => void
}) {
  const [editor] = useLexicalComposerContext()
  const [filterColor, setFilterColor] = useState<NoteColor | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [editingId])

  // Filter notes
  const activeNotes = notes.filter((n) => !n.resolved)
  const filtered = filterColor
    ? activeNotes.filter((n) => n.color === filterColor)
    : activeNotes

  // Sort by creation time (newest first)
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  // Count by color
  const colorCounts: Record<string, number> = {}
  activeNotes.forEach((n) => {
    colorCounts[n.color] = (colorCounts[n.color] || 0) + 1
  })

  // ─── Update note text ───
  const updateNoteText = useCallback(
    (noteId: string, text: string) => {
      onNotesChange(
        notes.map((n) => (n.id === noteId ? { ...n, text } : n))
      )
    },
    [notes, onNotesChange]
  )

  // ─── Resolve note ───
  const resolveNote = useCallback(
    (noteId: string) => {
      editor.update(() => {
        $unwrapNoteMarkById(noteId)
      })
      onNotesChange(notes.filter((n) => n.id !== noteId))
    },
    [editor, notes, onNotesChange]
  )

  // ─── Scroll to note in editor ───
  const scrollToNote = useCallback(
    (noteId: string) => {
      editor.getEditorState().read(() => {
        const root = $getRoot()

        function find(node: any): boolean {
          if ($isNoteMarkNode(node) && node.getNoteId() === noteId) {
            const dom = editor.getElementByKey(node.getKey())
            if (dom) {
              dom.scrollIntoView({ behavior: 'smooth', block: 'center' })
              dom.style.transition = 'outline 0.2s'
              dom.style.outline = '2px solid rgba(99, 102, 241, 0.6)'
              dom.style.outlineOffset = '2px'
              dom.style.borderRadius = '2px'
              setTimeout(() => {
                dom.style.outline = ''
                dom.style.outlineOffset = ''
              }, 1200)
            }
            return true
          }
          if ((node as ElementNode).getChildren) {
            for (const child of (node as ElementNode).getChildren()) {
              if (find(child)) return true
            }
          }
          return false
        }

        for (const child of root.getChildren()) {
          if (find(child)) break
        }
      })
    },
    [editor]
  )

  return (
    <div className="notes-panel">
      {/* Header */}
      <div className="notes-panel-header">
        <span className="notes-panel-title">Notes</span>
        <button
          className="notes-panel-close"
          onClick={onClose}
          title="Close notes panel"
        >
          &times;
        </button>
      </div>

      {/* Color filter bar */}
      <div className="notes-panel-filters">
        <button
          className={`notes-panel-filter-btn${
            filterColor === null ? ' notes-panel-filter-btn-active' : ''
          }`}
          onClick={() => setFilterColor(null)}
        >
          All ({activeNotes.length})
        </button>
        {NOTE_COLORS.map((nc) => (
          <button
            key={nc.color}
            className={`notes-panel-filter-dot${
              filterColor === nc.color ? ' notes-panel-filter-dot-active' : ''
            }`}
            style={{
              background: filterColor === nc.color ? nc.bg : 'transparent',
              borderColor: nc.bg,
              color: filterColor === nc.color ? '#000' : nc.fgDark,
            }}
            onClick={() =>
              setFilterColor(filterColor === nc.color ? null : nc.color)
            }
            title={nc.label}
          >
            {colorCounts[nc.color] || 0}
          </button>
        ))}
      </div>

      {/* Notes list */}
      <div className="notes-panel-list">
        {sorted.length === 0 && (
          <div className="notes-panel-empty">
            {activeNotes.length === 0
              ? 'No notes yet. Select text to add a note.'
              : 'No notes match this filter.'}
          </div>
        )}

        {sorted.map((note) => (
          <div key={note.id} className="notes-panel-card">
            {/* Color accent + highlighted text preview */}
            <div
              className="notes-panel-card-header"
              onClick={() => scrollToNote(note.id)}
            >
              <span
                className="notes-panel-color-dot"
                style={{ background: colorBg(note.color) }}
              />
              <span className="notes-panel-highlight-text">
                &ldquo;{note.highlightedText}&rdquo;
              </span>
              <span className="notes-panel-time">
                {relativeTime(note.createdAt)}
              </span>
            </div>

            {/* Note text (editable) */}
            <div className="notes-panel-card-body">
              {editingId === note.id ? (
                <textarea
                  ref={textareaRef}
                  className="notes-panel-textarea"
                  value={note.text}
                  onChange={(e) => updateNoteText(note.id, e.target.value)}
                  onBlur={() => setEditingId(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  rows={2}
                  placeholder="Add a note..."
                  spellCheck={false}
                />
              ) : (
                <div
                  className="notes-panel-note-text"
                  onClick={() => setEditingId(note.id)}
                >
                  {note.text || (
                    <span className="notes-panel-placeholder">
                      Click to add note...
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="notes-panel-card-actions">
              <button
                className="notes-panel-resolve-btn"
                onClick={() => resolveNote(note.id)}
                title="Resolve — removes the highlight"
              >
                Resolve
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="notes-panel-footer">
        <span>
          {activeNotes.length} {activeNotes.length === 1 ? 'note' : 'notes'}
        </span>
      </div>
    </div>
  )
}
