import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorStore } from './editorStore'
import {
  X,
  MessageSquare,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react'

interface CommentMark {
  commentId: string
  author: string
  text: string
  createdAt: string
}

interface Props {
  editor: Editor
  documentId: string
  onClose: () => void
}

export default function CommentPanel({ editor, documentId, onClose }: Props) {
  const { authorName } = useEditorStore()

  const [showResolved, setShowResolved] = useState(false)
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())

  // Scan editor document to extract comment marks
  const comments = useMemo(() => {
    const found: CommentMark[] = []
    const seen = new Set<string>()
    editor.state.doc.descendants((node) => {
      node.marks.forEach((mark) => {
        if (mark.type.name === 'comment' && mark.attrs.commentId && !seen.has(mark.attrs.commentId)) {
          seen.add(mark.attrs.commentId)
          found.push({
            commentId: mark.attrs.commentId,
            author: mark.attrs.author || 'Unknown',
            text: mark.attrs.text || '',
            createdAt: mark.attrs.createdAt || '',
          })
        }
      })
    })
    return found
  }, [editor, editor.state.doc])

  const visibleComments = showResolved
    ? comments
    : comments.filter((c) => !resolvedIds.has(c.commentId))

  const resolvedCount = comments.filter((c) => resolvedIds.has(c.commentId)).length

  const handleDelete = useCallback(
    (commentId: string) => {
      const { doc } = editor.state
      let found = false
      doc.descendants((node, pos) => {
        if (found) return false
        node.marks.forEach((mark) => {
          if (mark.type.name === 'comment' && mark.attrs.commentId === commentId) {
            editor
              .chain()
              .setTextSelection({ from: pos, to: pos + node.nodeSize })
              .unsetMark('comment')
              .run()
            found = true
          }
        })
      })
      setResolvedIds((prev) => {
        const next = new Set(prev)
        next.delete(commentId)
        return next
      })
    },
    [editor]
  )

  const handleResolve = useCallback(
    (commentId: string) => {
      setResolvedIds((prev) => {
        const next = new Set(prev)
        if (next.has(commentId)) {
          next.delete(commentId)
        } else {
          next.add(commentId)
        }
        return next
      })
    },
    []
  )

  const scrollToComment = useCallback(
    (commentId: string) => {
      const { doc } = editor.state
      doc.descendants((node, pos) => {
        node.marks.forEach((mark) => {
          if (mark.type.name === 'comment' && mark.attrs.commentId === commentId) {
            editor.chain().setTextSelection(pos).scrollIntoView().run()
          }
        })
      })
    },
    [editor]
  )

  const formatTime = (iso: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  return (
    <div className="w-80 bg-navy-900 border-l border-navy-700 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-navy-700">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-blue-400" />
          <span className="text-sm font-semibold text-white">
            Comments ({comments.length})
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

      {/* Author name display */}
      <div className="px-4 py-2 border-b border-navy-800 flex items-center gap-2">
        <span className="text-xs text-navy-400">Commenting as</span>
        <span className="text-xs text-navy-200 font-medium">{authorName}</span>
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

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto">
        {visibleComments.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-navy-500">
            {comments.length === 0
              ? 'No comments yet. Select text and click the comment button to add one.'
              : 'All comments resolved.'}
          </div>
        ) : (
          <div className="divide-y divide-navy-800">
            {visibleComments.map((comment) => {
              const isResolved = resolvedIds.has(comment.commentId)
              return (
                <div
                  key={comment.commentId}
                  className={`px-4 py-3 ${isResolved ? 'opacity-60' : ''}`}
                >
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

                  {/* Actions */}
                  <div className="flex items-center gap-1 mt-2">
                    <button
                      type="button"
                      onClick={() => scrollToComment(comment.commentId)}
                      className="text-[10px] text-navy-500 hover:text-blue-400 cursor-pointer px-1.5 py-0.5 rounded hover:bg-navy-800"
                    >
                      Go to text
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolve(comment.commentId)}
                      className="text-[10px] text-navy-500 hover:text-green-400 cursor-pointer px-1.5 py-0.5 rounded hover:bg-navy-800"
                    >
                      {isResolved ? 'Reopen' : 'Resolve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(comment.commentId)}
                      className="text-[10px] text-navy-500 hover:text-red-400 cursor-pointer px-1.5 py-0.5 rounded hover:bg-navy-800 flex items-center gap-0.5"
                    >
                      <Trash2 size={10} />
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
