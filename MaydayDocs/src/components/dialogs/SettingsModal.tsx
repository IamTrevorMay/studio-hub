import { useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { PageSizeName } from '../../store/editorStore'
import DialogShell from './DialogShell'
import { Moon, Sun } from 'lucide-react'

const FONT_OPTIONS = [
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: 'Courier New, monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
]

const PAGE_SIZE_OPTIONS: { label: string; value: PageSizeName }[] = [
  { label: 'Letter (8.5 × 11 in)', value: 'letter' },
  { label: 'A4 (210 × 297 mm)', value: 'a4' },
  { label: 'Legal (8.5 × 14 in)', value: 'legal' },
]

interface Props {
  onClose: () => void
}

export default function SettingsModal({ onClose }: Props) {
  const {
    authorName,
    setAuthorName,
    defaultFont,
    setDefaultFont,
    defaultPageSize,
    setDefaultPageSize,
    theme,
    setTheme,
  } = useEditorStore()

  const [nameInput, setNameInput] = useState(authorName)

  const saveName = () => {
    if (nameInput.trim() && nameInput.trim() !== authorName) {
      setAuthorName(nameInput.trim())
    }
  }

  const labelClass = 'text-xs text-navy-400 mb-1.5 block'
  const inputClass =
    'w-full h-8 px-3 text-sm bg-navy-900 border border-navy-700 rounded text-navy-100 outline-none focus:border-blue-500'

  return (
    <DialogShell title="Settings" onClose={onClose}>
      <div className="space-y-5">
        {/* Display Name */}
        <div>
          <label className={labelClass}>Display Name</label>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName()
            }}
            className={inputClass}
            placeholder="Your name"
          />
        </div>

        {/* Default Font */}
        <div>
          <label className={labelClass}>Default Font</label>
          <select
            value={defaultFont}
            onChange={(e) => setDefaultFont(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Default Page Size */}
        <div>
          <label className={labelClass}>Default Page Size</label>
          <select
            value={defaultPageSize}
            onChange={(e) => setDefaultPageSize(e.target.value as PageSizeName)}
            className={`${inputClass} cursor-pointer`}
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Theme */}
        <div>
          <label className={labelClass}>Theme</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                theme === 'dark'
                  ? 'bg-blue-600 text-white'
                  : 'bg-navy-900 text-navy-400 hover:text-navy-200 border border-navy-700'
              }`}
            >
              <Moon size={14} />
              Dark
            </button>
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                theme === 'light'
                  ? 'bg-blue-600 text-white'
                  : 'bg-navy-900 text-navy-400 hover:text-navy-200 border border-navy-700'
              }`}
            >
              <Sun size={14} />
              Light
            </button>
          </div>
        </div>
      </div>
    </DialogShell>
  )
}
