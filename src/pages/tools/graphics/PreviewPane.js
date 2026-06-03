import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

const SIZE_PRESETS = [
  { width: 1080, height: 1080, label: '1:1 Square' },
  { width: 1080, height: 1920, label: '9:16 Story' },
  { width: 1920, height: 1080, label: '16:9 Landscape' },
  { width: 1200, height: 630,  label: '1200x630 OG' },
];

// Center pane. Shows the rendered preview from imagine-render, plus
// loading + error states. The render call lives in Layout.js so the
// blob URL persists across pane unmounts (e.g. window resizes).

export default function PreviewPane({
  widget,
  size,
  onSizeChange,
  previewUrl,
  previewLoading,
  previewError,
  previewIsStub,
}) {
  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <div style={styles.sizeGroup}>
          {SIZE_PRESETS.map((preset) => {
            const active = preset.label === size.label;
            return (
              <button
                key={preset.label}
                onClick={() => onSizeChange(preset)}
                style={{ ...styles.sizeBtn, ...(active ? styles.sizeBtnActive : {}) }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div style={styles.sizeMeta}>
          {size.width} × {size.height}
          {previewLoading && <span style={styles.spinner}>rendering…</span>}
          {previewIsStub && !previewLoading && !previewError && (
            <span style={styles.stubBadge}>stub PNG (Phase 2F adds real renderer)</span>
          )}
        </div>
      </div>

      <div style={styles.previewWrap}>
        {!widget ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>Pick a widget</div>
            <div style={styles.emptyBody}>
              Choose from the list on the left to preview a render.
            </div>
          </div>
        ) : previewError ? (
          <div style={styles.errorCard}>
            <div style={styles.errorTitle}>Render failed</div>
            <div style={styles.errorBody}>{previewError}</div>
          </div>
        ) : (
          <PreviewFrame
            url={previewUrl}
            size={size}
            widget={widget}
            isStub={previewIsStub}
            loading={previewLoading}
          />
        )}
      </div>
    </div>
  );
}

function PreviewFrame({ url, size, widget, isStub, loading }) {
  // Fit the canvas into the available wrap while preserving aspect ratio.
  // The CSS aspectRatio handles sizing; max dimensions cap it at 720 on
  // the longer side so very tall sizes (9:16) don't blow past the viewport.
  const aspect = size.width / size.height;
  const longSide = 720;
  const fitW = aspect >= 1 ? longSide : Math.round(longSide * aspect);
  const fitH = aspect >= 1 ? Math.round(longSide / aspect) : longSide;

  return (
    <div
      style={{
        ...styles.frame,
        width: fitW,
        height: fitH,
        opacity: loading ? 0.6 : 1,
      }}
    >
      {url ? (
        <img
          src={url}
          alt={widget?.name || 'preview'}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'contain',
            background: isStub ? colors.accentSoft : 'transparent',
            borderRadius: radii.lg,
          }}
        />
      ) : (
        <div style={styles.frameEmpty}>Waiting for first render…</div>
      )}
      {isStub && url && (
        <div style={styles.stubOverlay}>
          <div style={styles.stubOverlayTitle}>{widget?.name}</div>
          <div style={styles.stubOverlayBody}>
            Stub PNG returned by edge fn. Real scene rendering lands in 2F.
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  toolbar: {
    height: 48,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `0 ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bgRaised,
  },
  sizeGroup: {
    display: 'flex',
    gap: spacing.xs,
  },
  sizeBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    color: colors.textMuted,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  sizeBtnActive: {
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
  },
  sizeMeta: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    fontSize: fontSizes.xs,
    color: colors.textDim,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  spinner: {
    color: colors.accentFg,
  },
  stubBadge: {
    padding: `2px ${spacing.sm}px`,
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
    borderRadius: radii.pill,
    fontSize: fontSizes.xxs,
    letterSpacing: 0.3,
    fontFamily: 'inherit',
  },
  previewWrap: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    overflow: 'auto',
  },
  empty: {
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyTitle: {
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.semibold,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  emptyBody: {
    fontSize: fontSizes.md,
    color: colors.textPlaceholder,
    lineHeight: 1.6,
  },
  frame: {
    position: 'relative',
    background: colors.bgRaised,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.lg,
    overflow: 'hidden',
    transition: 'opacity 120ms ease-out',
  },
  frameEmpty: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: fontSizes.sm,
    color: colors.textPlaceholder,
  },
  stubOverlay: {
    position: 'absolute',
    inset: spacing.lg,
    padding: spacing.lg,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    background: colors.bgOverlay,
    borderRadius: radii.md,
    pointerEvents: 'none',
  },
  stubOverlayTitle: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  stubOverlayBody: {
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    lineHeight: 1.5,
  },
  errorCard: {
    maxWidth: 420,
    padding: spacing.xl,
    textAlign: 'center',
    background: colors.danger?.bg || 'rgba(239,68,68,0.15)',
    border: `1px solid ${colors.danger?.border || 'rgba(239,68,68,0.35)'}`,
    borderRadius: radii.md,
  },
  errorTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.danger?.fg || '#ef4444',
    marginBottom: spacing.sm,
  },
  errorBody: {
    fontSize: fontSizes.sm,
    color: colors.text,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
};
