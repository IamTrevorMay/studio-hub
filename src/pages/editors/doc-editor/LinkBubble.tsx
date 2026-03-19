import { useState, useEffect, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { ExternalLink, Pencil, Unlink } from 'lucide-react'

interface Props {
  editor: Editor
}

export default function LinkBubble({ editor }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [href, setHref] = useState('')
  const [editing, setEditing] = useState(false)
  const [editUrl, setEditUrl] = useState('')

  const update = useCallback(() => {
    if (!editor.isActive('link')) {
      setPos(null)
      return
    }
    const attrs = editor.getAttributes('link')
    setHref(attrs.href || '')

    const { from } = editor.state.selection
    const coords = editor.view.coordsAtPos(from)
    const editorRect = editor.view.dom.closest('.overflow-auto')?.getBoundingClientRect()
    if (!editorRect) return

    setPos({
      top: coords.bottom - editorRect.top + 8,
      left: coords.left - editorRect.left,
    })
  }, [editor])

  useEffect(() => {
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor, update])

  if (!pos || !href) return null

  const saveEdit = () => {
    if (!editUrl.trim()) return
    const finalUrl = editUrl.startsWith('http') ? editUrl : `https://${editUrl}`
    editor.chain().focus().extendMarkRange('link').setLink({ href: finalUrl }).run()
    setEditing(false)
  }

  return (
    <div
      className="absolute z-50 flex items-center gap-1 px-2 py-1.5 bg-navy-800 border border-navy-600 rounded-lg shadow-xl text-xs"
      style={{ top: pos.top, left: pos.left }}
    >
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveEdit()
          }}
          className="flex items-center gap-1"
        >
          <input
            type="text"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            className="px-2 py-1 w-48 bg-navy-900 border border-navy-700 rounded text-navy-100 outline-none focus:border-blue-500 text-xs"
            autoFocus
          />
          <button
            type="submit"
            className="px-2 py-1 bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-500"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-2 py-1 text-navy-400 hover:text-white cursor-pointer"
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 max-w-[200px] truncate"
          >
            {href}
          </a>
          <button
            type="button"
            onClick={() => window.open(href, '_blank')}
            className="p-1 text-navy-400 hover:text-white rounded cursor-pointer"
            title="Open link"
          >
            <ExternalLink size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              setEditUrl(href)
              setEditing(true)
            }}
            className="p-1 text-navy-400 hover:text-white rounded cursor-pointer"
            title="Edit link"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().unsetLink().run()
              setPos(null)
            }}
            className="p-1 text-navy-400 hover:text-red-400 rounded cursor-pointer"
            title="Remove link"
          >
            <Unlink size={13} />
          </button>
        </>
      )}
    </div>
  )
}
