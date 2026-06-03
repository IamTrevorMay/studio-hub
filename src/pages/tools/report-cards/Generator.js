import React from 'react';
import { colors, spacing, fontSizes } from '../../../lib/styleTokens';

// 3A scaffold — real Generator (template list + populate + preview +
// export) lands in step 3D.

export default function Generator() {
  return (
    <div style={styles.wrap}>
      <div style={styles.title}>Generator</div>
      <div style={styles.body}>Template list + populate + export lands in step 3D.</div>
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
