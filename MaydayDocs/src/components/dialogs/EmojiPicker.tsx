import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import DialogShell from './DialogShell'

interface Props {
  editor: Editor
  onClose: () => void
}

const CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: 'Smileys',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊',
      '😇','🥰','😍','🤩','😘','😋','😛','🤔','🤗','🤫',
      '😎','🥳','😤','😭','🥺','😱','🤯','😴','🤮','🤡',
    ],
  },
  {
    label: 'Gestures',
    emojis: [
      '👍','👎','👊','✊','🤞','✌️','🤟','👋','🙏','💪',
      '👏','🤝','👆','👇','👈','👉','🫡','🫶','🤙','✋',
    ],
  },
  {
    label: 'Objects',
    emojis: [
      '🔥','⭐','💡','❤️','💯','🎯','🏆','🎬','🎤','🎮',
      '📱','💻','📸','🎧','📝','📊','📌','🔑','💰','🚀',
    ],
  },
  {
    label: 'Nature',
    emojis: [
      '🌟','⚡','☀️','🌈','🌊','🌸','🍀','🌺','🦋','🐐',
    ],
  },
  {
    label: 'Sports',
    emojis: [
      '⚾','🏈','🏀','⚽','🎾','🏐','🏒','🥊','🏋️','🎣',
    ],
  },
]

export default function EmojiPicker({ editor, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState(0)

  const insert = (emoji: string) => {
    editor.chain().focus().insertContent(emoji).run()
    onClose()
  }

  return (
    <DialogShell title="Insert Emoji" onClose={onClose}>
      {/* Category tabs */}
      <div className="flex gap-1 mb-3 border-b border-navy-700 pb-2">
        {CATEGORIES.map((cat, i) => (
          <button
            key={cat.label}
            type="button"
            onClick={() => setActiveCategory(i)}
            className={`px-2 py-1 text-xs rounded transition-colors cursor-pointer ${
              i === activeCategory
                ? 'bg-navy-600 text-white'
                : 'text-navy-400 hover:text-white hover:bg-navy-700'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="grid grid-cols-10 gap-1 max-h-48 overflow-y-auto">
        {CATEGORIES[activeCategory].emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => insert(emoji)}
            className="w-8 h-8 flex items-center justify-center text-lg rounded hover:bg-navy-700 transition-colors cursor-pointer"
          >
            {emoji}
          </button>
        ))}
      </div>
    </DialogShell>
  )
}
