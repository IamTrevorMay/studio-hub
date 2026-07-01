import React from 'react';
import { L } from '../styles';

// Consistent empty state for any chart slot. Charts render this instead of
// returning null, so sections keep their footprint and the layout doesn't jump.
export default function EmptyChart({ label = 'No data for this range yet.', height = 120, accent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      minHeight: height, padding: '24px', borderRadius: '14px',
      border: `1px dashed ${L.borderStrong}`, background: L.cardAlt,
      color: L.inkSubtle, fontSize: '13px',
      ...(accent ? { borderLeft: `3px solid ${accent}` } : {}),
    }}>
      {label}
    </div>
  );
}
