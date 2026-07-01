import React from 'react';

// Tiny trend line for KPI cards / platform cards. Shows shape only — the caller
// prints the actual number next to it (number answers "how much", sparkline
// answers "which way"). Decorative, so aria-hidden; the number carries meaning.
export default function Sparkline({ data, width = 96, height = 28, color = '#6366f1', strokeWidth = 1.5, fill = true }) {
  const vals = (data || []).map(Number).filter(v => !Number.isNaN(v));
  if (vals.length < 2) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const step = width / (vals.length - 1);
  const pts = vals.map((v, i) => [i * step, height - ((v - min) / range) * (height - 4) - 2]);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${width.toFixed(1)},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      {fill && <path d={area} fill={color} fillOpacity={0.12} />}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r={2} fill={color} />
    </svg>
  );
}
