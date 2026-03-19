import { useState, useRef, useEffect } from 'react'
import { Settings2 } from 'lucide-react'
import PageSetupPanel from './dialogs/PageSetupPanel'

export default function FormatMenu() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showPageSetup, setShowPageSetup] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-navy-200 hover:text-white hover:bg-navy-700 rounded transition-colors cursor-pointer"
        >
          Format
        </button>

        {menuOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-navy-800 border border-navy-600 rounded-lg shadow-xl py-1 w-48">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setShowPageSetup(true)
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-navy-200 hover:bg-navy-700 hover:text-white transition-colors cursor-pointer"
            >
              <Settings2 size={16} className="text-navy-400" />
              Page Setup
            </button>
          </div>
        )}
      </div>

      {showPageSetup && <PageSetupPanel onClose={() => setShowPageSetup(false)} />}
    </>
  )
}
