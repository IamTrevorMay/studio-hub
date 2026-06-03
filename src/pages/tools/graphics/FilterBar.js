import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

// Placeholder filter bar. 2C will swap this for a schema-driven renderer
// (default) plus per-widget panel components registered via panelRegistry.

export default function FilterBar({ widget, filters, onFiltersChange }) {
  if (!widget) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>Pick a widget to see its filters.</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.label}>Filters</div>
      <div style={styles.widgetTitle}>{widget.name}</div>
      <div style={styles.placeholder}>
        Per-widget filter UI lands in step 2C.
      </div>
      <div style={styles.devBlock}>
        <div style={styles.devLabel}>Filter state</div>
        <pre style={styles.pre}>{JSON.stringify(filters, null, 2)}</pre>
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: `${spacing.md}px ${spacing.lg}px`,
  },
  empty: {
    padding: spacing.md,
    fontSize: fontSizes.sm,
    color: colors.textPlaceholder,
  },
  label: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  widgetTitle: {
    marginTop: spacing.sm,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  placeholder: {
    marginTop: spacing.md,
    padding: spacing.md,
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    background: colors.bgInput,
    border: `1px dashed ${colors.borderStrong}`,
    borderRadius: radii.md,
  },
  devBlock: {
    marginTop: spacing.xl,
  },
  devLabel: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textPlaceholder,
    marginBottom: spacing.xs,
  },
  pre: {
    margin: 0,
    padding: spacing.sm,
    fontSize: fontSizes.xs,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: colors.textMuted,
    background: colors.bgInput,
    borderRadius: radii.sm,
    overflowX: 'auto',
  },
};
