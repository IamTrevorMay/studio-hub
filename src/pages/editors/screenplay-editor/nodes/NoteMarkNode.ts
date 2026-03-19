import {
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
  $applyNodeReplacement,
} from 'lexical'

export type NoteColor = 'yellow' | 'green' | 'pink' | 'blue'

export type SerializedNoteMarkNode = Spread<
  { noteId: string; noteColor: NoteColor },
  SerializedElementNode
>

/**
 * NoteMarkNode — inline element that wraps text with a colored highlight.
 * Carries a noteId linking to the external ScriptNote metadata.
 */
export class NoteMarkNode extends ElementNode {
  __noteId: string
  __noteColor: NoteColor

  static getType(): string {
    return 'note-mark'
  }

  static clone(node: NoteMarkNode): NoteMarkNode {
    return new NoteMarkNode(node.__noteId, node.__noteColor, node.__key)
  }

  constructor(noteId: string, noteColor: NoteColor, key?: NodeKey) {
    super(key)
    this.__noteId = noteId
    this.__noteColor = noteColor
  }

  // ─── Inline behavior ───

  isInline(): boolean {
    return true
  }

  canInsertTextBefore(): boolean {
    return false
  }

  canInsertTextAfter(): boolean {
    return false
  }

  canBeEmpty(): boolean {
    return false
  }

  // ─── DOM ───

  createDOM(): HTMLElement {
    const mark = document.createElement('mark')
    mark.className = `screenplay-note-mark screenplay-note-${this.__noteColor}`
    mark.dataset.noteId = this.__noteId
    return mark
  }

  updateDOM(prevNode: NoteMarkNode): boolean {
    return (
      prevNode.__noteColor !== this.__noteColor ||
      prevNode.__noteId !== this.__noteId
    )
  }

  // ─── Serialization ───

  static importJSON(json: SerializedNoteMarkNode): NoteMarkNode {
    return $createNoteMarkNode(json.noteId, json.noteColor)
  }

  exportJSON(): SerializedNoteMarkNode {
    return {
      ...super.exportJSON(),
      type: 'note-mark',
      noteId: this.__noteId,
      noteColor: this.__noteColor,
      version: 1,
    }
  }

  // ─── Accessors ───

  getNoteId(): string {
    return this.__noteId
  }

  getNoteColor(): NoteColor {
    return this.__noteColor
  }

  setNoteColor(color: NoteColor): void {
    const writable = this.getWritable()
    writable.__noteColor = color
  }
}

export function $createNoteMarkNode(
  noteId: string,
  noteColor: NoteColor
): NoteMarkNode {
  return $applyNodeReplacement(new NoteMarkNode(noteId, noteColor))
}

export function $isNoteMarkNode(
  node: LexicalNode | null | undefined
): node is NoteMarkNode {
  return node instanceof NoteMarkNode
}
