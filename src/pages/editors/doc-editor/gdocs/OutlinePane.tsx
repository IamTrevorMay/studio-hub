import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { ArrowLeft, PanelLeftOpen, Plus } from 'lucide-react'

// Google Docs' left rail: a Summary blurb over a live outline of the document's
// headings. The outline is derived from the doc on every transaction rather
// than stored, so it can never drift from the actual headings.

interface Heading {
  level: number
  text: string
  pos: number
}

function readHeadings(editor: Editor): Heading[] {
  const out: Heading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    const text = node.textContent.trim()
    out.push({ level: node.attrs.level || 1, text, pos })
  })
  return out
}

interface Props {
  editor: Editor
  summary: string
  onSummaryChange: (value: string) => void
  onClose: () => void
}

export default function OutlinePane({ editor, summary, onSummaryChange, onClose }: Props) {
  const [headings, setHeadings] = useState<Heading[]>(() => readHeadings(editor))
  const [editingSummary, setEditingSummary] = useState(false)
  const [draft, setDraft] = useState(summary)
  const [activePos, setActivePos] = useState<number | null>(null)

  useEffect(() => { setDraft(summary) }, [summary])

  useEffect(() => {
    const refresh = () => setHeadings(readHeadings(editor))
    const trackCursor = () => {
      const from = editor.state.selection.from
      let current: number | null = null
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && pos <= from) current = pos
      })
      setActivePos(current)
    }
    editor.on('update', refresh)
    editor.on('selectionUpdate', trackCursor)
    return () => {
      editor.off('update', refresh)
      editor.off('selectionUpdate', trackCursor)
    }
  }, [editor])

  const jumpTo = (pos: number) => {
    editor.chain().focus().setTextSelection(pos + 1).run()
    const dom = editor.view.domAtPos(pos + 1).node as HTMLElement | Text
    const el = dom instanceof HTMLElement ? dom : dom.parentElement
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const commitSummary = () => {
    setEditingSummary(false)
    if (draft !== summary) onSummaryChange(draft)
  }

  return (
    <div className="w-60 flex-shrink-0 border-r border-navy-700 bg-navy-900 overflow-y-auto px-4 py-4">
      <button
        type="button"
        onClick={onClose}
        title="Hide outline"
        className="mb-4 h-7 w-7 flex items-center justify-center rounded text-navy-400 hover:text-white hover:bg-navy-800 transition-colors cursor-pointer"
      >
        <ArrowLeft size={16} />
      </button>

      {/* ── Summary ── */}
      <div className="flex items-center justify-between border-b border-navy-700 pb-1.5 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-navy-400">Summary</span>
        <button
          type="button"
          onClick={() => setEditingSummary(true)}
          title={summary ? 'Edit summary' : 'Add summary'}
          className="h-5 w-5 flex items-center justify-center rounded text-navy-400 hover:text-white hover:bg-navy-800 transition-colors cursor-pointer"
        >
          <Plus size={14} />
        </button>
      </div>

      {editingSummary ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitSummary}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setDraft(summary); setEditingSummary(false) }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitSummary()
          }}
          placeholder="What is this research for?"
          rows={4}
          className="w-full mb-5 px-2 py-1.5 text-[12px] leading-relaxed bg-navy-950 border border-navy-600 rounded text-navy-100 outline-none focus:border-blue-500 resize-y"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingSummary(true)}
          className="w-full text-left mb-5 text-[12px] leading-relaxed text-navy-300 hover:text-navy-100 cursor-pointer"
        >
          {summary || <span className="text-navy-500">Add a summary</span>}
        </button>
      )}

      {/* ── Outline ── */}
      <div className="border-b border-navy-700 pb-1.5 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-navy-400">Outline</span>
      </div>

      {headings.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-navy-500">
          Headings that you add to the document will appear here.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {headings.map((h) => (
            <button
              key={h.pos}
              type="button"
              onClick={() => jumpTo(h.pos)}
              style={{ paddingLeft: 6 + (h.level - 1) * 12 }}
              className={`text-left text-[12px] py-1 pr-2 rounded truncate transition-colors cursor-pointer ${
                activePos === h.pos
                  ? 'bg-blue-500/15 text-blue-200'
                  : 'text-navy-300 hover:bg-navy-800 hover:text-white'
              }`}
            >
              {h.text || <span className="text-navy-500 italic">Untitled heading</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Collapsed state: a thin strip with the show-outline affordance, so the rail
// can be reopened without hunting through the View menu.
export function OutlineRailStub({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="w-10 flex-shrink-0 border-r border-navy-700 bg-navy-900 flex justify-center pt-4">
      <button
        type="button"
        onClick={onOpen}
        title="Show outline"
        className="h-7 w-7 flex items-center justify-center rounded text-navy-400 hover:text-white hover:bg-navy-800 transition-colors cursor-pointer"
      >
        <PanelLeftOpen size={16} />
      </button>
    </div>
  )
}
