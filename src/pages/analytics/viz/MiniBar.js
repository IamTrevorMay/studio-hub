import React from 'react';
import { radii } from '../../../lib/styleTokens';

// Horizontal bar with the value printed on it — the number+shape combo.
// Used for ranked lists (Format, RPM, engagement) and inline table cells.
// `refPct` optionally draws a benchmark marker (e.g. blended average).
export default function MiniBar({
  value, max, color = '#3d6ea5', label,
  height = 20, width = '100%', showTrack = true, refPct = null, refColor = 'rgba(38,48,67,0.45)',
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={{
      position: 'relative', width, height, borderRadius: radii.xs, overflow: 'hidden',
      background: showTrack ? 'rgba(38,48,67,0.07)' : 'transparent',
    }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, opacity: 0.85, borderRadius: radii.xs, transition: 'width 0.3s ease' }} />
      {refPct != null && (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${Math.max(0, Math.min(100, refPct))}%`, width: 1, background: refColor }} />
      )}
      {label != null && (
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 700, color: '#263043', fontVariantNumeric: 'tabular-nums' }}>
          {label}
        </span>
      )}
    </div>
  );
}
