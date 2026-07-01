import React from 'react';

// Positioned tooltip container shared by hover charts. Parent must be
// position:relative. `leftPct` is the horizontal anchor (0..100); it auto-flips
// to the left when near the right edge so it never clips.
export default function ChartTooltip({ leftPct = 0, top = 8, flip, children }) {
  return (
    <div style={{
      position: 'absolute', top, left: `${leftPct}%`,
      transform: flip ? 'translateX(-110%)' : 'translateX(10px)',
      background: 'rgba(18,18,31,0.95)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 8, padding: '10px 14px', pointerEvents: 'none', zIndex: 10,
      minWidth: 140, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    }}>
      {children}
    </div>
  );
}
