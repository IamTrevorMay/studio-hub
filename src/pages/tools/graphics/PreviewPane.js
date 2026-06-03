import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

const SIZE_PRESETS = [
  { width: 1080, height: 1080, label: '1:1 Square' },
  { width: 1080, height: 1920, label: '9:16 Story' },
  { width: 1920, height: 1080, label: '16:9 Landscape' },
  { width: 1200, height: 630,  label: '1200x630 OG' },
];

// 2E will wire this to imagine-render. Today it just shows the empty state
// + size picker so the layout is reviewable.

export default function PreviewPane({ widget, filters, size, onSizeChange }) {
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
        ) : (
          <div style={styles.placeholder}>
            <div style={styles.placeholderTitle}>{widget.name}</div>
            <div style={styles.placeholderBody}>
              Live preview wires up in step 2E. Filter state is logged in
              the right rail.
            </div>
          </div>
        )}
      </div>
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
    fontSize: fontSizes.xs,
    color: colors.textDim,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
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
  placeholder: {
    width: 400,
    minHeight: 400,
    padding: spacing.xxl,
    background: colors.bgRaised,
    border: `1px dashed ${colors.borderStrong}`,
    borderRadius: radii.lg,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  placeholderTitle: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  placeholderBody: {
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    lineHeight: 1.6,
  },
};
