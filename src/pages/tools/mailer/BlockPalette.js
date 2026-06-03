import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { getAllBlocks } from '../../../lib/emails/blockRegistry';

// Left pane: list of insertable block types grouped by category. Clicking
// one calls onAdd(type). Tiny on purpose — no icons besides the type
// label. Drag/drop deferred; click-to-append + reorder buttons cover MVP.

const CATEGORY_ORDER = ['content', 'layout', 'interactive', 'data'];
const CATEGORY_LABEL = {
  content: 'Content',
  layout: 'Layout',
  interactive: 'Interactive',
  data: 'Data',
};

export default function BlockPalette({ onAdd }) {
  const all = getAllBlocks();
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    blocks: all.filter((b) => b.category === cat),
  }));

  return (
    <div style={styles.wrap}>
      <div style={styles.heading}>Blocks</div>
      {grouped.map(({ cat, blocks }) => (
        <div key={cat} style={styles.group}>
          <div style={styles.groupLabel}>{CATEGORY_LABEL[cat]}</div>
          <div style={styles.list}>
            {blocks.map((b) => (
              <button key={b.type} onClick={() => onAdd(b.type)} style={styles.item} title={b.description}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  wrap: {
    width: 200, flexShrink: 0, overflow: 'auto',
    padding: spacing.md, borderRight: `1px solid ${colors.border}`,
    background: colors.bgRaised,
    display: 'flex', flexDirection: 'column', gap: spacing.md,
  },
  heading: {
    fontSize: fontSizes.xs, fontWeight: fontWeights.bold,
    color: colors.textSubtle, letterSpacing: '0.08em', textTransform: 'uppercase',
    paddingBottom: spacing.xs, borderBottom: `1px solid ${colors.border}`,
  },
  group: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  groupLabel: { fontSize: fontSizes.xxs, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.06em' },
  list: { display: 'flex', flexDirection: 'column', gap: 4 },
  item: {
    padding: `${spacing.sm}px ${spacing.md}px`,
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    color: colors.text,
    fontSize: fontSizes.sm,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
};
