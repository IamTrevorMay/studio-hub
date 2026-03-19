import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { usePaginator } from '../../hooks/usePaginator'
import type { CalculatedPageBreak } from '../../lib/screenplay/paginator'

/**
 * PageBreakPlugin
 *
 * Renders visible page break indicators inside the editor.
 * After each pagination recalculation, it inserts/removes lightweight
 * DOM dividers after the elements where page breaks land.
 *
 * Also exposes the current page count via a callback.
 */
export default function PageBreakPlugin({
  onPageCount,
}: {
  onPageCount?: (count: number) => void
}) {
  const [editor] = useLexicalComposerContext()
  const { breaks, pageCount } = usePaginator(editor)
  const prevBreakKeysRef = useRef<string>('')

  // Report page count
  useEffect(() => {
    onPageCount?.(pageCount)
  }, [pageCount, onPageCount])

  // Render page break indicators in the DOM
  useEffect(() => {
    // Build a serializable key to avoid unnecessary DOM thrash
    const breakKey = breaks.map((b) => `${b.afterKey}:${b.pageNumber}`).join('|')
    if (breakKey === prevBreakKeysRef.current) return
    prevBreakKeysRef.current = breakKey

    // Remove all existing break indicators
    const rootElement = editor.getRootElement()
    if (!rootElement) return

    const existing = rootElement.querySelectorAll('.screenplay-page-break')
    existing.forEach((el) => el.remove())

    // Insert new break indicators
    breaks.forEach((brk: CalculatedPageBreak) => {
      const domElement = editor.getElementByKey(brk.afterKey)
      if (!domElement) return

      const indicator = document.createElement('div')
      indicator.className = 'screenplay-page-break'
      indicator.contentEditable = 'false'
      indicator.setAttribute('data-page-break', String(brk.pageNumber))

      const label = document.createElement('span')
      label.className = 'screenplay-page-break-label'
      label.textContent = `Page ${brk.pageNumber}`
      indicator.appendChild(label)

      // Insert after the element
      domElement.after(indicator)
    })
  }, [breaks, editor])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const rootElement = editor.getRootElement()
      if (!rootElement) return
      const existing = rootElement.querySelectorAll('.screenplay-page-break')
      existing.forEach((el) => el.remove())
    }
  }, [editor])

  return null
}
