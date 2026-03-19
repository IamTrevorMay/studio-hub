import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import DialogShell from './DialogShell'

interface Props {
  editor: Editor
  onClose: () => void
}

export default function TableInsertDialog({ editor, onClose }: Props) {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)

  const insert = () => {
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run()
    onClose()
  }

  return (
    <DialogShell title="Insert Table" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-xs text-navy-300 mb-1">Rows</label>
            <input
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(20, +e.target.value)))}
              className="w-full px-3 py-2 text-sm bg-navy-900 border border-navy-700 rounded-lg text-navy-100 outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-navy-300 mb-1">Columns</label>
            <input
              type="number"
              min={1}
              max={10}
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(10, +e.target.value)))}
              className="w-full px-3 py-2 text-sm bg-navy-900 border border-navy-700 rounded-lg text-navy-100 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Preview grid */}
        <div className="flex justify-center">
          <div
            className="inline-grid gap-px bg-navy-600 rounded overflow-hidden"
            style={{ gridTemplateColumns: `repeat(${cols}, 28px)` }}
          >
            {Array.from({ length: rows * cols }).map((_, i) => (
              <div
                key={i}
                className={`w-7 h-5 ${i < cols ? 'bg-navy-500' : 'bg-navy-700'}`}
              />
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={insert}
          className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer"
        >
          Insert {rows} x {cols} Table
        </button>
      </div>
    </DialogShell>
  )
}
