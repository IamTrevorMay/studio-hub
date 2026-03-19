import { useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { FilePlus, FileText, Trash2, PanelLeftClose, PanelLeft } from 'lucide-react'

export default function Sidebar() {
  const {
    documents,
    activeDocumentId,
    isSidebarOpen,
    focusMode,
    createDocument,
    deleteDocument,
    setActiveDocument,
    toggleSidebar,
  } = useEditorStore()

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const isOpen = isSidebarOpen && !focusMode

  return (
    <>
      {/* Floating open button — visible when sidebar is closed */}
      <button
        type="button"
        onClick={toggleSidebar}
        className={`fixed top-3 left-3 z-10 p-2 rounded-lg bg-navy-800 border border-navy-700 text-navy-300 hover:text-white hover:bg-navy-700 transition-all duration-200 cursor-pointer ${
          isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        title="Open sidebar"
      >
        <PanelLeft size={18} />
      </button>

      <aside
        className={`flex-shrink-0 bg-navy-900 border-r border-navy-700 flex flex-col h-screen transition-all duration-200 ease-out overflow-hidden ${
          isOpen ? 'w-64 opacity-100' : 'w-0 border-r-0 opacity-0'
        }`}
      >
        {/* Inner wrapper — fixed width to prevent content reflow */}
        <div className="w-64 min-w-[16rem] flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-navy-700">
            <span className="text-sm font-semibold text-navy-200">Documents</span>
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-1 rounded text-navy-400 hover:text-white hover:bg-navy-700 transition-colors cursor-pointer"
              title="Close sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

          {/* New document button */}
          <div className="px-3 py-3">
            <button
              type="button"
              onClick={createDocument}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              <FilePlus size={16} />
              New Document
            </button>
          </div>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {documents.length === 0 && (
              <p className="text-navy-500 text-xs text-center mt-8 px-4">
                No documents yet. Create one to get started.
              </p>
            )}
            {documents.map((doc) => {
              const isActive = doc.id === activeDocumentId
              const isConfirmingDelete = deleteConfirmId === doc.id
              const date = new Date(doc.updatedAt)
              const dateStr = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })

              return (
                <div
                  key={doc.id}
                  className={`group relative rounded-lg mb-0.5 transition-colors ${
                    isActive
                      ? 'bg-navy-700'
                      : 'hover:bg-navy-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveDocument(doc.id)}
                    className="w-full text-left px-3 py-2.5 cursor-pointer"
                  >
                    <div className="flex items-start gap-2.5">
                      <FileText
                        size={15}
                        className={`mt-0.5 flex-shrink-0 ${
                          isActive ? 'text-blue-400' : 'text-navy-500'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm truncate ${
                            isActive ? 'text-white font-medium' : 'text-navy-200'
                          }`}
                        >
                          {doc.title || 'Untitled'}
                        </p>
                        <p className="text-xs text-navy-500 mt-0.5">
                          {dateStr} &middot; {doc.wordCount} {doc.wordCount === 1 ? 'word' : 'words'}
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Delete button */}
                  {!isConfirmingDelete && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteConfirmId(doc.id)
                      }}
                      className="absolute top-2.5 right-2 p-1 rounded opacity-0 group-hover:opacity-100 text-navy-500 hover:text-red-400 hover:bg-navy-700 transition-all cursor-pointer"
                      title="Delete document"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}

                  {/* Delete confirmation */}
                  {isConfirmingDelete && (
                    <div className="px-3 pb-2 flex items-center gap-2">
                      <span className="text-xs text-red-400">Delete?</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteDocument(doc.id)
                          setDeleteConfirmId(null)
                        }}
                        className="text-xs px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteConfirmId(null)
                        }}
                        className="text-xs px-2 py-0.5 rounded bg-navy-700 hover:bg-navy-600 text-navy-300 transition-colors cursor-pointer"
                      >
                        No
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </aside>
    </>
  )
}
