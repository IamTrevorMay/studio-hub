import { useState, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import DialogShell from './DialogShell'
import { Upload } from 'lucide-react'
import { supabase } from '../../../../supabaseClient'

interface Props {
  editor: Editor
  docId?: string
  onClose: () => void
}

export default function ImageInsertDialog({ editor, docId, onClose }: Props) {
  const [url, setUrl] = useState('')
  const [width, setWidth] = useState('100%')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const insertFromUrl = () => {
    if (!url.trim()) return
    editor.chain().focus().setImage({ src: url, width } as any).run()
    onClose()
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Try Supabase upload first, fall back to base64
    if (docId) {
      setUploading(true)
      // Derive ext safely — split('.').pop() returns the whole name when there's
      // no dot, producing paths like "{docId}/123.screenshot". Fall back to MIME.
      const dot = file.name.lastIndexOf('.')
      const ext = (dot > 0 ? file.name.slice(dot + 1) : (file.type.split('/')[1] || 'png')).toLowerCase()
      const filePath = `${docId}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('doc-images').upload(filePath, file)
      setUploading(false)

      if (!error) {
        const { data } = supabase.storage.from('doc-images').getPublicUrl(filePath)
        if (data?.publicUrl) {
          editor.chain().focus().setImage({ src: data.publicUrl, width } as any).run()
          onClose()
          return
        }
      }
    }

    // Fallback: base64
    const reader = new FileReader()
    reader.onload = () => {
      const src = reader.result as string
      editor.chain().focus().setImage({ src, width } as any).run()
      onClose()
    }
    reader.readAsDataURL(file)
  }

  return (
    <DialogShell title="Insert Image" onClose={onClose}>
      <div className="space-y-4">
        {/* URL input */}
        <div>
          <label className="block text-xs text-navy-300 mb-1">Image URL</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 px-3 py-2 text-sm bg-navy-900 border border-navy-700 rounded-lg text-navy-100 outline-none focus:border-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && insertFromUrl()}
            />
            <button
              type="button"
              onClick={insertFromUrl}
              disabled={!url.trim()}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              Insert
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-navy-500">
          <div className="flex-1 h-px bg-navy-700" />
          or
          <div className="flex-1 h-px bg-navy-700" />
        </div>

        {/* File upload */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-navy-600 rounded-lg text-sm text-navy-300 hover:border-blue-500 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
        >
          <Upload size={16} />
          {uploading ? 'Uploading...' : 'Upload from computer'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
        />

        {/* Width control */}
        <div>
          <label className="block text-xs text-navy-300 mb-1">Width</label>
          <select
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-navy-900 border border-navy-700 rounded-lg text-navy-200 outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="25%">25%</option>
            <option value="50%">50%</option>
            <option value="75%">75%</option>
            <option value="100%">100%</option>
            <option value="auto">Auto</option>
          </select>
        </div>
      </div>
    </DialogShell>
  )
}
