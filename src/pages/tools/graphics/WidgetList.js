import React, { useMemo } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

export default function WidgetList({ widgets, selectedId, onPick }) {
  const byCategory = useMemo(() => {
    const out = new Map();
    for (const w of widgets) {
      if (!out.has(w.category)) out.set(w.category, []);
      out.get(w.category).push(w);
    }
    return Array.from(out.entries());
  }, [widgets]);

  return (
    <div style={styles.container}>
      <div style={styles.sectionLabel}>Widgets</div>
      {byCategory.map(([category, items]) => (
        <div key={category} style={styles.group}>
          <div style={styles.groupLabel}>{category}</div>
          {items.map((w) => {
            const active = w.id === selectedId;
            return (
              <button
                key={w.id}
                onClick={() => onPick(w)}
                style={{ ...styles.item, ...(active ? styles.itemActive : {}) }}
              >
                {w.name}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const styles = {
  container: {
    padding: `${spacing.md}px ${spacing.sm}px`,
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  },
  sectionLabel: {
    padding: `${spacing.xs}px ${spacing.sm}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  group: {
    marginTop: spacing.md,
  },
  groupLabel: {
    padding: `${spacing.xs}px ${spacing.sm}px`,
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textPlaceholder,
  },
  item: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: `${spacing.sm}px ${spacing.md}px`,
    margin: `${spacing.xs / 2}px 0`,
    fontSize: fontSizes.md,
    color: colors.textMuted,
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  itemActive: {
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
  },
};
