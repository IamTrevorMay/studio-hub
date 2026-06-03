import React, { useMemo } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { ELEMENT_TYPES } from './elementDefaults';

// Left rail. Lists every Scene element type the renderer supports,
// grouped by category. Clicking inserts a new element with the
// type's defaults; the caller wires that to setScene().

export default function BuilderCatalog({ onAdd }) {
  const groups = useMemo(() => {
    const out = new Map();
    for (const t of ELEMENT_TYPES) {
      if (!out.has(t.group)) out.set(t.group, []);
      out.get(t.group).push(t);
    }
    return Array.from(out.entries());
  }, []);

  return (
    <div style={styles.wrap}>
      <div style={styles.sectionLabel}>Add element</div>
      {groups.map(([group, items]) => (
        <div key={group} style={styles.group}>
          <div style={styles.groupLabel}>{group}</div>
          {items.map((t) => (
            <button
              key={t.type}
              onClick={() => onAdd(t.type)}
              style={styles.row}
              title={`Add ${t.label}`}
            >
              <span style={styles.plus}>+</span>
              <span style={styles.rowLabel}>{t.label}</span>
              <span style={styles.rowType}>{t.type}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

const styles = {
  wrap: {
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
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    width: '100%',
    padding: `${spacing.sm}px ${spacing.md}px`,
    margin: `${spacing.xs / 2}px 0`,
    fontSize: fontSizes.sm,
    color: colors.text,
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  plus: {
    flexShrink: 0,
    width: 18,
    color: colors.accentFg,
    fontWeight: fontWeights.bold,
    fontSize: fontSizes.md,
  },
  rowLabel: {
    flex: 1,
  },
  rowType: {
    fontSize: fontSizes.xxs,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: colors.textDim,
  },
};
