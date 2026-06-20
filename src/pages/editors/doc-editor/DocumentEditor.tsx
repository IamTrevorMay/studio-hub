import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import {
  useEditorStore,
  getEffectivePageDimensions,
  getMarginsInPx,
} from './editorStore'
import Toolbar from './Toolbar'
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
import { ArrowLeft, MessageSquare, Settings } from 'lucide-react'

interface Props {
  editor: Editor
  title: string
  docId: string
  onBack: () => void
  onSaveTemplate: ((name: string, type: string, content: any) => void) | null
  onSave: () => void
  loaded: boolean
  reviewData?: any
  onSendForReview?: (htmlContent: string) => void
}

export default function DocumentEditor({
  editor,
  title,
  docId,
  onBack,
  onSaveTemplate,
  onSave,
  loaded,
  reviewData,
  onSendForReview,
}: Props) {
  const {
    zoom,
    pageSetup,
    authorName,
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

  // Auto-focus editor on load
  useEffect(() => {
    if (editor && loaded) {
      const t = setTimeout(() => editor.commands.focus('end'), 50)
      return () => clearTimeout(t) // don't focus a possibly-destroyed editor after unmount
    }
  }, [editor, loaded])

  const wordCount = editor?.storage.characterCount?.words() ?? 0
  const charCount = editor?.storage.characterCount?.characters() ?? 0

  // Compute page dimensions
  const pageDim = getEffectivePageDimensions(pageSetup)
  const marginsPx = getMarginsInPx(pageSetup.margins)
  const scale = zoom / 100

  const handleAddComment = useCallback(() => {
    if (!editor || editor.state.selection.empty) return

    const text = prompt('Add a comment:')
    if (!text?.trim()) return

    const threadId = crypto.randomUUID()
    const now = new Date().toISOString()

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

    setShowCommentPanel(true)
  }, [editor, authorName])

  // Hide comment panel in focus mode
  const commentsVisible = showCommentPanel && !focusMode

  // Count comment marks in the document
  const commentCount = (() => {
    if (!editor) return 0
    const ids = new Set<string>()
    editor.state.doc.descendants((node) => {
      node.marks.forEach((mark) => {
        if (mark.type.name === 'comment' && mark.attrs.commentId) {
          ids.add(mark.attrs.commentId)
        }
      })
    })
    return ids.size
  })()

  return (
    <div className="flex h-screen">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top nav bar + toolbar — collapses in focus mode */}
        <div
          className={`transition-all duration-200 overflow-hidden ${
            focusMode ? 'max-h-0 opacity-0' : 'max-h-40 opacity-100'
          }`}
        >
          <div className="flex items-center gap-1 px-4 py-1.5 bg-navy-900 border-b border-navy-800">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 px-2 py-1 text-xs rounded text-navy-400 hover:text-white hover:bg-navy-800 transition-colors cursor-pointer mr-2"
              title="Back"
            >
              <ArrowLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-white mr-4 truncate max-w-[300px]">{title}</span>
            <InsertMenu editor={editor} />
            <FormatMenu />
            <ExportMenu editor={editor} title={title} />

            {/* Settings gear */}
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs rounded text-navy-400 hover:text-white hover:bg-navy-800 transition-colors cursor-pointer"
              title="Settings"
            >
              <Settings size={14} />
            </button>

            {/* Save as template */}
            {onSaveTemplate && (
              <button
                type="button"
                onClick={() => {
                  const name = prompt('Template name:')
                  if (name && editor) onSaveTemplate(name, 'document', { html: editor.getHTML() })
                }}
                className="flex items-center gap-1.5 px-2 py-1 text-xs rounded text-navy-400 hover:text-white hover:bg-navy-800 transition-colors cursor-pointer"
                title="Save as template"
              >
                Template
              </button>
            )}

            {/* Send for Review */}
            {onSendForReview && (
              <button
                type="button"
                onClick={() => onSendForReview(editor.getHTML())}
                className="flex items-center gap-1.5 px-3 py-1 text-xs rounded font-bold transition-colors cursor-pointer"
                style={{ background: 'linear-gradient(135deg, #c5d600, #e8ff47)', color: '#0f0f1a' }}
                title="Send revision to reviewer"
              >
                Send for Review
              </button>
            )}

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
                {commentCount > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">
                    {commentCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <Toolbar editor={editor} onAddComment={handleAddComment} />
        </div>

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
            {editor && docId && (
              <CommentPanel
                editor={editor}
                documentId={docId}
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
