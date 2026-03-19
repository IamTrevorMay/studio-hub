import { useEffect, useState, useCallback, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $createTextNode,
  type LexicalEditor,
  type ElementNode,
} from 'lexical'
import { $isSceneHeadingNode } from '../../nodes/SceneHeadingNode'
import { $isCharacterNode } from '../../nodes/CharacterNode'
import { $isDialogueNode } from '../../nodes/DialogueNode'
import { $isParentheticalNode } from '../../nodes/ParentheticalNode'
import { $isActionNode } from '../../nodes/ActionNode'

// ─── Character data extracted from the script ───

interface CharacterInfo {
  /** Normalized uppercase name (no extensions) */
  name: string
  /** Total appearances as a character cue */
  appearances: number
  /** Number of dialogue + parenthetical lines */
  dialogueLines: number
  /** Scene numbers (1-indexed) this character appears in */
  sceneNumbers: number[]
  /** Lexical node keys of all character cue nodes for this name */
  characterKeys: string[]
  /**
   * Keys of nodes "owned" by this character — their cues plus
   * immediately following dialogue/parenthetical blocks.
   */
  ownedKeys: string[]
}

// ─── Strip extensions like (V.O.), (O.S.), (CONT'D) from character name ───

function stripExtensions(text: string): string {
  return text
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim()
    .toUpperCase()
}

// ─── Extract all character data from the editor ───

function extractCharacters(editor: LexicalEditor): CharacterInfo[] {
  const charMap = new Map<string, CharacterInfo>()

  editor.getEditorState().read(() => {
    const root = $getRoot()
    const children = root.getChildren()

    let currentScene = 0
    let lastCharName: string | null = null

    for (let i = 0; i < children.length; i++) {
      const child = children[i]

      if ($isSceneHeadingNode(child)) {
        currentScene++
        lastCharName = null
        continue
      }

      if ($isCharacterNode(child)) {
        const rawText = child.getTextContent().trim()
        const name = stripExtensions(rawText)
        if (!name) continue

        lastCharName = name

        let info = charMap.get(name)
        if (!info) {
          info = {
            name,
            appearances: 0,
            dialogueLines: 0,
            sceneNumbers: [],
            characterKeys: [],
            ownedKeys: [],
          }
          charMap.set(name, info)
        }

        info.appearances++
        info.characterKeys.push(child.getKey())
        info.ownedKeys.push(child.getKey())

        if (currentScene > 0 && !info.sceneNumbers.includes(currentScene)) {
          info.sceneNumbers.push(currentScene)
        }
        continue
      }

      // Dialogue or parenthetical immediately after a character cue
      if (
        lastCharName &&
        ($isDialogueNode(child) || $isParentheticalNode(child))
      ) {
        const info = charMap.get(lastCharName)
        if (info) {
          info.dialogueLines++
          info.ownedKeys.push(child.getKey())
        }
        continue
      }

      // Any other node breaks the character→dialogue chain
      lastCharName = null
    }
  })

  // Sort by appearances descending
  return Array.from(charMap.values()).sort(
    (a, b) => b.appearances - a.appearances
  )
}

// ─── Find action nodes that mention a character name ───

function findActionMentions(
  editor: LexicalEditor,
  name: string
): string[] {
  const keys: string[] = []
  const upperName = name.toUpperCase()

  editor.getEditorState().read(() => {
    const root = $getRoot()
    for (const child of root.getChildren()) {
      if ($isActionNode(child)) {
        const text = child.getTextContent().toUpperCase()
        if (text.includes(upperName)) {
          keys.push(child.getKey())
        }
      }
    }
  })

  return keys
}

// ─── Rename a character globally in the Lexical document ───

function renameCharacter(
  editor: LexicalEditor,
  oldName: string,
  newName: string
) {
  const upperOld = oldName.toUpperCase()
  const upperNew = newName.toUpperCase()
  if (upperOld === upperNew) return

  editor.update(() => {
    const root = $getRoot()
    for (const child of root.getChildren()) {
      // Rename character cue nodes
      if ($isCharacterNode(child)) {
        const text = child.getTextContent()
        const stripped = stripExtensions(text)
        if (stripped === upperOld) {
          // Preserve any extension like (V.O.)
          const extension = text.match(/\s*(\(.*?\))\s*$/)
          const newText = extension
            ? `${upperNew} ${extension[1]}`
            : upperNew

          const elem = child as ElementNode
          const kids = elem.getChildren()
          kids.forEach((k) => k.remove())
          elem.append($createTextNode(newText))
        }
      }

      // Replace mentions in action text
      if ($isActionNode(child)) {
        const text = child.getTextContent()
        // Case-insensitive word-boundary-ish replace
        const regex = new RegExp(
          escapeRegex(oldName),
          'gi'
        )
        if (regex.test(text)) {
          const newText = text.replace(regex, (match) => {
            // Preserve the original casing pattern:
            // if match was all-caps, use all-caps replacement
            if (match === match.toUpperCase()) return upperNew
            // if match was Title Case, use Title Case
            if (match[0] === match[0].toUpperCase()) {
              return (
                newName.charAt(0).toUpperCase() +
                newName.slice(1).toLowerCase()
              )
            }
            return newName.toLowerCase()
          })

          const elem = child as ElementNode
          const kids = elem.getChildren()
          kids.forEach((k) => k.remove())
          elem.append($createTextNode(newText))
        }
      }
    }
  })
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Apply/remove highlight classes on editor DOM ───

function applyHighlight(
  editor: LexicalEditor,
  ownedKeys: string[],
  actionKeys: string[]
) {
  const allKeys = ownedKeys.concat(actionKeys)
  const rootEl = editor.getRootElement()
  if (!rootEl) return

  // Clear all existing highlights first
  clearHighlight(editor)

  // Deduplicate via object
  const seen: Record<string, boolean> = {}
  allKeys.forEach((key) => {
    if (seen[key]) return
    seen[key] = true
    const dom = editor.getElementByKey(key)
    if (dom) {
      dom.classList.add('screenplay-char-highlight')
    }
  })

  // Dim non-highlighted elements
  rootEl.classList.add('screenplay-char-highlight-active')
}

function clearHighlight(editor: LexicalEditor) {
  const rootEl = editor.getRootElement()
  if (!rootEl) return

  rootEl.classList.remove('screenplay-char-highlight-active')
  const highlighted = rootEl.querySelectorAll('.screenplay-char-highlight')
  highlighted.forEach((el) => el.classList.remove('screenplay-char-highlight'))
}

// ─── Notes storage (localStorage-backed, keyed by docId + name) ───

function getNotesKey(docId: string, name: string): string {
  return `screenplay-char-notes:${docId}:${name}`
}

function loadNote(docId: string, name: string): string {
  try {
    return localStorage.getItem(getNotesKey(docId, name)) || ''
  } catch {
    return ''
  }
}

function saveNote(docId: string, name: string, note: string) {
  try {
    if (note) {
      localStorage.setItem(getNotesKey(docId, name), note)
    } else {
      localStorage.removeItem(getNotesKey(docId, name))
    }
  } catch {
    // localStorage unavailable
  }
}

// ─── Main Component ───

export default function CharacterManager({
  docId,
  onClose,
}: {
  docId: string
  onClose: () => void
}) {
  const [editor] = useLexicalComposerContext()
  const [characters, setCharacters] = useState<CharacterInfo[]>([])
  const [expandedName, setExpandedName] = useState<string | null>(null)
  const [highlightedName, setHighlightedName] = useState<string | null>(null)
  const [renamingName, setRenamingName] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Extract characters on editor changes ───
  const refresh = useCallback(() => {
    const chars = extractCharacters(editor)
    setCharacters(chars)

    // Load notes for all characters
    const loaded: Record<string, string> = {}
    for (const c of chars) {
      const note = loadNote(docId, c.name)
      if (note) loaded[c.name] = note
    }
    setNotes(loaded)
  }, [editor, docId])

  useEffect(() => {
    refresh()

    return editor.registerUpdateListener(() => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(refresh, 300)
    })
  }, [editor, refresh])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    }
  }, [])

  // Clear highlight on unmount
  useEffect(() => {
    return () => clearHighlight(editor)
  }, [editor])

  // ─── Toggle character detail row ───
  const toggleExpanded = useCallback((name: string) => {
    setExpandedName((prev) => (prev === name ? null : name))
    setRenamingName(null)
  }, [])

  // ─── Highlight toggle ───
  const toggleHighlight = useCallback(
    (char: CharacterInfo) => {
      if (highlightedName === char.name) {
        clearHighlight(editor)
        setHighlightedName(null)
      } else {
        const actionKeys = findActionMentions(editor, char.name)
        applyHighlight(editor, char.ownedKeys, actionKeys)
        setHighlightedName(char.name)
      }
    },
    [editor, highlightedName]
  )

  // ─── Rename ───
  const startRename = useCallback((name: string) => {
    setRenamingName(name)
    setRenameValue(name)
  }, [])

  const confirmRename = useCallback(() => {
    if (!renamingName || !renameValue.trim()) return
    const newName = renameValue.trim()
    if (newName.toUpperCase() !== renamingName.toUpperCase()) {
      renameCharacter(editor, renamingName, newName)

      // Transfer notes
      const oldNote = notes[renamingName]
      if (oldNote) {
        saveNote(docId, renamingName, '')
        saveNote(docId, newName.toUpperCase(), oldNote)
      }
    }
    setRenamingName(null)
    setRenameValue('')
  }, [editor, renamingName, renameValue, notes, docId])

  const cancelRename = useCallback(() => {
    setRenamingName(null)
    setRenameValue('')
  }, [])

  // ─── Notes ───
  const updateNote = useCallback(
    (name: string, value: string) => {
      setNotes((prev) => ({ ...prev, [name]: value }))

      // Debounced save to localStorage
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
      noteTimerRef.current = setTimeout(() => {
        saveNote(docId, name, value)
      }, 500)
    },
    [docId]
  )

  return (
    <div className="char-manager">
      {/* Header */}
      <div className="char-manager-header">
        <span className="char-manager-title">Characters</span>
        <button
          className="char-manager-close"
          onClick={onClose}
          title="Close character manager"
        >
          &times;
        </button>
      </div>

      {/* Character list */}
      <div className="char-manager-list">
        {characters.length === 0 && (
          <div className="char-manager-empty">
            No characters yet. Add a character cue to your script.
          </div>
        )}

        {characters.map((char) => {
          const isExpanded = expandedName === char.name
          const isHighlighted = highlightedName === char.name
          const isRenaming = renamingName === char.name

          return (
            <div key={char.name} className="char-manager-card">
              {/* Main row */}
              <div
                className={`char-manager-row${
                  isHighlighted ? ' char-manager-row-highlighted' : ''
                }`}
                onClick={() => toggleExpanded(char.name)}
              >
                {/* Name */}
                <span className="char-manager-name">{char.name}</span>

                {/* Stats */}
                <span className="char-manager-stat" title="Dialogue lines">
                  {char.dialogueLines}L
                </span>
                <span className="char-manager-stat" title="Scenes appeared in">
                  {char.sceneNumbers.length}S
                </span>

                {/* Highlight toggle */}
                <button
                  className={`char-manager-highlight-btn${
                    isHighlighted ? ' char-manager-highlight-btn-active' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleHighlight(char)
                  }}
                  title={
                    isHighlighted
                      ? 'Remove highlight'
                      : 'Highlight in editor'
                  }
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="7" cy="7" r="5" />
                    {isHighlighted && <circle cx="7" cy="7" r="2.5" fill="currentColor" />}
                  </svg>
                </button>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="char-manager-detail">
                  {/* Stats detail */}
                  <div className="char-manager-detail-stats">
                    <div className="char-manager-detail-stat">
                      <span className="char-manager-detail-label">
                        Appearances
                      </span>
                      <span className="char-manager-detail-value">
                        {char.appearances}
                      </span>
                    </div>
                    <div className="char-manager-detail-stat">
                      <span className="char-manager-detail-label">
                        Dialogue lines
                      </span>
                      <span className="char-manager-detail-value">
                        {char.dialogueLines}
                      </span>
                    </div>
                    <div className="char-manager-detail-stat">
                      <span className="char-manager-detail-label">Scenes</span>
                      <span className="char-manager-detail-value">
                        {char.sceneNumbers.length > 0
                          ? char.sceneNumbers.join(', ')
                          : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Rename */}
                  <div className="char-manager-section">
                    {isRenaming ? (
                      <div className="char-manager-rename-row">
                        <input
                          className="char-manager-rename-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') confirmRename()
                            if (e.key === 'Escape') cancelRename()
                          }}
                          autoFocus
                          spellCheck={false}
                        />
                        <button
                          className="char-manager-rename-confirm"
                          onClick={confirmRename}
                          title="Confirm rename"
                        >
                          &#10003;
                        </button>
                        <button
                          className="char-manager-rename-cancel"
                          onClick={cancelRename}
                          title="Cancel"
                        >
                          &times;
                        </button>
                      </div>
                    ) : (
                      <button
                        className="char-manager-action-btn"
                        onClick={() => startRename(char.name)}
                      >
                        Rename globally
                      </button>
                    )}
                  </div>

                  {/* Notes */}
                  <div className="char-manager-section">
                    <textarea
                      className="char-manager-notes"
                      placeholder="Character notes..."
                      value={notes[char.name] || ''}
                      onChange={(e) => updateNote(char.name, e.target.value)}
                      rows={2}
                      spellCheck={false}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="char-manager-footer">
        <span>
          {characters.length}{' '}
          {characters.length === 1 ? 'character' : 'characters'}
        </span>
      </div>
    </div>
  )
}
