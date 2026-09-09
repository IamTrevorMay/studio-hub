import { useState } from 'react'
import { FilePlus2, FileText, Pencil, Trash2, X } from 'lucide-react'

export interface ResearchTemplate {
  id: string
  name: string
  description: string | null
  content: { html?: string } | null
  position: number
}

interface Props {
  templates: ResearchTemplate[]
  loading: boolean
  // Admins get the rename / delete / save-current controls; everyone can pick.
  canManage: boolean
  // Set when the doc already has content — picking a template then replaces it,
  // so the confirm copy has to say so.
  replacing: boolean
  onPick: (template: ResearchTemplate | null) => void
  onSaveCurrentAsTemplate: () => void
  onRename: (template: ResearchTemplate) => void
  onDelete: (template: ResearchTemplate) => void
  onClose: () => void
}

export default function TemplateGallery({
  templates,
  loading,
  canManage,
  replacing,
  onPick,
  onSaveCurrentAsTemplate,
  onRename,
  onDelete,
  onClose,
}: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const choose = (tpl: ResearchTemplate | null) => {
    // Only the destructive case needs a second click: a blank doc has nothing
    // to lose, so "Blank" and first-time picks apply immediately.
    if (replacing && confirmId !== (tpl?.id ?? 'blank')) {
      setConfirmId(tpl?.id ?? 'blank')
      return
    }
    onPick(tpl)
  }

  return (
    <div
      className="absolute inset-0 z-50 bg-navy-950/95 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-semibold text-white">Start a research document</h2>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="h-7 w-7 flex items-center justify-center rounded text-navy-400 hover:text-white hover:bg-navy-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-[13px] text-navy-400 mb-6">
          {replacing
            ? 'Applying a template replaces everything currently in this document.'
            : 'Pick a template to start from, or begin with a blank page.'}
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {/* Blank */}
          <button
            type="button"
            onClick={() => choose(null)}
            className={`group flex flex-col items-start gap-2 p-4 h-36 rounded-xl border text-left transition-colors cursor-pointer ${
              confirmId === 'blank'
                ? 'border-red-400 bg-red-500/10'
                : 'border-navy-700 bg-navy-900 hover:border-blue-500 hover:bg-navy-800'
            }`}
          >
            <FilePlus2 size={20} className="text-navy-400 group-hover:text-blue-300" />
            <span className="text-[13px] font-semibold text-white">Blank</span>
            <span className="text-[11px] leading-snug text-navy-400">
              {confirmId === 'blank' ? 'Click again to clear this document' : 'Start from scratch.'}
            </span>
          </button>

          {loading && (
            <div className="col-span-2 sm:col-span-3 text-[13px] text-navy-400 py-4">
              Loading templates…
            </div>
          )}

          {!loading && templates.map((tpl) => (
            <div
              key={tpl.id}
              className={`group relative flex flex-col items-start gap-2 p-4 h-36 rounded-xl border transition-colors ${
                confirmId === tpl.id
                  ? 'border-red-400 bg-red-500/10'
                  : 'border-navy-700 bg-navy-900 hover:border-blue-500 hover:bg-navy-800'
              }`}
            >
              <button
                type="button"
                onClick={() => choose(tpl)}
                className="absolute inset-0 rounded-xl cursor-pointer"
                title={`Use ${tpl.name}`}
              />
              <FileText size={20} className="text-navy-400 group-hover:text-blue-300 pointer-events-none" />
              <span className="text-[13px] font-semibold text-white pointer-events-none line-clamp-2">
                {tpl.name}
              </span>
              <span className="text-[11px] leading-snug text-navy-400 pointer-events-none line-clamp-3">
                {confirmId === tpl.id
                  ? 'Click again to replace this document'
                  : tpl.description || 'No description.'}
              </span>

              {canManage && (
                <div className="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => onRename(tpl)}
                    title="Rename template"
                    className="h-6 w-6 flex items-center justify-center rounded bg-navy-800 text-navy-300 hover:text-white cursor-pointer"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(tpl)}
                    title="Delete template"
                    className="h-6 w-6 flex items-center justify-center rounded bg-navy-800 text-navy-300 hover:text-red-300 cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {canManage && (
          <button
            type="button"
            onClick={onSaveCurrentAsTemplate}
            className="mt-6 px-3 py-1.5 text-[13px] rounded-lg bg-navy-800 border border-navy-600 text-navy-200 hover:text-white hover:border-blue-500 transition-colors cursor-pointer"
          >
            Save this document as a template
          </button>
        )}
      </div>
    </div>
  )
}
