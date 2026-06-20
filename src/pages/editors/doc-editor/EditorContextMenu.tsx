import { useState, useEffect, useRef, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Copy,
  Scissors,
  Clipboard,
  Trash2,
  Link2,
  ImageIcon,
  TableIcon,
  MessageSquarePlus,
} from 'lucide-react'

interface Props {
  editor: Editor
  containerRef: React.RefObject<HTMLDivElement | null>
  onAddComment?: () => void
}

interface MenuPos {
  top: number
  left: number
}

export default function EditorContextMenu({ editor, containerRef, onAddComment }: Props) {
  const [pos, setPos] = useState<MenuPos | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setPos(null), [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      setPos({
        top: e.clientY - rect.top,
        left: e.clientX - rect.left,
      })
    }

    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close()
    }

    el.addEventListener('contextmenu', onContext)
    document.addEventListener('mousedown', onClick)
    return () => {
      el.removeEventListener('contextmenu', onContext)
      document.removeEventListener('mousedown', onClick)
    }
  }, [containerRef, close])

  if (!pos) return null

  const items = [
    {
      label: 'Cut', icon: Scissors,
      action: () => { document.execCommand('cut') },
      show: !editor.state.selection.empty,
    },
    {
      label: 'Copy', icon: Copy,
      action: () => { document.execCommand('copy') },
      show: !editor.state.selection.empty,
    },
    {
      label: 'Paste', icon: Clipboard,
      action: () => { navigator.clipboard.readText().then((text) => { editor.chain().focus().insertContent(text).run() }) },
      show: true,
    },
    { label: 'divider', icon: null, action: () => {}, show: true },
    {
      label: 'Delete', icon: Trash2,
      action: () => { editor.chain().focus().deleteSelection().run() },
      show: !editor.state.selection.empty,
    },
    {
      label: 'Add Comment', icon: MessageSquarePlus,
      action: () => { onAddComment?.() },
      show: !editor.state.selection.empty,
    },
    { label: 'divider2', icon: null, action: () => {}, show: true },
    {
      label: editor.isActive('link') ? 'Edit Link' : 'Insert Link', icon: Link2,
      action: () => {
        const url = prompt('Enter URL:')
        if (url) {
          const href = url.startsWith('http') ? url : `https://${url}`
          // Reject javascript:/data: etc. (the http prefix only normalizes bare hosts).
          if (!/^(https?:|mailto:)/i.test(href)) { alert('Invalid URL'); return }
          editor.chain().focus().setLink({ href }).run()
        }
      },
      show: true,
    },
    {
      label: 'Insert Image', icon: ImageIcon,
      action: () => {
        const url = prompt('Image URL:')
        if (!url) return
        if (!/^https?:\/\//i.test(url)) { alert('Image URL must start with http(s)'); return }
        editor.chain().focus().setImage({ src: url }).run()
      },
      show: true,
    },
    {
      label: 'Insert Table', icon: TableIcon,
      action: () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      show: !editor.isActive('table'),
    },
    {
      label: 'Delete Table', icon: Trash2,
      action: () => { editor.chain().focus().deleteTable().run() },
      show: editor.isActive('table'),
    },
  ]

  const visible = items.filter((i) => i.show)

  return (
    <div
      ref={menuRef}
      className="absolute z-[90] bg-navy-800 border border-navy-600 rounded-lg shadow-xl py-1 min-w-[180px]"
      style={{ top: pos.top, left: pos.left }}
    >
      {visible.map((item) =>
        item.label.startsWith('divider') ? (
          <div key={item.label} className="h-px bg-navy-700 my-1" />
        ) : (
          <button
            key={item.label}
            type="button"
            onClick={() => { item.action(); close() }}
            className="w-full flex items-center gap-3 px-4 py-1.5 text-xs text-navy-200 hover:bg-navy-700 hover:text-white transition-colors cursor-pointer"
          >
            {item.icon && <item.icon size={14} className="text-navy-400" />}
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
