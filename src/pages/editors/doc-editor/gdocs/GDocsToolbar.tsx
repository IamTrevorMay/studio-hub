import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  CheckSquare,
  Highlighter,
  Image as ImageIcon,
  Indent,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquarePlus,
  Minus,
  Outdent,
  Plus,
  Printer,
  RemoveFormatting,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react'
import { useEditorStore } from '../editorStore'

// The single toolbar strip that sits under the menu bar. Ordered to match
// Google Docs left-to-right so muscle memory carries over; colored with the
// studio's navy/blue palette rather than Docs' white.

const FONT_FAMILIES = [
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'DM Sans', value: "'DM Sans', sans-serif" },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Courier New', value: 'Courier New, monospace' },
]

const ZOOM_LEVELS = [50, 75, 90, 100, 125, 150, 200]

const LINE_SPACINGS = [
  { label: '1.0', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: '2.0', value: '2' },
]

const COLOR_PALETTE = [
  '#000000', '#434343', '#666666', '#999999',
  '#b7b7b7', '#cccccc', '#d9d9d9', '#ffffff',
  '#e06666', '#f6b26b', '#ffd966', '#93c47d',
  '#76a5af', '#6fa8dc', '#8e7cc3', '#c27ba0',
]

const MIN_FONT_PX = 6
const MAX_FONT_PX = 96

const selectClass =
  'h-7 bg-navy-800 border border-navy-700 rounded text-[12px] text-navy-200 outline-none ' +
  'focus:border-blue-500 cursor-pointer px-1.5'

function Btn({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-7 w-7 flex items-center justify-center rounded transition-colors flex-shrink-0 ${
        active
          ? 'bg-blue-500/25 text-blue-200'
          : 'text-navy-300 hover:bg-navy-700 hover:text-white'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <div className="w-px h-5 bg-navy-700 mx-1 flex-shrink-0" />
}

function ColorButton({
  swatch,
  title,
  icon,
  onPick,
}: {
  swatch: string
  title: string
  icon: React.ReactNode
  onPick: (color: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        title={title}
        onClick={() => setOpen(!open)}
        className="h-7 w-7 flex flex-col items-center justify-center gap-0.5 rounded text-navy-300 hover:bg-navy-700 hover:text-white transition-colors cursor-pointer"
      >
        {icon}
        <div className="w-4 h-[3px] rounded-sm" style={{ background: swatch || 'transparent' }} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-[60] bg-navy-800 border border-navy-600 rounded-lg p-3 shadow-2xl w-[180px]">
          <div className="grid grid-cols-4 gap-1.5">
            {COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => { onPick(color); setOpen(false) }}
                className={`w-8 h-8 rounded cursor-pointer border-2 transition-transform hover:scale-110 ${
                  swatch === color ? 'border-blue-400' : 'border-transparent'
                }`}
                style={{ background: color }}
              />
            ))}
          </div>
          <div className="flex gap-1.5 mt-2.5">
            <input
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              placeholder="#hex"
              className="flex-1 min-w-0 px-2 py-1 text-xs bg-navy-900 border border-navy-600 rounded text-navy-100 outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => {
                const val = hex.startsWith('#') ? hex : `#${hex}`
                if (/^#[0-9a-fA-F]{3,8}$/.test(val)) {
                  onPick(val)
                  setOpen(false)
                  setHex('')
                }
              }}
              className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface Props {
  editor: Editor
  onAddComment: () => void
  onInsertImage: () => void
  onInsertLink: () => void
}

export default function GDocsToolbar({ editor, onAddComment, onInsertImage, onInsertLink }: Props) {
  const { zoom, setZoom } = useEditorStore()

  const attrs = editor.getAttributes('textStyle')
  const fontFamily = attrs.fontFamily || 'Arial, sans-serif'
  const fontSizePx = parseInt(attrs.fontSize || '11', 10) || 11
  const color = attrs.color || '#000000'
  const highlight = editor.getAttributes('highlight').color || ''
  const lineHeight = attrs.lineHeight || '1.15'

  const paragraphStyle = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'p'

  const setParagraphStyle = (value: string) => {
    const chain = editor.chain().focus()
    if (value === 'p') chain.setParagraph().run()
    else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run()
  }

  const setFontSize = (px: number) => {
    const clamped = Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, px))
    editor.chain().focus().setFontSize(`${clamped}px`).run()
  }

  const align = (a: 'left' | 'center' | 'right' | 'justify') =>
    editor.chain().focus().setTextAlign(a).run()

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 bg-navy-800/60 border-b border-navy-700 overflow-x-auto gdocs-toolbar">
      <Btn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (⌘Z)">
        <Undo2 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (⇧⌘Z)">
        <Redo2 size={16} />
      </Btn>
      <Btn onClick={() => window.print()} title="Print (⌘P)">
        <Printer size={16} />
      </Btn>

      <Sep />

      <select
        value={zoom}
        onChange={(e) => setZoom(Number(e.target.value))}
        title="Zoom"
        className={`${selectClass} w-[68px] flex-shrink-0`}
      >
        {ZOOM_LEVELS.map((z) => (
          <option key={z} value={z}>{z}%</option>
        ))}
      </select>

      <Sep />

      <select
        value={paragraphStyle}
        onChange={(e) => setParagraphStyle(e.target.value)}
        title="Paragraph style"
        className={`${selectClass} w-[112px] flex-shrink-0`}
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>

      <select
        value={fontFamily}
        onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
        title="Font"
        className={`${selectClass} w-[124px] flex-shrink-0`}
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
        ))}
      </select>

      <Sep />

      {/* Font size stepper — the − N + shape Docs uses */}
      <div className="flex items-center flex-shrink-0">
        <Btn onClick={() => setFontSize(fontSizePx - 1)} title="Decrease font size">
          <Minus size={14} />
        </Btn>
        <input
          value={fontSizePx}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10)
            if (!Number.isNaN(next)) setFontSize(next)
          }}
          title="Font size"
          className="h-7 w-9 text-center bg-navy-800 border border-navy-700 rounded text-[12px] text-navy-200 outline-none focus:border-blue-500"
        />
        <Btn onClick={() => setFontSize(fontSizePx + 1)} title="Increase font size">
          <Plus size={14} />
        </Btn>
      </div>

      <Sep />

      <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (⌘B)">
        <Bold size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (⌘I)">
        <Italic size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (⌘U)">
        <Underline size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
        <Strikethrough size={16} />
      </Btn>

      <ColorButton
        swatch={color}
        title="Text color"
        icon={<Baseline size={14} />}
        onPick={(c) => editor.chain().focus().setColor(c).run()}
      />
      <ColorButton
        swatch={highlight}
        title="Highlight color"
        icon={<Highlighter size={14} />}
        onPick={(c) => editor.chain().focus().toggleHighlight({ color: c }).run()}
      />

      <Sep />

      <Btn onClick={onInsertLink} active={editor.isActive('link')} title="Insert link (⌘K)">
        <Link2 size={16} />
      </Btn>
      <Btn onClick={onAddComment} disabled={editor.state.selection.empty} title="Add comment">
        <MessageSquarePlus size={16} />
      </Btn>
      <Btn onClick={onInsertImage} title="Insert image">
        <ImageIcon size={16} />
      </Btn>

      <Sep />

      <Btn onClick={() => align('left')} active={editor.isActive({ textAlign: 'left' })} title="Align left">
        <AlignLeft size={16} />
      </Btn>
      <Btn onClick={() => align('center')} active={editor.isActive({ textAlign: 'center' })} title="Center">
        <AlignCenter size={16} />
      </Btn>
      <Btn onClick={() => align('right')} active={editor.isActive({ textAlign: 'right' })} title="Align right">
        <AlignRight size={16} />
      </Btn>
      <Btn onClick={() => align('justify')} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
        <AlignJustify size={16} />
      </Btn>

      <select
        value={lineHeight}
        onChange={(e) => editor.chain().focus().setLineHeight(e.target.value).run()}
        title="Line spacing"
        className={`${selectClass} w-[58px] flex-shrink-0`}
      >
        {LINE_SPACINGS.map((ls) => (
          <option key={ls.value} value={ls.value}>{ls.label}</option>
        ))}
      </select>

      <Sep />

      <Btn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Checklist">
        <CheckSquare size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bulleted list">
        <List size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
        <ListOrdered size={16} />
      </Btn>

      <Btn onClick={() => editor.chain().focus().outdent().run()} title="Decrease indent (⇧Tab)">
        <Outdent size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().indent().run()} title="Increase indent (Tab)">
        <Indent size={16} />
      </Btn>

      <Sep />

      <Btn
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        title="Clear formatting (⌘\)"
      >
        <RemoveFormatting size={16} />
      </Btn>
    </div>
  )
}
