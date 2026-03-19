import { useEditorStore } from './editorStore'
import { ZoomIn, ZoomOut } from 'lucide-react'

const ZOOM_STEPS = [50, 75, 90, 100, 110, 125, 150, 175, 200]

export default function ZoomControl() {
  const { zoom, setZoom } = useEditorStore()

  const stepUp = () => {
    const next = ZOOM_STEPS.find((s) => s > zoom)
    if (next) setZoom(next)
  }

  const stepDown = () => {
    const prev = [...ZOOM_STEPS].reverse().find((s) => s < zoom)
    if (prev) setZoom(prev)
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={stepDown}
        disabled={zoom <= 50}
        className="p-0.5 rounded text-navy-400 hover:text-white disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
        title="Zoom out"
      >
        <ZoomOut size={14} />
      </button>

      <select
        value={zoom}
        onChange={(e) => setZoom(Number(e.target.value))}
        className="bg-transparent text-navy-300 text-xs outline-none cursor-pointer w-14 text-center"
      >
        {ZOOM_STEPS.map((s) => (
          <option key={s} value={s} className="bg-navy-900">
            {s}%
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={stepUp}
        disabled={zoom >= 200}
        className="p-0.5 rounded text-navy-400 hover:text-white disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
        title="Zoom in"
      >
        <ZoomIn size={14} />
      </button>
    </div>
  )
}
