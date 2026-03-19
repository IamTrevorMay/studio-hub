import { useState, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorStore } from '../store/editorStore'
import { useRelativeTime } from '../hooks/useRelativeTime'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Undo2,
  Redo2,
  RemoveFormatting,
  Check,
  Loader2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Indent,
  Outdent,
  Baseline,
  Highlighter,
  MessageSquarePlus,
} from 'lucide-react'

// ── Platform detection ──

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
const mod = isMac ? '⌘' : 'Ctrl+'

// ── Constants ──

const FONT_FAMILIES = [
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: 'Courier New, monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
]

const FONT_SIZES = [
  '10px', '11px', '12px', '14px', '16px', '18px',
  '20px', '24px', '28px', '32px', '36px', '48px',
]

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

// ── Shared sub-components ──

interface ToolbarButtonProps {
  onClick: () => void
  isActive?: boolean
  disabled?: boolean
  children: React.ReactNode
  title: string
}

function ToolbarButton({ onClick, isActive, disabled, children, title }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        isActive
          ? 'bg-navy-600 text-white'
          : 'text-navy-300 hover:bg-navy-700 hover:text-white'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="w-px h-6 bg-navy-700 mx-1" />
}

interface ColorPickerProps {
  currentColor: string
  onColorChange: (color: string) => void
  icon: React.ReactNode
  title: string
}

function ColorPicker({ currentColor, onColorChange, icon, title }: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={title}
        className="p-1.5 rounded text-navy-300 hover:bg-navy-700 hover:text-white transition-colors cursor-pointer flex items-center gap-0.5"
      >
        {icon}
        <div
          className="w-4 h-1 rounded-sm"
          style={{ background: currentColor || '#ffffff' }}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-navy-800 border border-navy-600 rounded-lg p-3 shadow-xl w-[176px]">
          <div className="grid grid-cols-4 gap-1.5 mb-2">
            {COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  onColorChange(color)
                  setOpen(false)
                }}
                className={`w-8 h-8 rounded cursor-pointer border-2 transition-transform hover:scale-110 ${
                  currentColor === color ? 'border-blue-400' : 'border-transparent'
                }`}
                style={{ background: color }}
                title={color}
              />
            ))}
          </div>
          <div className="flex gap-1.5 mt-2">
            <input
              type="text"
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
                  onColorChange(val)
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

// ── Main Toolbar ──

interface ToolbarProps {
  editor: Editor | null
  onAddComment?: () => void
}

export default function Toolbar({ editor, onAddComment }: ToolbarProps) {
  const { isSaving, lastSavedAt } = useEditorStore()
  const relativeTime = useRelativeTime(lastSavedAt)

  if (!editor) return null

  const iconSize = 18

  // Read current formatting at cursor
  const textStyleAttrs = editor.getAttributes('textStyle')
  const currentFontFamily = textStyleAttrs.fontFamily || 'Arial, sans-serif'
  const currentFontSize = textStyleAttrs.fontSize || '11px'
  const currentColor = textStyleAttrs.color || '#000000'
  const currentHighlight = editor.getAttributes('highlight').color || ''
  const currentLineHeight = textStyleAttrs.lineHeight || '1.15'

  return (
    <div className="bg-navy-900 border-b border-navy-700">
      {/* ── Row 1: Core formatting ── */}
      <div className="flex items-center gap-0.5 px-4 py-1.5 flex-wrap">
        {/* Undo / Redo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title={`Undo (${mod}Z)`}
        >
          <Undo2 size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title={`Redo (${mod}${isMac ? '⇧Z' : 'Y'})`}
        >
          <Redo2 size={iconSize} />
        </ToolbarButton>

        <Divider />

        {/* Text formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title={`Bold (${mod}B)`}
        >
          <Bold size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title={`Italic (${mod}I)`}
        >
          <Italic size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
          title={`Underline (${mod}U)`}
        >
          <Underline size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
          title={`Strikethrough (${mod}${isMac ? '⇧X' : 'Shift+X'})`}
        >
          <Strikethrough size={iconSize} />
        </ToolbarButton>

        <Divider />

        {/* Headings */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive('heading', { level: 1 })}
          title={`Heading 1 (${mod}${isMac ? '⌥' : 'Alt+'}1)`}
        >
          <Heading1 size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          title={`Heading 2 (${mod}${isMac ? '⌥' : 'Alt+'}2)`}
        >
          <Heading2 size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive('heading', { level: 3 })}
          title={`Heading 3 (${mod}${isMac ? '⌥' : 'Alt+'}3)`}
        >
          <Heading3 size={iconSize} />
        </ToolbarButton>

        <Divider />

        {/* Lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title={`Bullet List (${mod}${isMac ? '⇧8' : 'Shift+8'})`}
        >
          <List size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title={`Numbered List (${mod}${isMac ? '⇧7' : 'Shift+7'})`}
        >
          <ListOrdered size={iconSize} />
        </ToolbarButton>

        <Divider />

        {/* Block elements */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          title={`Blockquote (${mod}${isMac ? '⇧B' : 'Shift+B'})`}
        >
          <Quote size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Rule"
        >
          <Minus size={iconSize} />
        </ToolbarButton>

        <Divider />

        {/* Clear formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          title={`Clear Formatting (${mod}\\)`}
        >
          <RemoveFormatting size={iconSize} />
        </ToolbarButton>

        <Divider />

        {/* Add Comment */}
        <ToolbarButton
          onClick={() => onAddComment?.()}
          disabled={editor.state.selection.empty}
          title="Add Comment"
        >
          <MessageSquarePlus size={iconSize} />
        </ToolbarButton>

        {/* Save indicator */}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-navy-400">
          {isSaving ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>Saving...</span>
            </>
          ) : relativeTime ? (
            <>
              <Check size={13} className="text-green-500" />
              <span>Saved {relativeTime}</span>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Row 2: Extended formatting ── */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-t border-navy-800 flex-wrap">
        {/* Font family */}
        <select
          value={currentFontFamily}
          onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          title="Font family"
          className="h-7 px-2 text-xs bg-navy-800 border border-navy-700 rounded text-navy-200 outline-none focus:border-blue-500 cursor-pointer"
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
              {f.label}
            </option>
          ))}
        </select>

        {/* Font size */}
        <select
          value={currentFontSize}
          onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}
          title="Font size"
          className="h-7 w-16 px-2 text-xs bg-navy-800 border border-navy-700 rounded text-navy-200 outline-none focus:border-blue-500 cursor-pointer"
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {parseInt(s)}
            </option>
          ))}
        </select>

        <Divider />

        {/* Text color */}
        <ColorPicker
          currentColor={currentColor}
          onColorChange={(color) => editor.chain().focus().setColor(color).run()}
          icon={<Baseline size={16} />}
          title="Text color"
        />

        {/* Highlight color */}
        <ColorPicker
          currentColor={currentHighlight}
          onColorChange={(color) => editor.chain().focus().toggleHighlight({ color }).run()}
          icon={<Highlighter size={16} />}
          title="Highlight color"
        />

        <Divider />

        {/* Text alignment */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          isActive={editor.isActive({ textAlign: 'left' })}
          title={`Align Left (${mod}${isMac ? '⇧L' : 'Shift+L'})`}
        >
          <AlignLeft size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          isActive={editor.isActive({ textAlign: 'center' })}
          title={`Align Center (${mod}${isMac ? '⇧E' : 'Shift+E'})`}
        >
          <AlignCenter size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          isActive={editor.isActive({ textAlign: 'right' })}
          title={`Align Right (${mod}${isMac ? '⇧R' : 'Shift+R'})`}
        >
          <AlignRight size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          isActive={editor.isActive({ textAlign: 'justify' })}
          title={`Justify (${mod}${isMac ? '⇧J' : 'Shift+J'})`}
        >
          <AlignJustify size={iconSize} />
        </ToolbarButton>

        <Divider />

        {/* Line spacing */}
        <select
          value={currentLineHeight}
          onChange={(e) => editor.chain().focus().setLineHeight(e.target.value).run()}
          title="Line spacing"
          className="h-7 w-14 px-1 text-xs bg-navy-800 border border-navy-700 rounded text-navy-200 outline-none focus:border-blue-500 cursor-pointer"
        >
          {LINE_SPACINGS.map((ls) => (
            <option key={ls.value} value={ls.value}>
              {ls.label}
            </option>
          ))}
        </select>

        <Divider />

        {/* Indent / Outdent */}
        <ToolbarButton
          onClick={() => editor.chain().focus().indent().run()}
          title="Indent (Tab)"
        >
          <Indent size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().outdent().run()}
          title="Outdent (⇧Tab)"
        >
          <Outdent size={iconSize} />
        </ToolbarButton>
      </div>
    </div>
  )
}
