import { useState, useEffect, useRef, useCallback } from 'react'
import {
  generatePDFBlobUrl,
  downloadScreenplayPDF,
  type SerializedEditorState,
  type PDFExportOptions,
} from '../../lib/screenplay/exportPDF'
import type { LegacyTitlePage } from '../../types'

interface PrintPreviewModalProps {
  editorState: SerializedEditorState | null
  titlePage?: LegacyTitlePage
  scriptTitle?: string
  onClose: () => void
}

export default function PrintPreviewModal({
  editorState,
  titlePage,
  scriptTitle,
  onClose,
}: PrintPreviewModalProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [generating, setGenerating] = useState(true)
  const [showSceneNumbers, setShowSceneNumbers] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)

  // Generate PDF on mount and when options change
  useEffect(() => {
    setGenerating(true)

    // Small delay so the modal renders its loading state first
    const t = setTimeout(() => {
      try {
        const opts: PDFExportOptions = { showSceneNumbers }
        const url = generatePDFBlobUrl(editorState, titlePage, scriptTitle, opts)
        setBlobUrl(url)
      } catch (err) {
        console.error('PDF generation failed:', err)
      }
      setGenerating(false)
    }, 50)

    return () => {
      clearTimeout(t)
    }
  }, [editorState, titlePage, scriptTitle, showSceneNumbers])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  // Close on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  // Close on backdrop click — armed only when the press started on the
  // backdrop, so a text-selection drag that ends outside the modal (the
  // click then targets the backdrop as common ancestor) doesn't close it.
  const backdropPressRef = useRef(false)
  const handleBackdropMouseDown = useCallback((e: React.MouseEvent) => {
    backdropPressRef.current = e.target === backdropRef.current
  }, [])
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (backdropPressRef.current && e.target === backdropRef.current) onClose()
      backdropPressRef.current = false
    },
    [onClose]
  )

  // Download handler
  const handleDownload = useCallback(() => {
    const opts: PDFExportOptions = { showSceneNumbers }
    downloadScreenplayPDF(editorState, titlePage, scriptTitle, opts)
  }, [editorState, titlePage, scriptTitle, showSceneNumbers])

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      style={styles.backdrop}
    >
      <div style={styles.modal}>
        {/* ─── Header ─── */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#a5b4fc" strokeWidth="1.5">
              <rect x="3" y="1.5" width="12" height="15" rx="1.5" />
              <path d="M6 5.5h6M6 8h6M6 10.5h4" />
            </svg>
            <span style={styles.headerTitle}>Print Preview</span>
            <span style={styles.headerSubtitle}>
              {scriptTitle || 'Untitled Screenplay'}
            </span>
          </div>

          <div style={styles.headerRight}>
            {/* Scene numbers toggle */}
            <label style={styles.toggle}>
              <input
                type="checkbox"
                checked={showSceneNumbers}
                onChange={(e) => setShowSceneNumbers(e.target.checked)}
                style={styles.toggleInput}
              />
              <span
                style={{
                  ...styles.toggleTrack,
                  background: showSceneNumbers
                    ? 'rgba(99,102,241,0.5)'
                    : 'rgba(255,255,255,0.1)',
                }}
              >
                <span
                  style={{
                    ...styles.toggleThumb,
                    transform: showSceneNumbers
                      ? 'translateX(14px)'
                      : 'translateX(0)',
                  }}
                />
              </span>
              <span style={styles.toggleLabel}>Scene #s</span>
            </label>

            <button onClick={onClose} style={styles.closeBtn} title="Close">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 5l8 8M13 5l-8 8" />
              </svg>
            </button>
          </div>
        </div>

        {/* ─── Preview area ─── */}
        <div style={styles.previewArea}>
          {generating ? (
            <div style={styles.loadingState}>
              <div style={styles.spinner} />
              <span>Generating PDF...</span>
            </div>
          ) : blobUrl ? (
            <iframe
              src={blobUrl}
              style={styles.iframe}
              title="Screenplay PDF Preview"
            />
          ) : (
            <div style={styles.loadingState}>
              <span style={{ color: '#f87171' }}>
                Failed to generate PDF. Try downloading directly.
              </span>
            </div>
          )}
        </div>

        {/* ─── Footer ─── */}
        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelBtn}>
            Close
          </button>
          <button
            onClick={handleDownload}
            style={styles.downloadBtn}
            disabled={generating}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 2v7M4 6l3 3 3-3" />
              <path d="M2 10v2h10v-2" />
            </svg>
            Download PDF
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Styles ───

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '24px',
  },
  modal: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: '900px',
    height: '100%',
    maxHeight: '90vh',
    background: '#12121f',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    overflow: 'hidden',
    boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    overflow: 'hidden',
  },
  headerTitle: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#e2e8f0',
  },
  headerSubtitle: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    flexShrink: 0,
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  toggleInput: {
    display: 'none',
  },
  toggleTrack: {
    position: 'relative' as const,
    display: 'inline-block',
    width: '30px',
    height: '16px',
    borderRadius: '8px',
    transition: 'background 0.2s',
  },
  toggleThumb: {
    position: 'absolute' as const,
    top: '2px',
    left: '2px',
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: '#fff',
    transition: 'transform 0.2s',
  },
  toggleLabel: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.5)',
    fontWeight: 500,
  },
  closeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    border: 'none',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer',
    padding: 0,
  },
  previewArea: {
    flex: 1,
    background: '#0a0a12',
    overflow: 'hidden',
    position: 'relative',
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    background: '#0a0a12',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    height: '100%',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '14px',
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '2.5px solid rgba(255,255,255,0.08)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'screenplay-spin 0.7s linear infinite',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '10px',
    padding: '14px 20px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  cancelBtn: {
    padding: '8px 18px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  downloadBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 20px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}
