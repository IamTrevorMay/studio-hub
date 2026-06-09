import React from 'react';
import { formatCompact } from '../utils';

export default function DonutChart({ data, valueKey = 'views', centerLabel = 'total views', formatValue }) {
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
    return { ...d, path };
  });

  const centerText = formatValue ? formatValue(total) : formatCompact(total);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((s, i) => (
        <path key={i} d={s.path} fill={s.color} stroke="#12121f" strokeWidth="1" />
      ))}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700">{centerText}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">{centerLabel}</text>
    </svg>
  );
}
