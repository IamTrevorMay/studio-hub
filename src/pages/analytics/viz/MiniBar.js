import React from 'react';
import { radii } from '../../../lib/styleTokens';

// Horizontal bar with the value printed on it — the number+shape combo.
// Used for ranked lists (Format, RPM, engagement) and inline table cells.
// `refPct` optionally draws a benchmark marker (e.g. blended average).
export default function MiniBar({
  value, max, color = '#6366f1', label,
  height = 20, width = '100%', showTrack = true, refPct = null, refColor = 'rgba(255,255,255,0.5)',
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={{
      position: 'relative', width, height, borderRadius: radii.xs, overflow: 'hidden',
      background: showTrack ? 'rgba(255,255,255,0.03)' : 'transparent',
    }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, opacity: 0.78, borderRadius: radii.xs, transition: 'width 0.3s ease' }} />
      {refPct != null && (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${Math.max(0, Math.min(100, refPct))}%`, width: 1, background: refColor }} />
      )}
      {label != null && (
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
          {label}
        </span>
      )}
    </div>
  );
}
