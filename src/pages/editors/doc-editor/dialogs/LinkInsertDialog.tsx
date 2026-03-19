import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import DialogShell from './DialogShell'

interface Props {
  editor: Editor
  onClose: () => void
}

export default function LinkInsertDialog({ editor, onClose }: Props) {
  const existing = editor.getAttributes('link')
  const [url, setUrl] = useState(existing.href || '')
  const [text, setText] = useState('')
  const hasSelection = !editor.state.selection.empty

  const apply = () => {
    if (!url.trim()) return
    const href = url.startsWith('http') ? url : `https://${url}`
    if (hasSelection) {
      editor.chain().focus().setLink({ href }).run()
    } else if (text.trim()) {
      editor.chain().focus().insertContent(`<a href="${href}">${text}</a>`).run()
    } else {
      editor.chain().focus().insertContent(`<a href="${href}">${href}</a>`).run()
    }
    onClose()
  }

  return (
    <DialogShell title="Insert Link" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-navy-300 mb-1">URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full px-3 py-2 text-sm bg-navy-900 border border-navy-700 rounded-lg text-navy-100 outline-none focus:border-blue-500"
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            autoFocus
          />
        </div>
        {!hasSelection && (
          <div>
            <label className="block text-xs text-navy-300 mb-1">
              Display text <span className="text-navy-500">(optional)</span>
            </label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Link text"
              className="w-full px-3 py-2 text-sm bg-navy-900 border border-navy-700 rounded-lg text-navy-100 outline-none focus:border-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && apply()}
            />
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={apply}
            disabled={!url.trim()}
            className="flex-1 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {hasSelection ? 'Apply Link' : 'Insert Link'}
          </button>
          {existing.href && (
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().unsetLink().run()
                onClose()
              }}
              className="px-4 py-2 text-sm bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded-lg transition-colors cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </DialogShell>
  )
}
