import React from 'react';
import { colors, radii, spacing, fontSizes } from '../../../lib/styleTokens';

// Consistent empty state for any chart slot. Charts should render this instead
// of returning null, so sections keep their footprint and the layout doesn't
// jump as data streams in.
export default function EmptyChart({ label = 'No data for this range yet.', height = 120, accent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      minHeight: height, padding: spacing.xxl, borderRadius: radii.xl,
      border: `1px dashed ${colors.border}`, background: colors.bgRaised,
      color: colors.textPlaceholder, fontSize: fontSizes.sm,
      ...(accent ? { borderLeft: `3px solid ${accent}` } : {}),
    }}>
      {label}
    </div>
  );
}
