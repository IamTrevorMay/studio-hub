import { useState, useRef, useEffect, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorStore } from '../store/editorStore'
import type { CommentThread } from '../store/editorStore'
import {
  X,
  MessageSquare,
  CheckCircle2,
  Trash2,
  CornerDownRight,
  Eye,
  EyeOff,
  Settings2,
} from 'lucide-react'

interface Props {
  editor: Editor
  documentId: string
  onClose: () => void
}

export default function CommentPanel({ editor, documentId, onClose }: Props) {
  const {
    documents,
    authorName,
    setAuthorName,
    addReply,
    resolveThread,
    unresolveThread,
    deleteThread,
  } = useEditorStore()

  const [showResolved, setShowResolved] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(authorName)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const replyRef = useRef<HTMLTextAreaElement>(null)

  const doc = documents.find((d) => d.id === documentId)
  const threads = doc?.comments ?? []

  const visibleThreads = showResolved
    ? threads
    : threads.filter((t) => !t.resolved)

  useEffect(() => {
    if (replyingTo && replyRef.current) {
      replyRef.current.focus()
    }
  }, [replyingTo])

  const handleReply = useCallback(
    (threadId: string) => {
      if (!replyText.trim()) return
      addReply(documentId, threadId, {
        id: crypto.randomUUID(),
        author: authorName,
        text: replyText.trim(),
        createdAt: new Date().toISOString(),
      })
      setReplyText('')
      setReplyingTo(null)
    },
    [documentId, authorName, replyText, addReply]
  )

  const handleResolve = useCallback(
    (thread: CommentThread) => {
      if (thread.resolved) {
        unresolveThread(documentId, thread.id)
      } else {
        resolveThread(documentId, thread.id)
      }
    },
    [documentId, resolveThread, unresolveThread]
  )

  const handleDelete = useCallback(
    (threadId: string) => {
      deleteThread(documentId, threadId)
      // Remove the comment mark from the editor
      const { doc } = editor.state
      let found = false
      doc.descendants((node, pos) => {
        if (found) return false
        node.marks.forEach((mark) => {
          if (mark.type.name === 'comment' && mark.attrs.commentId === threadId) {
            editor
              .chain()
              .setTextSelection({ from: pos, to: pos + node.nodeSize })
              .unsetMark('comment')
              .run()
            found = true
          }
        })
      })
    },
    [documentId, deleteThread, editor]
  )

  const scrollToComment = useCallback(
    (threadId: string) => {
      const { doc } = editor.state
      doc.descendants((node, pos) => {
        node.marks.forEach((mark) => {
          if (mark.type.name === 'comment' && mark.attrs.commentId === threadId) {
            editor.chain().setTextSelection(pos).scrollIntoView().run()
          }
        })
      })
    },
    [editor]
  )

  const saveName = () => {
    if (nameInput.trim()) {
      setAuthorName(nameInput.trim())
    }
    setEditingName(false)
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const resolvedCount = threads.filter((t) => t.resolved).length

  return (
    <div className="w-80 bg-navy-900 border-l border-navy-700 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-navy-700">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-blue-400" />
          <span className="text-sm font-semibold text-white">
            Comments ({threads.length})
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-navy-400 hover:text-white rounded cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Author name / settings */}
      <div className="px-4 py-2 border-b border-navy-800 flex items-center gap-2">
        {editingName ? (
          <div className="flex items-center gap-1.5 flex-1">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') setEditingName(false)
              }}
              className="flex-1 min-w-0 px-2 py-1 text-xs bg-navy-800 border border-navy-600 rounded text-navy-100 outline-none focus:border-blue-500"
              autoFocus
            />
            <button
              type="button"
              onClick={saveName}
              className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
            >
              Save
            </button>
          </div>
        ) : (
          <>
            <span className="text-xs text-navy-400">Commenting as</span>
            <span className="text-xs text-navy-200 font-medium">{authorName}</span>
            <button
              type="button"
              onClick={() => {
                setNameInput(authorName)
                setEditingName(true)
              }}
              className="p-0.5 text-navy-500 hover:text-navy-300 cursor-pointer"
              title="Edit name"
            >
              <Settings2 size={12} />
            </button>
          </>
        )}
      </div>

      {/* Show resolved toggle */}
      {resolvedCount > 0 && (
        <div className="px-4 py-2 border-b border-navy-800">
          <button
            type="button"
            onClick={() => setShowResolved(!showResolved)}
            className="flex items-center gap-1.5 text-xs text-navy-400 hover:text-navy-200 cursor-pointer"
          >
            {showResolved ? <EyeOff size={13} /> : <Eye size={13} />}
            {showResolved ? 'Hide' : 'Show'} {resolvedCount} resolved
          </button>
        </div>
      )}

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {visibleThreads.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-navy-500">
            {threads.length === 0
              ? 'No comments yet. Select text and click the comment button to add one.'
              : 'All comments resolved.'}
          </div>
        ) : (
          <div className="divide-y divide-navy-800">
            {visibleThreads.map((thread) => (
              <div
                key={thread.id}
                className={`px-4 py-3 ${thread.resolved ? 'opacity-60' : ''}`}
              >
                {/* Thread comments */}
                {thread.comments.map((comment, idx) => (
                  <div key={comment.id} className={idx > 0 ? 'mt-2 pl-3 border-l-2 border-navy-700' : ''}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-navy-200">
                        {comment.author}
                      </span>
                      <span className="text-[10px] text-navy-500">
                        {formatTime(comment.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-navy-300 leading-relaxed">
                      {comment.text}
                    </p>
                  </div>
                ))}

                {/* Thread actions */}
                <div className="flex items-center gap-1 mt-2">
                  <button
                    type="button"
                    onClick={() => scrollToComment(thread.id)}
                    className="text-[10px] text-navy-500 hover:text-blue-400 cursor-pointer px-1.5 py-0.5 rounded hover:bg-navy-800"
                  >
                    Go to text
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setReplyingTo(replyingTo === thread.id ? null : thread.id)
                    }
                    className="text-[10px] text-navy-500 hover:text-blue-400 cursor-pointer px-1.5 py-0.5 rounded hover:bg-navy-800 flex items-center gap-0.5"
                  >
                    <CornerDownRight size={10} />
                    Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolve(thread)}
                    className="text-[10px] text-navy-500 hover:text-green-400 cursor-pointer px-1.5 py-0.5 rounded hover:bg-navy-800 flex items-center gap-0.5"
                    title={thread.resolved ? 'Unresolve' : 'Resolve'}
                  >
                    <CheckCircle2 size={10} />
                    {thread.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(thread.id)}
                    className="text-[10px] text-navy-500 hover:text-red-400 cursor-pointer px-1.5 py-0.5 rounded hover:bg-navy-800 flex items-center gap-0.5"
                  >
                    <Trash2 size={10} />
                    Delete
                  </button>
                </div>

                {/* Reply input */}
                {replyingTo === thread.id && (
                  <div className="mt-2">
                    <textarea
                      ref={replyRef}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleReply(thread.id)
                        }
                        if (e.key === 'Escape') {
                          setReplyingTo(null)
                          setReplyText('')
                        }
                      }}
                      placeholder="Reply..."
                      rows={2}
                      className="w-full px-2.5 py-1.5 text-xs bg-navy-800 border border-navy-700 rounded text-navy-100 outline-none focus:border-blue-500 resize-none"
                    />
                    <div className="flex justify-end gap-1.5 mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setReplyingTo(null)
                          setReplyText('')
                        }}
                        className="px-2 py-1 text-[10px] text-navy-400 hover:text-white cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReply(thread.id)}
                        disabled={!replyText.trim()}
                        className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
