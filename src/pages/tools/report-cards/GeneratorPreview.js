import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

// Center pane of the Generator. Just shows the PNG that the Generator
// got back from /api/imagine-render. Errors + loading mirror the
// Graphics tool's PreviewPane shape.

export default function GeneratorPreview({
  template,
  scene,
  previewUrl,
  previewLoading,
  previewError,
}) {
  if (!template) {
    return (
      <div style={styles.wrap}>
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>Pick a template</div>
          <div style={styles.emptyBody}>
            Choose one on the left to preview a render.
          </div>
        </div>
      </div>
    );
  }
  if (previewError) {
    return (
      <div style={styles.wrap}>
        <div style={styles.errorCard}>
          <div style={styles.errorTitle}>Render failed</div>
          <div style={styles.errorBody}>{previewError}</div>
        </div>
      </div>
    );
  }

  const w = scene ? scene.width : template.width;
  const h = scene ? scene.height : template.height;
  const aspect = w && h ? w / h : 1;
  const longSide = 720;
  const fitW = aspect >= 1 ? longSide : Math.round(longSide * aspect);
  const fitH = aspect >= 1 ? Math.round(longSide / aspect) : longSide;

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        <div style={styles.meta}>
          {template.name || 'Untitled'} · {w}×{h}
          {previewLoading && <span style={styles.spinner}>rendering…</span>}
        </div>
      </div>
      <div style={styles.center}>
        <div style={{
          ...styles.frame,
          width: fitW,
          height: fitH,
          opacity: previewLoading ? 0.6 : 1,
        }}>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={template.name || 'preview'}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <div style={styles.frameEmpty}>
              {previewLoading ? 'Rendering…' : 'Click Populate to render the first preview.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    background: colors.bg,
  },
  toolbar: {
    height: 40,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bgRaised,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    fontSize: fontSizes.xs,
    color: colors.textDim,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  spinner: { color: colors.accentFg },
  center: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'auto',
    padding: spacing.xxl,
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
    textAlign: 'center',
    padding: spacing.lg,
    fontSize: fontSizes.sm,
    color: colors.textPlaceholder,
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: spacing.xxl,
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
    maxWidth: 320,
    lineHeight: 1.6,
  },
  errorCard: {
    maxWidth: 420,
    margin: 'auto',
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
