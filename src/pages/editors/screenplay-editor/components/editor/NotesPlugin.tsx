import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $createTextNode,
  type LexicalNode,
  type TextNode,
  type ElementNode,
  type RangeSelection,
} from 'lexical'
import {
  $createNoteMarkNode,
  $isNoteMarkNode,
  type NoteColor,
} from '../../nodes/NoteMarkNode'
import type { ScriptNote } from '../../types'

// ─── Generate a short unique ID ───

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// ─── Unwrap a NoteMarkNode, moving its children to its parent ───

export function $unwrapNoteMarkById(noteId: string) {
  const root = $getRoot()
  const allChildren = root.getChildren()

  for (const block of allChildren) {
    const descendants = (block as ElementNode).getChildren
      ? (block as ElementNode).getChildren()
      : []

    for (const child of descendants) {
      if ($isNoteMarkNode(child) && child.getNoteId() === noteId) {
        const parent = child.getParent()
        if (!parent) continue

        const kids = child.getChildren()
        for (const k of kids) {
          child.insertBefore(k)
        }
        child.remove()
        return true
      }

      // Check one level deeper (note mark inside text structure)
      if ((child as ElementNode).getChildren) {
        for (const grandchild of (child as ElementNode).getChildren()) {
          if (
            $isNoteMarkNode(grandchild) &&
            grandchild.getNoteId() === noteId
          ) {
            const kids = grandchild.getChildren()
            for (const k of kids) {
              grandchild.insertBefore(k)
            }
            grandchild.remove()
            return true
          }
        }
      }
    }
  }

  return false
}

// ─── Collect all NoteMarkNodes from the tree ───

export function $collectNoteMarkIds(): string[] {
  const ids: string[] = []
  const root = $getRoot()

  function walk(node: LexicalNode) {
    if ($isNoteMarkNode(node)) {
      ids.push(node.getNoteId())
    }
    if ((node as ElementNode).getChildren) {
      for (const child of (node as ElementNode).getChildren()) {
        walk(child)
      }
    }
  }

  for (const child of root.getChildren()) {
    walk(child)
  }

  return ids
}

// ─── Wrap the current selection in a NoteMarkNode ───

function $wrapSelectionInNoteMark(
  selection: RangeSelection,
  noteId: string,
  color: NoteColor
): string | null {
  const nodes = selection.getNodes()
  if (nodes.length === 0) return null

  const anchor = selection.anchor
  const focus = selection.focus

  // Determine which is first
  const isBackward = selection.isBackward()
  const startPoint = isBackward ? focus : anchor
  const endPoint = isBackward ? anchor : focus

  const startNode = startPoint.getNode()
  const endNode = endPoint.getNode()
  const startOffset = startPoint.offset
  const endOffset = endPoint.offset

  // Simple case: selection is within a single text node
  if ($isTextNode(startNode) && startNode === endNode) {
    return wrapSingleTextNode(
      startNode,
      startOffset,
      endOffset,
      noteId,
      color
    )
  }

  // Multi-node case: wrap each text node in the selection
  // Split first and last nodes at boundaries, wrap everything in between
  let wrapped = false

  for (const node of nodes) {
    if (!$isTextNode(node)) continue

    if (node === startNode) {
      // Split at startOffset, wrap the right part
      if (startOffset > 0) {
        const [, rightPart] = (node as TextNode).splitText(startOffset)
        if (rightPart) {
          wrapEntireTextNode(rightPart, noteId, color)
          wrapped = true
        }
      } else {
        wrapEntireTextNode(node as TextNode, noteId, color)
        wrapped = true
      }
    } else if (node === endNode) {
      // Split at endOffset, wrap the left part
      if (endOffset < (node as TextNode).getTextContentSize()) {
        const [leftPart] = (node as TextNode).splitText(endOffset)
        if (leftPart) {
          wrapEntireTextNode(leftPart, noteId, color)
          wrapped = true
        }
      } else {
        wrapEntireTextNode(node as TextNode, noteId, color)
        wrapped = true
      }
    } else {
      // Middle node — wrap entirely
      wrapEntireTextNode(node as TextNode, noteId, color)
      wrapped = true
    }
  }

  return wrapped ? noteId : null
}

function wrapSingleTextNode(
  textNode: TextNode,
  startOffset: number,
  endOffset: number,
  noteId: string,
  color: NoteColor
): string {
  if (startOffset === 0 && endOffset === textNode.getTextContentSize()) {
    // Wrap the entire node
    wrapEntireTextNode(textNode, noteId, color)
    return noteId
  }

  // Split the text node at the boundaries
  const splits: number[] = []
  if (startOffset > 0) splits.push(startOffset)
  if (endOffset < textNode.getTextContentSize()) splits.push(endOffset)

  const parts = textNode.splitText(...splits)

  // Find the middle part (the highlighted portion)
  let targetNode: TextNode
  if (startOffset > 0) {
    targetNode = parts[1]
  } else {
    targetNode = parts[0]
  }

  if (targetNode) {
    wrapEntireTextNode(targetNode, noteId, color)
  }

  return noteId
}

function wrapEntireTextNode(
  textNode: TextNode,
  noteId: string,
  color: NoteColor
) {
  const text = textNode.getTextContent()
  const mark = $createNoteMarkNode(noteId, color)
  const newText = $createTextNode(text)
  // Carry over ALL text attributes, not just format — otherwise inline style
  // (color/font), detail flags, and mode are dropped when highlighting to a note.
  newText.setFormat(textNode.getFormat())
  newText.setStyle(textNode.getStyle())
  newText.setDetail(textNode.getDetail())
  newText.setMode(textNode.getMode())
  mark.append(newText)
  textNode.replace(mark)
}

// ─── Floating color picker ───

function NoteColorPicker({
  anchorRect,
  onSelectColor,
  onDismiss,
}: {
  anchorRect: DOMRect
  onSelectColor: (color: NoteColor) => void
  onDismiss: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss()
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onDismiss])

  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.top - 44,
    left: anchorRect.left + anchorRect.width / 2,
    transform: 'translateX(-50%)',
    zIndex: 9999,
  }

  // If too close to top, show below
  if (anchorRect.top < 60) {
    style.top = anchorRect.bottom + 8
  }

  const colors: { color: NoteColor; label: string; bg: string }[] = [
    { color: 'yellow', label: 'Yellow', bg: '#fbbf24' },
    { color: 'green', label: 'Green', bg: '#34d399' },
    { color: 'pink', label: 'Pink', bg: '#f472b6' },
    { color: 'blue', label: 'Blue', bg: '#60a5fa' },
  ]

  return createPortal(
    <div ref={ref} className="note-color-picker" style={style}>
      {colors.map((c) => (
        <button
          key={c.color}
          className="note-color-dot"
          style={{ background: c.bg }}
          title={`${c.label} note`}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onSelectColor(c.color)
          }}
        />
      ))}
    </div>,
    document.body
  )
}

// ─── Main Plugin ───

export default function NotesPlugin({
  notes,
  onNotesChange,
  onOpenPanel,
}: {
  notes: ScriptNote[]
  onNotesChange: (notes: ScriptNote[]) => void
  onOpenPanel: () => void
}) {
  const [editor] = useLexicalComposerContext()
  const [showPicker, setShowPicker] = useState(false)
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null)
  const notesRef = useRef(notes)

  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  // Detect non-collapsed selection to show picker
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (
          $isRangeSelection(selection) &&
          !selection.isCollapsed() &&
          selection.getTextContent().trim().length > 0
        ) {
          // Get the native selection rect
          const nativeSel = window.getSelection()
          if (nativeSel && nativeSel.rangeCount > 0) {
            const range = nativeSel.getRangeAt(0)
            const rect = range.getBoundingClientRect()
            if (rect.width > 0) {
              setPickerRect(rect)
              setShowPicker(true)
              return
            }
          }
        }
        setShowPicker(false)
        setPickerRect(null)
      })
    })
  }, [editor])

  // Handle color selection — create the note
  const handleSelectColor = useCallback(
    (color: NoteColor) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || selection.isCollapsed()) return

        const highlightedText = selection.getTextContent()
        const noteId = uid()

        const success = $wrapSelectionInNoteMark(selection, noteId, color)
        if (!success) return

        // Compute element index for anchoring
        const anchorNode = selection.anchor.getNode()
        const block = anchorNode.getTopLevelElement()
        let elementIndex = 0
        if (block) {
          const root = $getRoot()
          const children = root.getChildren()
          for (let i = 0; i < children.length; i++) {
            if (children[i].getKey() === block.getKey()) {
              elementIndex = i
              break
            }
          }
        }

        const newNote: ScriptNote = {
          id: noteId,
          color,
          text: '',
          highlightedText,
          elementIndex,
          offset: 0,
          length: highlightedText.length,
          createdAt: new Date().toISOString(),
          resolved: false,
        }

        onNotesChange([...notesRef.current, newNote])
      })

      setShowPicker(false)
      setPickerRect(null)
      onOpenPanel()
    },
    [editor, onNotesChange, onOpenPanel]
  )

  // Resolve a note — unwrap its mark and remove from list
  const resolveNote = useCallback(
    (noteId: string) => {
      editor.update(() => {
        $unwrapNoteMarkById(noteId)
      })
      onNotesChange(notesRef.current.filter((n) => n.id !== noteId))
    },
    [editor, onNotesChange]
  )

  // Expose resolveNote via a ref that the panel can access
  // We'll pass it as a prop through the parent instead

  return (
    <>
      {showPicker && pickerRect && (
        <NoteColorPicker
          anchorRect={pickerRect}
          onSelectColor={handleSelectColor}
          onDismiss={() => {
            setShowPicker(false)
            setPickerRect(null)
          }}
        />
      )}
    </>
  )
}
