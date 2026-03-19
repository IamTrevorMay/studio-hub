import type { Editor } from '@tiptap/react'
import {
  Plus,
  Minus,
  Trash2,
  ArrowDown,
  ArrowRight,
} from 'lucide-react'

interface Props {
  editor: Editor
}

export default function TableControls({ editor }: Props) {
  if (!editor.isActive('table')) return null

  const btn =
    'p-1 rounded text-navy-400 hover:text-white hover:bg-navy-700 transition-colors cursor-pointer'

  return (
    <div className="flex items-center gap-0.5 px-3 py-1 bg-navy-800/80 border border-navy-700 rounded-lg text-xs">
      <span className="text-navy-500 mr-1 text-[11px]">Table:</span>

      <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()} className={btn} title="Add row below">
        <ArrowDown size={14} />
      </button>
      <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()} className={btn} title="Add column right">
        <ArrowRight size={14} />
      </button>

      <div className="w-px h-4 bg-navy-700 mx-1" />

      <button type="button" onClick={() => editor.chain().focus().deleteRow().run()} className={`${btn} hover:text-red-400`} title="Delete row">
        <Minus size={14} />
      </button>
      <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()} className={`${btn} hover:text-red-400`} title="Delete column">
        <Minus size={14} className="rotate-90" />
      </button>

      <div className="w-px h-4 bg-navy-700 mx-1" />

      <button type="button" onClick={() => editor.chain().focus().deleteTable().run()} className={`${btn} hover:text-red-400`} title="Delete table">
        <Trash2 size={14} />
      </button>
    </div>
  )
}
