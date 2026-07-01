import React, { useState } from 'react';
import { formatCompact } from '../utils';
import ChartTooltip from '../viz/ChartTooltip';

export default function DonutChart({ data, valueKey = 'views', centerLabel = 'total views', formatValue }) {
  const [hovered, setHovered] = useState(null);
  const size = 160;
  const cx = size / 2, cy = size / 2;
  const outerR = 70, innerR = 45;
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0);
  if (total === 0) return null;

  let cumAngle = -Math.PI / 2;
  const segments = data.map(d => {
    const val = d[valueKey] || 0;
    const angle = (val / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;

    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);
    const x3 = cx + innerR * Math.cos(endAngle);
    const y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle);
    const y4 = cy + innerR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const path = `M${x1},${y1} A${outerR},${outerR} 0 ${largeArc},1 ${x2},${y2} L${x3},${y3} A${innerR},${innerR} 0 ${largeArc},0 ${x4},${y4} Z`;
    return { ...d, val, path, pct: (val / total) * 100 };
  });

  const centerText = formatValue ? formatValue(total) : formatCompact(total);
  const fmt = (v) => (formatValue ? formatValue(v) : formatCompact(v));
  const ariaLabel = `${centerLabel}: ${centerText}. ` +
    segments.map(s => `${s.label} ${s.pct.toFixed(0)} percent`).join(', ');

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}
        onMouseLeave={() => setHovered(null)}>
        {segments.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="#12121f" strokeWidth="1"
            opacity={hovered === null || hovered === i ? 1 : 0.35}
            onMouseEnter={() => setHovered(i)}
            style={{ transition: 'opacity 0.15s', cursor: 'default' }} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700">{centerText}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">{centerLabel}</text>
      </svg>
      {hovered !== null && segments[hovered] && (
        <ChartTooltip leftPct={50} flip={false} top={-4}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: segments[hovered].color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{segments[hovered].label}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(segments[hovered].val)}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>({segments[hovered].pct.toFixed(1)}%)</span>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}
