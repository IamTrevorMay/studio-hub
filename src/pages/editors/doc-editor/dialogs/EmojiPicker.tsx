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
      '\u{1F600}','\u{1F603}','\u{1F604}','\u{1F601}','\u{1F606}','\u{1F605}','\u{1F923}','\u{1F602}','\u{1F642}','\u{1F60A}',
      '\u{1F607}','\u{1F970}','\u{1F60D}','\u{1F929}','\u{1F618}','\u{1F60B}','\u{1F61B}','\u{1F914}','\u{1F917}','\u{1F92B}',
      '\u{1F60E}','\u{1F973}','\u{1F624}','\u{1F62D}','\u{1F97A}','\u{1F631}','\u{1F92F}','\u{1F634}','\u{1F92E}','\u{1F921}',
    ],
  },
  {
    label: 'Gestures',
    emojis: [
      '\u{1F44D}','\u{1F44E}','\u{1F44A}','\u270A','\u{1F91E}','\u270C\uFE0F','\u{1F91F}','\u{1F44B}','\u{1F64F}','\u{1F4AA}',
      '\u{1F44F}','\u{1F91D}','\u{1F446}','\u{1F447}','\u{1F448}','\u{1F449}','\u{1FAE1}','\u{1FAF6}','\u{1F919}','\u270B',
    ],
  },
  {
    label: 'Objects',
    emojis: [
      '\u{1F525}','\u2B50','\u{1F4A1}','\u2764\uFE0F','\u{1F4AF}','\u{1F3AF}','\u{1F3C6}','\u{1F3AC}','\u{1F3A4}','\u{1F3AE}',
      '\u{1F4F1}','\u{1F4BB}','\u{1F4F8}','\u{1F3A7}','\u{1F4DD}','\u{1F4CA}','\u{1F4CC}','\u{1F511}','\u{1F4B0}','\u{1F680}',
    ],
  },
  {
    label: 'Nature',
    emojis: [
      '\u{1F31F}','\u26A1','\u2600\uFE0F','\u{1F308}','\u{1F30A}','\u{1F338}','\u{1F340}','\u{1F33A}','\u{1F98B}','\u{1F410}',
    ],
  },
  {
    label: 'Sports',
    emojis: [
      '\u26BE','\u{1F3C8}','\u{1F3C0}','\u26BD','\u{1F3BE}','\u{1F3D0}','\u{1F3D2}','\u{1F94A}','\u{1F3CB}\uFE0F','\u{1F3A3}',
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
