import { useState, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Plus,
  ImageIcon,
  TableIcon,
  Minus,
  Code2,
  Smile,
  Link2,
} from 'lucide-react'
import ImageInsertDialog from './dialogs/ImageInsertDialog'
import TableInsertDialog from './dialogs/TableInsertDialog'
import LinkInsertDialog from './dialogs/LinkInsertDialog'
import EmojiPicker from './dialogs/EmojiPicker'

interface InsertMenuProps {
  editor: Editor | null
}

const ITEMS = [
  { id: 'image', label: 'Image', icon: ImageIcon },
  { id: 'table', label: 'Table', icon: TableIcon },
  { id: 'divider', label: 'Divider', icon: Minus },
  { id: 'codeblock', label: 'Code Block', icon: Code2 },
  { id: 'emoji', label: 'Emoji', icon: Smile },
  { id: 'link', label: 'Link', icon: Link2 },
] as const

type DialogId = (typeof ITEMS)[number]['id'] | null

export default function InsertMenu({ editor }: InsertMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogId>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  if (!editor) return null

  const handleClick = (id: DialogId) => {
    setMenuOpen(false)
    if (id === 'divider') {
      editor.chain().focus().setHorizontalRule().run()
      return
    }
    if (id === 'codeblock') {
      editor.chain().focus().toggleCodeBlock().run()
      return
    }
    setDialog(id)
  }

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-navy-200 hover:text-white hover:bg-navy-700 rounded transition-colors cursor-pointer"
        >
          <Plus size={16} />
          Insert
        </button>

        {menuOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-navy-800 border border-navy-600 rounded-lg shadow-xl py-1 w-48">
            {ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleClick(id)}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-navy-200 hover:bg-navy-700 hover:text-white transition-colors cursor-pointer"
              >
                <Icon size={16} className="text-navy-400" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {dialog === 'image' && (
        <ImageInsertDialog editor={editor} onClose={() => setDialog(null)} />
      )}
      {dialog === 'table' && (
        <TableInsertDialog editor={editor} onClose={() => setDialog(null)} />
      )}
      {dialog === 'link' && (
        <LinkInsertDialog editor={editor} onClose={() => setDialog(null)} />
      )}
      {dialog === 'emoji' && (
        <EmojiPicker editor={editor} onClose={() => setDialog(null)} />
      )}
    </>
  )
}
