import React from 'react';
import { TOOLS, COLORS, STROKE_WIDTHS } from './telestrationConstants';

// SVG icons for each tool
const TOOL_ICONS = {
  cursor: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    </svg>
  ),
  pen: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" />
    </svg>
  ),
  line: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="5" y1="19" x2="19" y2="5" />
    </svg>
  ),
  arrow: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="5" y1="19" x2="19" y2="5" /><polyline points="10 5 19 5 19 14" />
    </svg>
  ),
  circle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  triangle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3L2 21h20L12 3z" />
    </svg>
  ),
  square: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="1" />
    </svg>
  ),
  highlighter: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15.5 4.5l4 4L8 20H4v-4L15.5 4.5z" /><path d="M2 22h6" />
    </svg>
  ),
  text: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7V4h16v3" /><line x1="12" y1="4" x2="12" y2="20" /><path d="M8 20h8" />
    </svg>
  ),
};

export default function Toolbar({
  activeTool,
  onToolChange,
  drawColor,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  onUndo,
  onRedo,
  onDelete,
  onExport,
  isExporting,
  isYouTube,
}) {
  return (
    <div style={styles.bar}>
      {/* Drawing tools */}
      <div style={styles.group}>
        {TOOLS.map(tool => (
          <button
            key={tool.key}
            onClick={() => onToolChange(tool.key)}
            style={{
              ...styles.toolBtn,
              ...(activeTool === tool.key ? styles.toolBtnActive : {}),
            }}
            title={tool.label}
          >
            {TOOL_ICONS[tool.icon]}
          </button>
        ))}
      </div>

      <div style={styles.divider} />

      {/* Colors */}
      <div style={styles.group}>
        {COLORS.map(c => (
          <button
            key={c.key}
            onClick={() => onColorChange(c.value)}
            style={{
              ...styles.colorBtn,
              background: c.value,
              ...(drawColor === c.value ? styles.colorBtnActive : {}),
            }}
            title={c.key}
          />
        ))}
      </div>

      <div style={styles.divider} />

      {/* Stroke width */}
      <div style={styles.group}>
        {STROKE_WIDTHS.map(sw => (
          <button
            key={sw.key}
            onClick={() => onStrokeWidthChange(sw.value)}
            style={{
              ...styles.strokeBtn,
              ...(strokeWidth === sw.value ? styles.strokeBtnActive : {}),
            }}
            title={sw.key}
          >
            <div style={{
              width: '18px',
              height: `${Math.max(2, sw.value)}px`,
              background: strokeWidth === sw.value ? '#ffffff' : 'rgba(255,255,255,0.5)',
              borderRadius: '1px',
            }} />
          </button>
        ))}
      </div>

      <div style={styles.divider} />

      {/* Undo / Redo / Delete */}
      <div style={styles.group}>
        <button onClick={onUndo} style={styles.actionBtn} title="Undo (⌘Z)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 10h10a5 5 0 015 5v2" /><polyline points="3 10 7 6" /><polyline points="3 10 7 14" />
          </svg>
        </button>
        <button onClick={onRedo} style={styles.actionBtn} title="Redo (⌘⇧Z)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10H11a5 5 0 00-5 5v2" /><polyline points="21 10 17 6" /><polyline points="21 10 17 14" />
          </svg>
        </button>
        <button onClick={onDelete} style={styles.actionBtn} title="Delete selected (⌫)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
          </svg>
        </button>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Export */}
      <button
        onClick={isYouTube ? undefined : onExport}
        disabled={isExporting || isYouTube}
        style={{
          ...styles.exportBtn,
          ...(isExporting || isYouTube ? styles.exportBtnDisabled : {}),
        }}
        title={isYouTube ? 'Export unavailable for YouTube videos (cross-origin)' : 'Export annotated video'}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {isExporting ? 'Exporting…' : 'Export'}
      </button>
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
    overflowX: 'auto',
  },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  divider: {
    width: '1px',
    height: '24px',
    background: 'rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
  toolBtn: {
    background: 'none',
    border: '1px solid transparent',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: '7px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.12s, background 0.12s, border-color 0.12s',
  },
  toolBtnActive: {
    background: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.4)',
    color: '#a5b4fc',
  },
  colorBtn: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    border: '2px solid transparent',
    cursor: 'pointer',
    padding: 0,
    transition: 'border-color 0.12s, transform 0.12s',
    flexShrink: 0,
  },
  colorBtnActive: {
    borderColor: '#ffffff',
    transform: 'scale(1.15)',
  },
  strokeBtn: {
    background: 'none',
    border: '1px solid transparent',
    cursor: 'pointer',
    padding: '8px 6px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.12s, border-color 0.12s',
  },
  strokeBtnActive: {
    background: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.4)',
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.45)',
    cursor: 'pointer',
    padding: '7px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.12s',
  },
  exportBtn: {
    background: '#6366f1',
    border: 'none',
    color: '#ffffff',
    cursor: 'pointer',
    padding: '7px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'background 0.12s, opacity 0.12s',
    flexShrink: 0,
  },
  exportBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};
