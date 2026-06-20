import { useEffect, useState, useCallback, useRef } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  KEY_BACKSPACE_COMMAND,
  type LexicalNode,
  type ElementNode,
} from 'lexical'

import { ScreenplayNodes } from '../../nodes'
import {
  $createSceneHeadingNode,
  $isSceneHeadingNode,
} from '../../nodes/SceneHeadingNode'
import { $createActionNode, $isActionNode } from '../../nodes/ActionNode'
import {
  $createCharacterNode,
  $isCharacterNode,
} from '../../nodes/CharacterNode'
import {
  $createDialogueNode,
  $isDialogueNode,
} from '../../nodes/DialogueNode'
import {
  $createParentheticalNode,
  $isParentheticalNode,
} from '../../nodes/ParentheticalNode'
import {
  $createTransitionNode,
  $isTransitionNode,
} from '../../nodes/TransitionNode'
import { screenplayTheme } from '../../editor/theme'
import type {
  LegacyScreenplayContent,
  LegacyElement,
  LegacyTitlePage,
  ScriptElementType,
} from '../../types'

import { UNDO_COMMAND, REDO_COMMAND } from 'lexical'
import { exportToFDX } from '../../lib/screenplay/exportFDX'
import { exportToTXT } from '../../lib/screenplay/exportTXT'
import {
  loadPreferences,
  savePreferences,
  syncPreferences,
  type WritingMode,
  type ScreenplayTheme,
} from '../../lib/screenplay/preferences'
import AutocompletePlugin from './AutocompletePlugin'
import PageBreakPlugin from './PageBreakPlugin'
import NotesPlugin from './NotesPlugin'
import SceneNavigator from '../panels/SceneNavigator'
import CharacterManager from '../panels/CharacterManager'
import NotesPanel from '../panels/NotesPanel'
import PrintPreviewModal from '../panels/PrintPreviewModal'
import Toolbar, { FindReplaceBar } from '../toolbar/Toolbar'
import { supabase } from '../../../../../supabaseClient'
import type { ScriptNote } from '../../types'
import '../../screenplay-editor.css'

// ─── Type mapping from legacy to new nodes ───
const LEGACY_TYPE_MAP: Record<string, string> = {
  sceneHeading: 'scene-heading',
  action: 'action',
  character: 'character',
  dialogue: 'dialogue',
  parenthetical: 'parenthetical',
  transition: 'transition',
}

// ─── Tab cycle order (full industry-standard order) ───
// Tab moves forward, Shift+Tab moves backward:
//   Scene Heading → Action → Character → Dialogue → Parenthetical → Transition
const TAB_CYCLE: string[] = [
  'scene-heading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
]

// ─── Table name resolver ───
const TABLE_MAP: Record<string, string> = {
  resource_documents: 'resource_documents',
  show_documents: 'show_documents',
  screenwriter_scripts: 'screenwriter_scripts',
}

// ─── Node factory by type ───
function createNodeByType(type: string): ElementNode {
  switch (type) {
    case 'scene-heading':
      return $createSceneHeadingNode()
    case 'character':
      return $createCharacterNode()
    case 'dialogue':
      return $createDialogueNode()
    case 'parenthetical':
      return $createParentheticalNode()
    case 'transition':
      return $createTransitionNode()
    case 'action':
    default:
      return $createActionNode()
  }
}

// ─── Get the screenplay element type of a node ───
function getNodeElementType(node: LexicalNode): ScriptElementType | null {
  if ($isSceneHeadingNode(node)) return 'scene-heading'
  if ($isActionNode(node)) return 'action'
  if ($isCharacterNode(node)) return 'character'
  if ($isDialogueNode(node)) return 'dialogue'
  if ($isParentheticalNode(node)) return 'parenthetical'
  if ($isTransitionNode(node)) return 'transition'
  return null
}

// ─── Check if a node is one of our screenplay nodes ───
function isScreenplayNode(node: LexicalNode): boolean {
  return getNodeElementType(node) !== null
}

// ─── Determine the "next on enter" type ───
function getNextTypeOnEnter(type: ScriptElementType | null): string {
  switch (type) {
    case 'scene-heading':
      return 'action'
    case 'action':
      return 'action'
    case 'character':
      return 'dialogue'
    case 'dialogue':
      return 'character'
    case 'parenthetical':
      return 'dialogue'
    case 'transition':
      return 'scene-heading'
    default:
      return 'action'
  }
}

// ─── What to convert to when pressing Enter on an empty block ───
// This "demotes" the block to a sensible fallback:
//   Scene Heading → Action  (start describing the scene)
//   Action        → Action  (no change — stay in action)
//   Character     → Action  (bail out of dialogue block)
//   Dialogue      → Action  (bail out of dialogue block)
//   Parenthetical → Dialogue (drop the aside, continue dialogue)
//   Transition    → Action  (bail out)
function getEmptyEnterType(type: ScriptElementType | null): string | null {
  switch (type) {
    case 'scene-heading':
      return 'action'
    case 'character':
      return 'action'
    case 'dialogue':
      return 'action'
    case 'parenthetical':
      return 'dialogue'
    case 'transition':
      return 'action'
    case 'action':
      return 'action' // stays action — no visual change
    default:
      return null
  }
}

// ─── Plugin: Smart Enter, Tab, Backspace ───
//
// Enter behavior (inserts new block after current):
//   Scene Heading → Action
//   Action        → Action
//   Character     → Dialogue
//   Dialogue      → Character
//   Parenthetical → Dialogue
//   Transition    → Scene Heading
//
// Enter on empty block (converts current block in-place):
//   Action / Character / Parenthetical → Action
//   Dialogue → Character
//   Scene Heading (empty) → Action
//   Transition (empty) → Scene Heading (no-op, stays)
//
// Tab (converts current block in-place, cycling forward):
//   Scene Heading → Action → Character → Dialogue → Parenthetical → Transition → (wraps)
//   Key context-aware results:
//     Action    → Tab → Character
//     Dialogue  → Tab → Parenthetical
//
// Shift+Tab: cycles backward through the same order
//
function ScreenplayKeyPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // ─── Enter ───
    const removeEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event) event.preventDefault()

        editor.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return

          const anchorNode = selection.anchor.getNode()
          const block = anchorNode.getTopLevelElement()
          if (!block || !isScreenplayNode(block)) return

          const type = getNodeElementType(block)
          const text = block.getTextContent().trim()

          if (text === '') {
            // Empty block → convert type in-place
            const newType = getEmptyEnterType(type)
            if (newType && newType !== type) {
              const newNode = createNodeByType(newType)
              const children = (block as ElementNode).getChildren()
              children.forEach((child) => newNode.append(child))
              block.replace(newNode)
              newNode.selectStart()
            }
          } else {
            // Non-empty → insert appropriate next element after
            const nextType = getNextTypeOnEnter(type)
            const newNode = createNodeByType(nextType)
            block.insertAfter(newNode)
            newNode.selectStart()
          }
        })

        return true
      },
      COMMAND_PRIORITY_HIGH
    )

    // ─── Tab / Shift+Tab ───
    const removeTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        if (event) event.preventDefault()

        editor.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return

          const anchorNode = selection.anchor.getNode()
          const block = anchorNode.getTopLevelElement()
          if (!block || !isScreenplayNode(block)) return

          const currentType = getNodeElementType(block) || 'action'
          const currentIdx = TAB_CYCLE.indexOf(currentType)
          const backward = event?.shiftKey

          let newIdx: number
          if (backward) {
            // Shift+Tab: go backward, wrap around
            newIdx =
              currentIdx <= 0
                ? TAB_CYCLE.length - 1
                : currentIdx - 1
          } else {
            // Tab: go forward, wrap around
            newIdx =
              currentIdx < 0
                ? 0
                : (currentIdx + 1) % TAB_CYCLE.length
          }

          const newType = TAB_CYCLE[newIdx]
          if (newType === currentType) return

          const newNode = createNodeByType(newType)
          const children = (block as ElementNode).getChildren()
          children.forEach((child) => newNode.append(child))
          block.replace(newNode)
          newNode.selectEnd()
        })

        return true
      },
      COMMAND_PRIORITY_HIGH
    )

    // ─── Backspace on empty block ───
    const removeBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false
        if (!selection.isCollapsed()) return false

        const anchorNode = selection.anchor.getNode()
        const block = anchorNode.getTopLevelElement()
        if (!block || !isScreenplayNode(block)) return false

        // Only intercept when cursor is at position 0
        if (selection.anchor.offset !== 0) return false

        const text = block.getTextContent()

        // If block has text, first convert to Action (like professional
        // screenwriting apps — Backspace at start "demotes" the element)
        if (text !== '') {
          const currentType = getNodeElementType(block)
          if (currentType && currentType !== 'action') {
            if (event) event.preventDefault()
            const newNode = $createActionNode()
            const children = (block as ElementNode).getChildren()
            children.forEach((child) => newNode.append(child))
            block.replace(newNode)
            newNode.selectStart()
            return true
          }
          return false
        }

        // Empty block — remove it and focus previous
        const prevSibling = block.getPreviousSibling()
        if (!prevSibling) {
          // First block in doc and it's empty — convert to Action if not already
          const currentType = getNodeElementType(block)
          if (currentType !== 'action') {
            if (event) event.preventDefault()
            const newNode = $createActionNode()
            block.replace(newNode)
            newNode.selectStart()
            return true
          }
          return false
        }

        if (event) event.preventDefault()
        block.remove()
        ;(prevSibling as ElementNode).selectEnd()
        return true
      },
      COMMAND_PRIORITY_HIGH
    )

    return () => {
      removeEnter()
      removeTab()
      removeBackspace()
    }
  }, [editor])

  return null
}

// ─── Plugin: Load content from Supabase (dual mode) ───
function LoadContentPlugin({
  docId,
  tableName,
  onLoaded,
  onTitlePageLoaded,
  onNotesLoaded,
  onTitleLoaded,
}: {
  docId: string
  tableName: string
  onLoaded: () => void
  onTitlePageLoaded: (tp: LegacyTitlePage) => void
  onNotesLoaded: (notes: ScriptNote[]) => void
  onTitleLoaded?: (title: string) => void
}) {
  const [editor] = useLexicalComposerContext()
  const isNative = tableName === 'screenwriter_scripts'

  useEffect(() => {
    let aborted = false
    ;(async () => {
      const { data } = await supabase
        .from(tableName)
        .select('*')
        .eq('id', docId)
        .single()

      // Bail if the doc changed or the component unmounted while the query was
      // in flight — don't write loaded content into a torn-down/stale editor.
      if (aborted) return

      if (data && (data as any).content) {
        const content = (data as any).content as any

        // Load title for native mode
        if (isNative && (data as any).title && onTitleLoaded) {
          onTitleLoaded((data as any).title)
        }

        if (content.titlePage) {
          onTitlePageLoaded(content.titlePage)
        }

        // Load notes
        if (content.notes && Array.isArray(content.notes) && content.notes.length > 0) {
          const validNotes = content.notes.filter(
            (n: any) => n && typeof n.id === 'string' && typeof n.color === 'string'
          ) as ScriptNote[]
          if (validNotes.length > 0) {
            onNotesLoaded(validNotes)
          }
        }

        // Native mode: load full Lexical editor state JSON
        if (isNative && content.editorState) {
          const editorState = editor.parseEditorState(content.editorState)
          editor.setEditorState(editorState)
          onLoaded()
          return
        }

        // Legacy mode: load from elements array
        if (content.elements?.length) {
          editor.update(() => {
            const root = $getRoot()
            root.clear()

            content.elements.forEach((el: LegacyElement) => {
              const mappedType =
                LEGACY_TYPE_MAP[el.type] || el.type || 'action'
              const node = createNodeByType(mappedType)

              if (el.text) {
                const textNode = $createTextNode(el.text)
                node.append(textNode)
              }

              root.append(node)
            })

            if (root.getChildrenSize() === 0) {
              root.append($createSceneHeadingNode())
            }
          })
        }
      }

      if (aborted) return
      onLoaded()
    })()
    return () => { aborted = true }
  }, [docId, tableName, editor, onLoaded, onTitlePageLoaded, onNotesLoaded, onTitleLoaded, isNative])

  return null
}

// ─── Plugin: Auto-save to Supabase (dual mode, 30s interval + blur) ───
function AutoSavePlugin({
  docId,
  tableName,
  loaded,
  titlePage,
  scriptNotesRef,
  onSaveStatus,
}: {
  docId: string
  tableName: string
  loaded: boolean
  titlePage: LegacyTitlePage
  scriptNotesRef: React.MutableRefObject<ScriptNote[]>
  onSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void
}) {
  const [editor] = useLexicalComposerContext()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dirtyRef = useRef(false)
  const titlePageRef = useRef(titlePage)
  const loadedRef = useRef(loaded)
  const isNative = tableName === 'screenwriter_scripts'

  useEffect(() => {
    titlePageRef.current = titlePage
  }, [titlePage])

  useEffect(() => {
    loadedRef.current = loaded
  }, [loaded])

  const saveToSupabase = useCallback(async () => {
    if (!loadedRef.current || !dirtyRef.current) return
    dirtyRef.current = false

    onSaveStatus('saving')

    try {
      if (isNative) {
        // Native mode: save full Lexical editor state JSON
        const editorStateJSON = editor.getEditorState().toJSON()
        await supabase
          .from(tableName)
          .update({
            content: {
              editorState: editorStateJSON,
              titlePage: titlePageRef.current,
              notes: scriptNotesRef.current,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', docId)
      } else {
        // Legacy mode: serialize to elements array
        editor.getEditorState().read(() => {
          const root = $getRoot()
          const children = root.getChildren()

          const elements: LegacyElement[] = children
            .filter((child) => isScreenplayNode(child))
            .map((child) => {
              const type = getNodeElementType(child)
              const legacyTypeMap: Record<string, string> = {
                'scene-heading': 'sceneHeading',
                action: 'action',
                character: 'character',
                dialogue: 'dialogue',
                parenthetical: 'parenthetical',
                transition: 'transition',
              }
              return {
                id: child.getKey() + '-' + Date.now().toString(36).slice(-4),
                type: (legacyTypeMap[type || 'action'] || 'action') as LegacyElement['type'],
                text: child.getTextContent(),
              }
            })

          supabase
            .from(tableName)
            .update({
              content: {
                titlePage: titlePageRef.current,
                elements,
                notes: scriptNotesRef.current,
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', docId)
            .then(() => {})
        })
      }

      onSaveStatus('saved')
    } catch {
      onSaveStatus('error')
      dirtyRef.current = true // retry on next cycle
    }
  }, [editor, docId, tableName, isNative, onSaveStatus, scriptNotesRef])

  // Mark dirty on any editor change
  const handleChange = useCallback(() => {
    if (!loadedRef.current) return
    dirtyRef.current = true
  }, [])

  // 30-second auto-save interval
  useEffect(() => {
    if (!loaded) return

    intervalRef.current = setInterval(() => {
      if (dirtyRef.current) saveToSupabase()
    }, 30000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [loaded, saveToSupabase])

  // Save on blur (window loses focus)
  useEffect(() => {
    if (!loaded) return

    const handleBlur = () => {
      if (dirtyRef.current) saveToSupabase()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && dirtyRef.current) {
        saveToSupabase()
      }
    }

    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [loaded, saveToSupabase])

  // Save on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (dirtyRef.current && loadedRef.current) saveToSupabase()
    }
  }, [saveToSupabase])

  return <OnChangePlugin onChange={handleChange} />
}

// ─── Plugin: Element type indicator ───
function ActiveElementPlugin({
  onActiveType,
}: {
  onActiveType: (type: ScriptElementType | null) => void
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          onActiveType(null)
          return
        }
        const anchorNode = selection.anchor.getNode()
        const block = anchorNode.getTopLevelElement()
        if (block) {
          onActiveType(getNodeElementType(block))
        } else {
          onActiveType(null)
        }
      })
    })
  }, [editor, onActiveType])

  return null
}

// ─── Plugin: Change current block's element type ───
function ChangeElementTypePlugin({
  targetType,
}: {
  targetType: string | null
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!targetType) return

    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      const anchorNode = selection.anchor.getNode()
      const block = anchorNode.getTopLevelElement()
      if (!block || !isScreenplayNode(block)) return

      const currentType = getNodeElementType(block)
      if (currentType === targetType) return

      const newNode = createNodeByType(targetType)
      const children = (block as ElementNode).getChildren()
      children.forEach((child) => newNode.append(child))
      block.replace(newNode)
      newNode.selectEnd()
    })
  }, [editor, targetType])

  return null
}

// ─── Plugin: Capture editor reference ───
function EditorRefPlugin({ editorRef }: { editorRef: React.MutableRefObject<any> }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editorRef.current = editor
  }, [editor, editorRef])
  return null
}

// ─── Plugin: Focus mode — highlight active element ───
function FocusModePlugin({ enabled }: { enabled: boolean }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!enabled) {
      // Clean up any existing highlights
      const root = editor.getRootElement()
      if (root) {
        root.querySelectorAll('.screenplay-focus-active').forEach((el) => {
          el.classList.remove('screenplay-focus-active')
        })
      }
      return
    }

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return

        const anchorNode = selection.anchor.getNode()
        const block = anchorNode.getTopLevelElement()
        if (!block) return

        const root = editor.getRootElement()
        if (!root) return

        // Remove old active class
        root.querySelectorAll('.screenplay-focus-active').forEach((el) => {
          el.classList.remove('screenplay-focus-active')
        })

        // Add active class to current block's DOM element
        const key = block.getKey()
        const dom = editor.getElementByKey(key)
        if (dom) {
          dom.classList.add('screenplay-focus-active')
        }
      })
    })
  }, [editor, enabled])

  return null
}

// ─── Plugin: Typewriter mode — scroll active element to center ───
function TypewriterPlugin({ enabled }: { enabled: boolean }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!enabled) return

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return

        const anchorNode = selection.anchor.getNode()
        const block = anchorNode.getTopLevelElement()
        if (!block) return

        const key = block.getKey()
        const dom = editor.getElementByKey(key)
        if (dom) {
          dom.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      })
    })
  }, [editor, enabled])

  return null
}

// ─── Plugin: Word count ───
function WordCountPlugin({ onWordCount }: { onWordCount: (count: number) => void }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot()
        const text = root.getTextContent()
        const words = text.trim() ? text.trim().split(/\s+/).length : 0
        onWordCount(words)
      })
    })
  }, [editor, onWordCount])

  return null
}

// ─── Export helpers ───

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function sanitizeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Untitled'
}


// ─── Main Component ───

interface ScriptEditorProps {
  docId: string
  title: string
  docType: string
  onBack: () => void
  onSaveTemplate: ((name: string, type: string, content: any) => void) | null
}

export default function ScriptEditor({
  docId,
  title,
  docType,
  onBack,
  onSaveTemplate,
}: ScriptEditorProps) {
  // ─── Load preferences ───
  const initialPrefs = useRef(loadPreferences())

  const [loaded, setLoaded] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [activeType, setActiveType] = useState<ScriptElementType | null>(null)
  const [changeToType, setChangeToType] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [wordCount, setWordCount] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [charPanelOpen, setCharPanelOpen] = useState(false)
  const [notesPanelOpen, setNotesPanelOpen] = useState(false)
  const [scriptNotes, setScriptNotes] = useState<ScriptNote[]>([])
  const scriptNotesRef = useRef<ScriptNote[]>([])
  const [scriptTitle, setScriptTitle] = useState(title)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)
  const [showSceneNumbers, setShowSceneNumbers] = useState(initialPrefs.current.showSceneNumbers)
  const [revisionMode, setRevisionMode] = useState(false)
  const [writingMode, setWritingMode] = useState<WritingMode>(initialPrefs.current.writingMode)
  const [theme, setTheme] = useState<ScreenplayTheme>(initialPrefs.current.theme)
  const [zoom, setZoom] = useState(initialPrefs.current.zoom)
  const [titlePage, setTitlePage] = useState<LegacyTitlePage>({
    title: '',
    writtenBy: '',
    basedOn: '',
    draft: '',
    date: '',
    contact: '',
  })

  const editorRef = useRef<any>(null)

  // Store panel states before entering focus/typewriter
  const savedPanelState = useRef<{
    sidebarOpen: boolean
    charPanelOpen: boolean
    notesPanelOpen: boolean
  } | null>(null)

  const tableName = TABLE_MAP[docType] || 'concept_documents'

  // ─── Sync preferences from Supabase on mount ───
  useEffect(() => {
    syncPreferences(initialPrefs.current).then((synced) => {
      setWritingMode(synced.writingMode)
      setTheme(synced.theme)
      setZoom(synced.zoom)
      setShowSceneNumbers(synced.showSceneNumbers)
    })
  }, [])

  // ─── Save preferences on change ───
  useEffect(() => {
    savePreferences({ writingMode, theme, zoom, showSceneNumbers })
  }, [writingMode, theme, zoom, showSceneNumbers])

  // ─── Writing mode change handler ───
  const handleWritingModeChange = useCallback((mode: WritingMode) => {
    setWritingMode((prev) => {
      if (mode !== 'normal' && prev === 'normal') {
        // Entering focus/typewriter: save panel states and close panels
        savedPanelState.current = {
          sidebarOpen,
          charPanelOpen,
          notesPanelOpen,
        }
        setSidebarOpen(false)
        setCharPanelOpen(false)
        setNotesPanelOpen(false)
        setFindReplaceOpen(false)
      } else if (mode === 'normal' && prev !== 'normal') {
        // Returning to normal: restore panel states
        if (savedPanelState.current) {
          setSidebarOpen(savedPanelState.current.sidebarOpen)
          setCharPanelOpen(savedPanelState.current.charPanelOpen)
          setNotesPanelOpen(savedPanelState.current.notesPanelOpen)
          savedPanelState.current = null
        }
      }
      return mode
    })
  }, [sidebarOpen, charPanelOpen, notesPanelOpen])

  const handleThemeChange = useCallback((newTheme: ScreenplayTheme) => {
    setTheme(newTheme)
  }, [])

  const handleExportFDX = useCallback(() => {
    if (!editorRef.current) return
    const stateJSON = editorRef.current.getEditorState().toJSON()
    const fdx = exportToFDX(stateJSON, titlePage, scriptTitle)
    triggerDownload(fdx, `${sanitizeFilename(scriptTitle)}.fdx`, 'application/xml')
  }, [titlePage, scriptTitle])

  const handleExportTXT = useCallback(() => {
    if (!editorRef.current) return
    const stateJSON = editorRef.current.getEditorState().toJSON()
    const txt = exportToTXT(stateJSON, titlePage, scriptTitle)
    triggerDownload(txt, `${sanitizeFilename(scriptTitle)}.txt`, 'text/plain')
  }, [titlePage, scriptTitle])

  const handleExportPDF = useCallback(() => {
    setShowPrintPreview(true)
  }, [])

  const handleSave = useCallback(() => {
    // Trigger an immediate save by marking dirty and calling save
    if (!editorRef.current) return
    // Dispatch a no-op update to trigger the onChange which marks dirty
    // The AutoSavePlugin will pick it up — but we want immediate save
    // So we trigger saveToSupabase via a custom approach: just dispatch a synthetic blur
    window.dispatchEvent(new Event('blur'))
  }, [])

  const handleUndo = useCallback(() => {
    editorRef.current?.dispatchCommand(UNDO_COMMAND, undefined)
  }, [])

  const handleRedo = useCallback(() => {
    editorRef.current?.dispatchCommand(REDO_COMMAND, undefined)
  }, [])

  const handleTitleChange = useCallback((newTitle: string) => {
    setScriptTitle(newTitle)
    // Update title in Supabase
    if (tableName === 'screenwriter_scripts') {
      supabase
        .from(tableName)
        .update({ title: newTitle, updated_at: new Date().toISOString() })
        .eq('id', docId)
        .then(() => {})
    }
  }, [tableName, docId])

  const handleLoaded = useCallback(() => setLoaded(true), [])
  const handleTitlePageLoaded = useCallback(
    (tp: LegacyTitlePage) => setTitlePage(tp),
    []
  )
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSaveStatus = useCallback((status: 'idle' | 'saving' | 'saved' | 'error') => {
    setSaveStatus(status)
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current)
    if (status === 'saved') {
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [])
  const handleTitleLoaded = useCallback((t: string) => setScriptTitle(t), [])
  const handleActiveType = useCallback(
    (type: ScriptElementType | null) => setActiveType(type),
    []
  )
  const handlePageCount = useCallback((count: number) => setPageCount(count), [])
  const handleWordCount = useCallback((count: number) => setWordCount(count), [])

  const handleNotesChange = useCallback((notes: ScriptNote[]) => {
    setScriptNotes(notes)
    scriptNotesRef.current = notes
  }, [])

  const handleOpenNotesPanel = useCallback(() => {
    setNotesPanelOpen(true)
  }, [])

  // Clear changeToType after it's been applied
  useEffect(() => {
    if (changeToType) {
      const t = setTimeout(() => setChangeToType(null), 50)
      return () => clearTimeout(t)
    }
  }, [changeToType])

  const initialConfig = {
    namespace: 'ScreenplayEditor',
    theme: screenplayTheme,
    nodes: ScreenplayNodes,
    onError: (error: Error) => {
      console.error('Lexical error:', error)
    },
    editorState: () => {
      // Start with a single empty scene heading
      const root = $getRoot()
      root.append($createSceneHeadingNode())
    },
  }

  // Zoom style for the canvas
  const canvasStyle: React.CSSProperties = zoom !== 100
    ? { transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }
    : {}

  const isFocusMode = writingMode === 'focus'
  const isTypewriterMode = writingMode === 'typewriter'

  return (
    <div
      className={`screenplay-editor-root${isFocusMode ? ' screenplay-focus-mode' : ''}${isTypewriterMode ? ' screenplay-typewriter-mode' : ''}`}
      data-screenplay-theme={theme}
    >
      <LexicalComposer initialConfig={initialConfig}>
        {/* ─── Toolbar ─── */}
        <Toolbar
          onBack={onBack}
          scriptTitle={scriptTitle}
          onTitleChange={handleTitleChange}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          charPanelOpen={charPanelOpen}
          onToggleCharPanel={() => setCharPanelOpen((v) => !v)}
          notesPanelOpen={notesPanelOpen}
          onToggleNotesPanel={() => setNotesPanelOpen((v) => !v)}
          activeType={activeType}
          onChangeType={setChangeToType}
          pageCount={pageCount}
          wordCount={wordCount}
          saveStatus={saveStatus}
          onSave={handleSave}
          onExportPDF={handleExportPDF}
          onExportFDX={handleExportFDX}
          onExportTXT={handleExportTXT}
          onUndo={handleUndo}
          onRedo={handleRedo}
          findReplaceOpen={findReplaceOpen}
          onToggleFindReplace={() => setFindReplaceOpen((v) => !v)}
          showSceneNumbers={showSceneNumbers}
          onToggleSceneNumbers={() => setShowSceneNumbers((v) => !v)}
          revisionMode={revisionMode}
          onToggleRevisionMode={() => setRevisionMode((v) => !v)}
          writingMode={writingMode}
          onWritingModeChange={handleWritingModeChange}
          theme={theme}
          onThemeChange={handleThemeChange}
          zoom={zoom}
          onZoomChange={setZoom}
        />

        {/* ─── Find & Replace ─── */}
        {findReplaceOpen && writingMode === 'normal' && (
          <FindReplaceBar
            onClose={() => setFindReplaceOpen(false)}
            editorRef={editorRef}
            theme={theme}
          />
        )}

        {/* ─── Main: sidebar + canvas ─── */}
        <div className="screenplay-main">
          {sidebarOpen && writingMode === 'normal' && (
            <SceneNavigator
              pageCount={pageCount}
              onClose={() => setSidebarOpen(false)}
            />
          )}
          <div className="screenplay-canvas">
            <div className="screenplay-page" style={canvasStyle}>
              <RichTextPlugin
                contentEditable={
                  <ContentEditable className="screenplay-root" />
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            </div>
          </div>
          {charPanelOpen && writingMode === 'normal' && (
            <CharacterManager
              docId={docId}
              onClose={() => setCharPanelOpen(false)}
            />
          )}
          {notesPanelOpen && writingMode === 'normal' && (
            <NotesPanel
              notes={scriptNotes}
              onNotesChange={handleNotesChange}
              onClose={() => setNotesPanelOpen(false)}
            />
          )}
        </div>

        {/* ─── Plugins ─── */}
        <EditorRefPlugin editorRef={editorRef} />
        <HistoryPlugin />
        <AutocompletePlugin />
        <PageBreakPlugin onPageCount={handlePageCount} />
        <NotesPlugin
          notes={scriptNotes}
          onNotesChange={handleNotesChange}
          onOpenPanel={handleOpenNotesPanel}
        />
        <ScreenplayKeyPlugin />
        <FocusModePlugin enabled={isFocusMode} />
        <TypewriterPlugin enabled={isTypewriterMode} />
        <WordCountPlugin onWordCount={handleWordCount} />
        <ActiveElementPlugin onActiveType={handleActiveType} />
        <ChangeElementTypePlugin targetType={changeToType} />
        <LoadContentPlugin
          docId={docId}
          tableName={tableName}
          onLoaded={handleLoaded}
          onTitlePageLoaded={handleTitlePageLoaded}
          onNotesLoaded={handleNotesChange}
          onTitleLoaded={handleTitleLoaded}
        />
        <AutoSavePlugin
          docId={docId}
          tableName={tableName}
          loaded={loaded}
          titlePage={titlePage}
          scriptNotesRef={scriptNotesRef}
          onSaveStatus={handleSaveStatus}
        />
      </LexicalComposer>

      {!loaded && <div className="screenplay-loading">Loading screenplay...</div>}

      {showPrintPreview && editorRef.current && (
        <PrintPreviewModal
          editorState={editorRef.current.getEditorState().toJSON()}
          titlePage={titlePage}
          scriptTitle={scriptTitle}
          onClose={() => setShowPrintPreview(false)}
        />
      )}
    </div>
  )
}
