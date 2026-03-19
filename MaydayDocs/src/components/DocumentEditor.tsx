import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { editorExtensions } from '../editor/extensions'
import {
  useEditorStore,
  getEffectivePageDimensions,
  getMarginsInPx,
} from '../store/editorStore'
import { useAutoSave } from '../hooks/useAutoSave'
import Toolbar from './Toolbar'
import Sidebar from './Sidebar'
import InsertMenu from './InsertMenu'
import FormatMenu from './FormatMenu'
import LinkBubble from './LinkBubble'
import TableControls from './TableControls'
import EditorContextMenu from './EditorContextMenu'
import ZoomControl from './ZoomControl'
import FindReplace from './FindReplace'
import CommentPanel from './CommentPanel'
import ExportMenu from './ExportMenu'
import CommandPalette from './CommandPalette'
import SettingsModal from './dialogs/SettingsModal'
import { FileText, MessageSquare, Settings } from 'lucide-react'

export default function DocumentEditor() {
  const {
    documents,
    activeDocumentId,
    updateTitle,
    zoom,
    pageSetup,
    authorName,
    addCommentThread,
    focusMode,
    toggleFocusMode,
  } = useEditorStore()

  const canvasRef = useRef<HTMLDivElement>(null)
  const [showFindReplace, setShowFindReplace] = useState(false)
  const [showCommentPanel, setShowCommentPanel] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Consolidated keyboard shortcut handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      if (e.key === 'f') {
        e.preventDefault()
        setShowFindReplace(true)
      } else if (e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette((v) => !v)
      } else if (e.key === '.') {
        e.preventDefault()
        toggleFocusMode()
      } else if (e.key === ',') {
        e.preventDefault()
        setShowSettings((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleFocusMode])

  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocumentId) ?? null,
    [documents, activeDocumentId]
  )

  const editor = useEditor({
    extensions: editorExtensions,
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'tiptap prose-editor',
      },
    },
  })

  // Load document content when switching docs
  useEffect(() => {
    if (!editor || !activeDoc) return
    const currentJSON = JSON.stringify(editor.getJSON())
    const targetJSON = JSON.stringify(activeDoc.content)
    if (currentJSON !== targetJSON) {
      editor.commands.setContent(activeDoc.content)
    }
  }, [editor, activeDoc?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus editor on load and doc switch
  useEffect(() => {
    if (editor && activeDoc) {
      setTimeout(() => editor.commands.focus('end'), 50)
    }
  }, [editor, activeDoc?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useAutoSave(editor, activeDocumentId)

  const wordCount = editor?.storage.characterCount.words() ?? 0
  const charCount = editor?.storage.characterCount.characters() ?? 0

  // Compute page dimensions
  const pageDim = getEffectivePageDimensions(pageSetup)
  const marginsPx = getMarginsInPx(pageSetup.margins)
  const scale = zoom / 100

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (activeDocumentId) {
        updateTitle(activeDocumentId, e.target.value)
      }
    },
    [activeDocumentId, updateTitle]
  )

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        editor?.commands.focus('start')
      }
    },
    [editor]
  )

  const handleAddComment = useCallback(() => {
    if (!editor || !activeDocumentId || editor.state.selection.empty) return

    const text = prompt('Add a comment:')
    if (!text?.trim()) return

    const threadId = crypto.randomUUID()
    const now = new Date().toISOString()

    // Apply the comment mark to the selected text
    editor
      .chain()
      .focus()
      .setMark('comment', {
        commentId: threadId,
        author: authorName,
        text: text.trim(),
        createdAt: now,
      })
      .run()

    // Add the thread to the store
    addCommentThread(activeDocumentId, {
      id: threadId,
      comments: [
        {
          id: crypto.randomUUID(),
          author: authorName,
          text: text.trim(),
          createdAt: now,
        },
      ],
      resolved: false,
      createdAt: now,
    })

    setShowCommentPanel(true)
  }, [editor, activeDocumentId, authorName, addCommentThread])

  // Hide comment panel in focus mode
  const commentsVisible = showCommentPanel && !focusMode

  return (
    <div className="flex h-screen">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top nav bar + toolbar — collapses in focus mode */}
        <div
          className={`transition-all duration-200 overflow-hidden ${
            focusMode ? 'max-h-0 opacity-0' : 'max-h-40 opacity-100'
          }`}
        >
          <div className="flex items-center gap-1 px-4 py-1.5 bg-navy-900 border-b border-navy-800">
            <FileText size={16} className="text-blue-400 mr-1" />
            <span className="text-sm font-semibold text-white mr-4">MaydayDocs</span>
            <InsertMenu editor={editor} />
            <FormatMenu />
            <ExportMenu editor={editor} title={activeDoc?.title ?? 'Untitled'} />

            {/* Settings gear */}
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs rounded text-navy-400 hover:text-white hover:bg-navy-800 transition-colors cursor-pointer"
              title="Settings"
            >
              <Settings size={14} />
            </button>

            <div className="ml-auto">
              <button
                type="button"
                onClick={() => setShowCommentPanel(!showCommentPanel)}
                className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors cursor-pointer ${
                  showCommentPanel
                    ? 'bg-navy-700 text-white'
                    : 'text-navy-400 hover:text-white hover:bg-navy-800'
                }`}
                title="Toggle comments"
              >
                <MessageSquare size={14} />
                Comments
                {activeDoc && activeDoc.comments?.filter((t) => !t.resolved).length > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">
                    {activeDoc.comments.filter((t) => !t.resolved).length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <Toolbar editor={editor} onAddComment={handleAddComment} />
        </div>

        {activeDoc ? (
          <>
            {/* Canvas + Comment panel row */}
            <div className="flex-1 flex min-h-0">
              {/* Canvas area */}
              <div ref={canvasRef} className="relative flex-1 overflow-auto bg-navy-950 py-10 px-4">
                {/* Table controls float above canvas */}
                {editor?.isActive('table') && (
                  <div className="sticky top-2 z-40 flex justify-center mb-2">
                    <TableControls editor={editor} />
                  </div>
                )}

                {/* Zoom wrapper */}
                <div
                  className="mx-auto transition-transform duration-150"
                  style={{
                    width: pageDim.width,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top center',
                  }}
                >
                  {/* Page canvas — used for both screen and print */}
                  <div
                    className="page-canvas bg-white rounded shadow-lg shadow-black/30"
                    style={{
                      width: pageDim.width,
                      minHeight: pageDim.height,
                      paddingTop: marginsPx.top,
                      paddingRight: marginsPx.right,
                      paddingBottom: marginsPx.bottom,
                      paddingLeft: marginsPx.left,
                    }}
                  >
                    {/* Title */}
                    <input
                      type="text"
                      value={activeDoc.title}
                      onChange={handleTitleChange}
                      onKeyDown={handleTitleKeyDown}
                      placeholder="Untitled document"
                      className="w-full text-3xl font-bold text-gray-900 bg-transparent border-none outline-none placeholder-gray-300 mb-4 print-title"
                    />

                    {/* Editor body */}
                    <EditorContent editor={editor} />
                  </div>

                  {/* Page break indicator */}
                  {pageSetup.showPageBreaks && (
                    <div className="page-break-indicator" style={{ marginTop: 0 }}>
                      <div className="flex items-center gap-3 py-3">
                        <div className="flex-1 border-t-2 border-dashed border-navy-700" />
                        <span className="text-[10px] text-navy-600 select-none whitespace-nowrap">Page break</span>
                        <div className="flex-1 border-t-2 border-dashed border-navy-700" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Reserve space below for zoomed content */}
                {scale !== 1 && (
                  <div style={{ height: Math.max(0, pageDim.height * (scale - 1)) }} />
                )}

                {/* Find & Replace panel */}
                {editor && showFindReplace && (
                  <FindReplace editor={editor} onClose={() => setShowFindReplace(false)} />
                )}
                {/* Link bubble popover */}
                {editor && <LinkBubble editor={editor} />}
                {/* Right-click context menu */}
                {editor && <EditorContextMenu editor={editor} containerRef={canvasRef} onAddComment={handleAddComment} />}
              </div>

              {/* Comment panel — slide transition */}
              <div
                className={`transition-all duration-200 ease-out overflow-hidden flex-shrink-0 ${
                  commentsVisible ? 'w-80 opacity-100' : 'w-0 opacity-0'
                }`}
              >
                {editor && activeDocumentId && (
                  <CommentPanel
                    editor={editor}
                    documentId={activeDocumentId}
                    onClose={() => setShowCommentPanel(false)}
                  />
                )}
              </div>
            </div>

            {/* Footer status bar — collapses in focus mode */}
            <div
              className={`transition-all duration-200 overflow-hidden ${
                focusMode ? 'max-h-0 opacity-0' : 'max-h-12 opacity-100'
              }`}
            >
              <div className="flex items-center justify-between px-6 py-2 bg-navy-900 border-t border-navy-700 text-xs text-navy-400">
                <div className="flex items-center gap-4">
                  <span>
                    {wordCount} {wordCount === 1 ? 'word' : 'words'}
                  </span>
                  <span>
                    {charCount} {charCount === 1 ? 'character' : 'characters'}
                  </span>
                </div>
                <ZoomControl />
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-navy-950">
            <div className="text-center space-y-3">
              <p className="text-navy-400 text-sm">No document selected</p>
              <button
                type="button"
                onClick={() => useEditorStore.getState().createDocument()}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors cursor-pointer"
              >
                Create a document
              </button>
            </div>
          </div>
        )}

        {/* Focus mode exit button */}
        {focusMode && (
          <button
            type="button"
            onClick={toggleFocusMode}
            className="fixed bottom-6 right-6 z-50 px-3 py-1.5 text-xs rounded-lg bg-navy-800 border border-navy-700 text-navy-400 opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
          >
            Exit Focus Mode
          </button>
        )}
      </div>

      {/* Command Palette */}
      {showCommandPalette && (
        <CommandPalette
          editor={editor}
          onClose={() => setShowCommandPalette(false)}
          onOpenSettings={() => setShowSettings(true)}
          onToggleFindReplace={() => setShowFindReplace((v) => !v)}
          onToggleComments={() => setShowCommentPanel((v) => !v)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}
