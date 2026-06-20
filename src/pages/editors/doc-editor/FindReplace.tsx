import { useState, useEffect, useRef, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import {
  X,
  ChevronUp,
  ChevronDown,
  CaseSensitive,
  WholeWord,
  Replace,
  ReplaceAll,
} from 'lucide-react'

interface Props {
  editor: Editor
  onClose: () => void
}

interface Match {
  from: number
  to: number
}

function findMatches(
  editor: Editor,
  search: string,
  matchCase: boolean,
  wholeWord: boolean
): Match[] {
  if (!search) return []

  const matches: Match[] = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return

    const text = node.text
    const searchStr = matchCase ? search : search.toLowerCase()
    const haystack = matchCase ? text : text.toLowerCase()

    let startIndex = 0
    while (startIndex < haystack.length) {
      const idx = haystack.indexOf(searchStr, startIndex)
      if (idx === -1) break

      if (wholeWord) {
        const before = idx > 0 ? text[idx - 1] : ' '
        const after = idx + search.length < text.length ? text[idx + search.length] : ' '
        if (/\w/.test(before) || /\w/.test(after)) {
          startIndex = idx + 1
          continue
        }
      }

      matches.push({ from: pos + idx, to: pos + idx + search.length })
      startIndex = idx + 1
    }
  })

  return matches
}

export default function FindReplace({ editor, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [replace, setReplace] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [matches, setMatches] = useState<Match[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  // Prefill from selection on mount
  useEffect(() => {
    searchRef.current?.focus()
    const { from, to } = editor.state.selection
    if (from !== to) {
      const text = editor.state.doc.textBetween(from, to)
      if (text.length < 200) setSearch(text)
    }
  }, [])

  // Clear highlights on close
  useEffect(() => {
    return () => {
      const storage = (editor.storage as any).searchHighlight
      if (storage) {
        storage.searchTerm = ''
        editor.view.dispatch(editor.state.tr)
      }
    }
  }, [editor])

  // Recompute matches
  const recompute = useCallback(() => {
    const m = findMatches(editor, search, matchCase, wholeWord)
    setMatches(m)
    setCurrentIndex((prev) => (m.length === 0 ? 0 : Math.min(prev, m.length - 1)))
  }, [editor, search, matchCase, wholeWord])

  useEffect(() => {
    recompute()
  }, [recompute])

  // Sync search state into the plugin storage
  useEffect(() => {
    const storage = (editor.storage as any).searchHighlight
    if (!storage) return
    storage.searchTerm = search
    storage.matchCase = matchCase
    storage.wholeWord = wholeWord
    storage.currentIndex = currentIndex
    editor.view.dispatch(editor.state.tr)
  }, [editor, search, matchCase, wholeWord, currentIndex])

  // Re-run on doc edits
  useEffect(() => {
    editor.on('update', recompute)
    return () => { editor.off('update', recompute) }
  }, [editor, recompute])

  // Scroll current match into view
  useEffect(() => {
    if (matches.length === 0 || currentIndex >= matches.length) return
    const match = matches[currentIndex]
    editor.chain().setTextSelection(match).scrollIntoView().run()
  }, [currentIndex, matches, editor])

  const goNext = () => {
    if (matches.length === 0) return
    setCurrentIndex((prev) => (prev + 1) % matches.length)
  }

  const goPrev = () => {
    if (matches.length === 0) return
    setCurrentIndex((prev) => (prev - 1 + matches.length) % matches.length)
  }

  // Insert the replacement as a plain text node — a bare string is parsed as
  // HTML by insertContent, so "<img onerror=...>" in the field would inject markup.
  const replaceContent = replace ? { type: 'text', text: replace } : null

  const doReplace = () => {
    if (matches.length === 0 || currentIndex >= matches.length) return
    const match = matches[currentIndex]
    const chain = editor.chain().focus().setTextSelection(match).deleteSelection()
    if (replaceContent) chain.insertContent(replaceContent)
    chain.run()
  }

  const doReplaceAll = () => {
    if (matches.length === 0) return
    const sorted = [...matches].sort((a, b) => b.from - a.from)
    const chain = editor.chain()
    for (const match of sorted) {
      chain.setTextSelection(match).deleteSelection()
      if (replaceContent) chain.insertContent(replaceContent)
    }
    chain.focus().run()
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) goPrev()
      else goNext()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const handleReplaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doReplace()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const toggleBtnClass = (active: boolean) =>
    `p-1 rounded transition-colors cursor-pointer ${
      active
        ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
        : 'text-navy-400 hover:text-white hover:bg-navy-700 border border-transparent'
    }`

  return (
    <div className="absolute top-2 right-4 z-50 bg-navy-800 border border-navy-600 rounded-lg shadow-2xl w-80 find-replace-panel">
      <div className="p-3 space-y-2">
        {/* Search row */}
        <div className="flex items-center gap-1.5">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Find..."
            className="flex-1 min-w-0 px-2.5 py-1.5 text-sm bg-navy-900 border border-navy-700 rounded text-navy-100 outline-none focus:border-blue-500"
          />
          <button type="button" onClick={goPrev} className="p-1 text-navy-400 hover:text-white rounded cursor-pointer" title="Previous (Shift+Enter)">
            <ChevronUp size={16} />
          </button>
          <button type="button" onClick={goNext} className="p-1 text-navy-400 hover:text-white rounded cursor-pointer" title="Next (Enter)">
            <ChevronDown size={16} />
          </button>
          <button type="button" onClick={onClose} className="p-1 text-navy-400 hover:text-white rounded cursor-pointer" title="Close (Esc)">
            <X size={16} />
          </button>
        </div>

        {/* Options + count row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMatchCase(!matchCase)}
              className={toggleBtnClass(matchCase)}
              title="Match case"
            >
              <CaseSensitive size={16} />
            </button>
            <button
              type="button"
              onClick={() => setWholeWord(!wholeWord)}
              className={toggleBtnClass(wholeWord)}
              title="Whole word"
            >
              <WholeWord size={16} />
            </button>
          </div>
          <span className="text-xs text-navy-400">
            {matches.length > 0
              ? `${currentIndex + 1} of ${matches.length} match${matches.length !== 1 ? 'es' : ''}`
              : search
                ? 'No matches'
                : ''}
          </span>
        </div>

        {/* Replace row */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            placeholder="Replace..."
            className="flex-1 min-w-0 px-2.5 py-1.5 text-sm bg-navy-900 border border-navy-700 rounded text-navy-100 outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={doReplace}
            disabled={matches.length === 0}
            className="p-1 text-navy-400 hover:text-white disabled:opacity-30 rounded cursor-pointer disabled:cursor-not-allowed"
            title="Replace"
          >
            <Replace size={16} />
          </button>
          <button
            type="button"
            onClick={doReplaceAll}
            disabled={matches.length === 0}
            className="p-1 text-navy-400 hover:text-white disabled:opacity-30 rounded cursor-pointer disabled:cursor-not-allowed"
            title="Replace all"
          >
            <ReplaceAll size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
