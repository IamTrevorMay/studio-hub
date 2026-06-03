import React from 'react';
import { colors, spacing, fontSizes } from '../../../lib/styleTokens';

// 3A scaffold — real Builder (canvas + element catalog + properties panel
// + undo/redo + save/load) lands in 3C.

export default function Builder() {
  return (
    <div style={styles.wrap}>
      <div style={styles.title}>Builder</div>
      <div style={styles.body}>Drag-and-drop scene editor lands in step 3C.</div>
    </div>
  );
}

const styles = {
  wrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    textAlign: 'center',
  },
  title: {
    fontSize: fontSizes.xxl,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: fontSizes.md,
    color: colors.textPlaceholder,
  },
};
