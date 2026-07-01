import React from 'react';
import { radii } from '../../../lib/styleTokens';

// Loading placeholder. Uses the global `pulse` keyframe (App.js). Prefer this
// over a bare "Loading…" line so the page keeps its shape while data streams.
export default function Skeleton({ height = 16, width = '100%', radius = radii.sm, style }) {
  return (
    <div style={{
      height, width, borderRadius: radius,
      background: 'rgba(255,255,255,0.05)',
      animation: 'pulse 1.4s ease-in-out infinite',
      ...style,
    }} />
  );
}
