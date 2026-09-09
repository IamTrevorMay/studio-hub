import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'

// Menu-bar primitives for the Google Docs style chrome: one row of top-level
// menus where, once any of them is open, hovering a sibling switches to it
// without a second click. That hand-off is why the open menu is tracked by the
// bar rather than by each menu — a menu can't know it should close because a
// neighbour was hovered.

interface BarState {
  openId: string | null
  setOpenId: (id: string | null) => void
}

const MenuBarContext = createContext<BarState>({ openId: null, setOpenId: () => {} })

export function MenuBar({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openId) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenId(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openId])

  return (
    <MenuBarContext.Provider value={{ openId, setOpenId }}>
      <div ref={ref} className="flex items-center gap-0.5">
        {children}
      </div>
    </MenuBarContext.Provider>
  )
}

interface MenuProps {
  id: string
  label: string
  width?: number
  children: React.ReactNode
}

export function Menu({ id, label, width = 232, children }: MenuProps) {
  const { openId, setOpenId } = useContext(MenuBarContext)
  const open = openId === id

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpenId(open ? null : id)}
        onMouseEnter={() => { if (openId && !open) setOpenId(id) }}
        className={`px-2.5 py-1 text-[13px] rounded transition-colors cursor-pointer ${
          open ? 'bg-navy-700 text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white'
        }`}
      >
        {label}
      </button>

      {open && (
        <div
          onClick={(e) => {
            // Let a click on a plain item close the menu, but keep it open for
            // controls that live inside one (checkbox rows are handled by the
            // item itself passing closeOnClick={false}).
            const el = e.target as HTMLElement
            if (el.closest('[data-keep-open]')) return
            setOpenId(null)
          }}
          className="absolute top-full left-0 mt-1 z-[60] bg-navy-800 border border-navy-600 rounded-lg shadow-2xl py-1.5"
          style={{ width }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

interface ItemProps {
  label: string
  icon?: React.ComponentType<{ size?: number; className?: string }>
  shortcut?: string
  checked?: boolean
  disabled?: boolean
  danger?: boolean
  keepOpen?: boolean
  onClick: () => void
}

export function MenuItem({
  label,
  icon: Icon,
  shortcut,
  checked,
  disabled,
  danger,
  keepOpen,
  onClick,
}: ItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-keep-open={keepOpen ? '' : undefined}
      onClick={onClick}
      className={`w-full flex items-center gap-3 pl-3 pr-3 py-1.5 text-[13px] text-left transition-colors ${
        disabled
          ? 'text-navy-500 cursor-not-allowed'
          : danger
            ? 'text-red-300 hover:bg-navy-700 cursor-pointer'
            : 'text-navy-200 hover:bg-navy-700 hover:text-white cursor-pointer'
      }`}
    >
      <span className="w-4 flex-shrink-0 flex items-center justify-center">
        {checked !== undefined
          ? (checked ? <Check size={14} className="text-blue-400" /> : null)
          : Icon
            ? <Icon size={14} className="text-navy-400" />
            : null}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {shortcut && <span className="text-[11px] text-navy-500 flex-shrink-0">{shortcut}</span>}
    </button>
  )
}

export function MenuDivider() {
  return <div className="h-px bg-navy-700 my-1.5 mx-2" />
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-500">
      {children}
    </div>
  )
}

// A row that opens a nested list on hover — used for Download / Zoom / Line
// spacing, which have enough options to be noise at the top level.
export function SubMenu({
  label,
  children,
  width = 180,
}: {
  label: string
  children: React.ReactNode
  width?: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div
        data-keep-open
        className="w-full flex items-center gap-3 pl-3 pr-3 py-1.5 text-[13px] text-navy-200 hover:bg-navy-700 hover:text-white cursor-default transition-colors"
      >
        <span className="w-4 flex-shrink-0" />
        <span className="flex-1">{label}</span>
        <ChevronRight size={14} className="text-navy-500 flex-shrink-0" />
      </div>
      {open && (
        <div
          className="absolute top-0 left-full z-[61] bg-navy-800 border border-navy-600 rounded-lg shadow-2xl py-1.5"
          style={{ width }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
