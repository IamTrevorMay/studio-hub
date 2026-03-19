import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorStore } from './editorStore'
import { Type, Plus, Search } from 'lucide-react'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
const mod = isMac ? '⌘' : 'Ctrl+'

interface CommandItem {
  id: string
  label: string
  shortcut?: string
  category: 'format' | 'insert' | 'app'
  action: () => void
}

interface Props {
  editor: Editor | null
  onClose: () => void
  onOpenSettings: () => void
  onToggleFindReplace: () => void
  onToggleComments: () => void
}

const CATEGORY_META: Record<string, { icon: typeof Type; color: string; label: string }> = {
  format: { icon: Type, color: 'text-purple-400', label: 'Format' },
  insert: { icon: Plus, color: 'text-green-400', label: 'Insert' },
  app: { icon: Search, color: 'text-navy-400', label: 'Actions' },
}

export default function CommandPalette({
  editor,
  onClose,
  onOpenSettings,
  onToggleFindReplace,
  onToggleComments,
}: Props) {
  const { toggleFocusMode } = useEditorStore()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const commands = useMemo<CommandItem[]>(() => {
    const cmds: CommandItem[] = []

    // Format commands
    if (editor) {
      const formatCmds: { label: string; shortcut?: string; action: () => void }[] = [
        { label: 'Bold', shortcut: `${mod}B`, action: () => editor.chain().focus().toggleBold().run() },
        { label: 'Italic', shortcut: `${mod}I`, action: () => editor.chain().focus().toggleItalic().run() },
        { label: 'Underline', shortcut: `${mod}U`, action: () => editor.chain().focus().toggleUnderline().run() },
        { label: 'Strikethrough', shortcut: `${mod}${isMac ? '⇧X' : 'Shift+X'}`, action: () => editor.chain().focus().toggleStrike().run() },
        { label: 'Heading 1', shortcut: `${mod}${isMac ? '⌥' : 'Alt+'}1`, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
        { label: 'Heading 2', shortcut: `${mod}${isMac ? '⌥' : 'Alt+'}2`, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
        { label: 'Heading 3', shortcut: `${mod}${isMac ? '⌥' : 'Alt+'}3`, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
        { label: 'Bullet List', shortcut: `${mod}${isMac ? '⇧8' : 'Shift+8'}`, action: () => editor.chain().focus().toggleBulletList().run() },
        { label: 'Numbered List', shortcut: `${mod}${isMac ? '⇧7' : 'Shift+7'}`, action: () => editor.chain().focus().toggleOrderedList().run() },
        { label: 'Blockquote', action: () => editor.chain().focus().toggleBlockquote().run() },
        { label: 'Align Left', shortcut: `${mod}${isMac ? '⇧L' : 'Shift+L'}`, action: () => editor.chain().focus().setTextAlign('left').run() },
        { label: 'Align Center', shortcut: `${mod}${isMac ? '⇧E' : 'Shift+E'}`, action: () => editor.chain().focus().setTextAlign('center').run() },
        { label: 'Align Right', shortcut: `${mod}${isMac ? '⇧R' : 'Shift+R'}`, action: () => editor.chain().focus().setTextAlign('right').run() },
        { label: 'Clear Formatting', shortcut: `${mod}\\`, action: () => editor.chain().focus().unsetAllMarks().clearNodes().run() },
      ]
      formatCmds.forEach((c, i) => {
        cmds.push({ id: `fmt-${i}`, category: 'format', ...c })
      })

      // Insert commands
      const insertCmds: { label: string; action: () => void }[] = [
        { label: 'Horizontal Rule', action: () => editor.chain().focus().setHorizontalRule().run() },
        { label: 'Code Block', action: () => editor.chain().focus().toggleCodeBlock().run() },
        { label: 'Table (3x3)', action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      ]
      insertCmds.forEach((c, i) => {
        cmds.push({ id: `ins-${i}`, category: 'insert', ...c })
      })
    }

    // App commands
    cmds.push(
      { id: 'app-settings', label: 'Open Settings', shortcut: `${mod},`, category: 'app', action: () => { onClose(); onOpenSettings() } },
      { id: 'app-comments', label: 'Toggle Comments', category: 'app', action: () => { onToggleComments(); onClose() } },
      { id: 'app-focus', label: 'Toggle Focus Mode', shortcut: `${mod}.`, category: 'app', action: () => { toggleFocusMode(); onClose() } },
      { id: 'app-find', label: 'Find & Replace', shortcut: `${mod}F`, category: 'app', action: () => { onToggleFindReplace(); onClose() } },
    )

    return cmds
  }, [editor, onClose, onOpenSettings, onToggleFindReplace, onToggleComments, toggleFocusMode])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter((c) => c.label.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const executeSelected = useCallback(() => {
    if (filtered[selectedIndex]) {
      filtered[selectedIndex].action()
      onClose()
    }
  }, [filtered, selectedIndex, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      executeSelected()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [filtered.length, executeSelected, onClose])

  // Scroll selected into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Group by category for display
  const grouped = useMemo(() => {
    const groups: { category: string; items: (CommandItem & { globalIndex: number })[] }[] = []
    const catOrder = ['format', 'insert', 'app']
    const catMap = new Map<string, (CommandItem & { globalIndex: number })[]>()

    filtered.forEach((item, globalIndex) => {
      let arr = catMap.get(item.category)
      if (!arr) {
        arr = []
        catMap.set(item.category, arr)
      }
      arr.push({ ...item, globalIndex })
    })

    catOrder.forEach((cat) => {
      const items = catMap.get(cat)
      if (items?.length) {
        groups.push({ category: cat, items })
      }
    })

    return groups
  }, [filtered])

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="mx-auto mt-[20vh] w-full max-w-lg bg-navy-800 border border-navy-600 rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="px-4 py-3 border-b border-navy-700">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="w-full bg-transparent text-sm text-navy-100 outline-none placeholder-navy-500"
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="text-center text-xs text-navy-500 py-6">No results</p>
          )}
          {grouped.map((group) => {
            const meta = CATEGORY_META[group.category]
            const Icon = meta.icon
            return (
              <div key={group.category}>
                <div className="flex items-center gap-2 px-4 py-1.5">
                  <Icon size={12} className={meta.color} />
                  <span className="text-[10px] font-semibold text-navy-500 uppercase tracking-wider">
                    {meta.label}
                  </span>
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(item.globalIndex)}
                    onClick={() => { item.action(); onClose() }}
                    className={`w-full flex items-center justify-between px-4 py-2 text-left text-sm cursor-pointer transition-colors ${
                      item.globalIndex === selectedIndex
                        ? 'bg-navy-700 text-white'
                        : 'text-navy-200 hover:bg-navy-700/50'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    {item.shortcut && (
                      <kbd className="ml-2 flex-shrink-0 text-[10px] text-navy-500 bg-navy-900 px-1.5 py-0.5 rounded border border-navy-700 font-mono">
                        {item.shortcut}
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
