import {
  useEditorStore,
  PAGE_SIZES,
  MARGIN_PRESETS,
  type PageSizeName,
  type MarginPreset,
  type Orientation,
} from '../editorStore'
import DialogShell from './DialogShell'

interface Props {
  onClose: () => void
}

const PAGE_SIZE_LABELS: Record<PageSizeName, string> = {
  letter: 'Letter (8.5 x 11 in)',
  a4: 'A4 (210 x 297 mm)',
  legal: 'Legal (8.5 x 14 in)',
}

export default function PageSetupPanel({ onClose }: Props) {
  const { pageSetup, setPageSetup } = useEditorStore()

  const handleMarginPreset = (preset: MarginPreset) => {
    if (preset === 'custom') {
      setPageSetup({ marginPreset: 'custom' })
    } else {
      setPageSetup({ marginPreset: preset, margins: MARGIN_PRESETS[preset] })
    }
  }

  const handleCustomMargin = (side: 'top' | 'right' | 'bottom' | 'left', val: string) => {
    const num = parseFloat(val)
    if (isNaN(num) || num < 0) return
    setPageSetup({
      marginPreset: 'custom',
      margins: { ...pageSetup.margins, [side]: num },
    })
  }

  return (
    <DialogShell title="Page Setup" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <label className="block text-xs text-navy-300 mb-1.5">Page Size</label>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(PAGE_SIZES) as PageSizeName[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPageSetup({ pageSize: key })}
                className={`text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                  pageSetup.pageSize === key
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40'
                    : 'bg-navy-900 text-navy-200 border border-navy-700 hover:border-navy-500'
                }`}
              >
                {PAGE_SIZE_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-navy-300 mb-1.5">Orientation</label>
          <div className="flex gap-2">
            {(['portrait', 'landscape'] as Orientation[]).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setPageSetup({ orientation: o })}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm capitalize transition-colors cursor-pointer ${
                  pageSetup.orientation === o
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40'
                    : 'bg-navy-900 text-navy-200 border border-navy-700 hover:border-navy-500'
                }`}
              >
                <div
                  className={`border-2 rounded-sm ${
                    pageSetup.orientation === o ? 'border-blue-400' : 'border-navy-500'
                  } ${o === 'portrait' ? 'w-4 h-5' : 'w-5 h-4'}`}
                />
                {o}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-navy-300 mb-1.5">Margins</label>
          <div className="flex gap-2 mb-3">
            {(['normal', 'narrow', 'wide', 'custom'] as MarginPreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleMarginPreset(p)}
                className={`flex-1 px-2 py-1.5 rounded text-xs capitalize transition-colors cursor-pointer ${
                  pageSetup.marginPreset === p
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40'
                    : 'bg-navy-900 text-navy-200 border border-navy-700 hover:border-navy-500'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {pageSetup.marginPreset === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <div key={side}>
                  <label className="block text-[10px] text-navy-500 mb-0.5 capitalize">{side} (in)</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    max="3"
                    value={pageSetup.margins[side]}
                    onChange={(e) => handleCustomMargin(side, e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-navy-900 border border-navy-700 rounded text-navy-100 outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-navy-200">Show page breaks</span>
          <button
            type="button"
            onClick={() => setPageSetup({ showPageBreaks: !pageSetup.showPageBreaks })}
            className={`w-10 h-5 rounded-full transition-colors cursor-pointer relative ${
              pageSetup.showPageBreaks ? 'bg-blue-600' : 'bg-navy-700'
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                pageSetup.showPageBreaks ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
    </DialogShell>
  )
}
