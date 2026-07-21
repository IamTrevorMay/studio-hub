// Shared SVG chart primitives. Lifted from Analytics.js so Expenses (and
// any future admin views) can reuse the same look without duplicating code.
// Analytics.js still has its own copies for now; safe to migrate later.

import React, { useState } from 'react';

export function formatCompact(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function toLocalDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function DonutChart({ data, valueKey = 'value', centerLabel = 'total', formatValue }) {
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
        <path key={i} d={s.path} fill={s.color} stroke="#0e1420" strokeWidth="1" />
      ))}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700">{centerText}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">{centerLabel}</text>
    </svg>
  );
}

// TrendChart expects `data[i].date` as a YYYY-MM-DD or YYYY-MM-01 string and a
// `metrics` array where each entry has { key, label, color, getValue, formatValue? }.
// `sharedScale` (default false) puts every metric on a single y-axis spanning the
// combined min..max. Required when metrics include negatives (e.g. Net = revenue
// minus expenses) or when cross-series comparison matters. Default keeps the old
// per-metric auto-scale used by Analytics where Views and Revenue share a chart
// but have wildly different units.
export function TrendChart({ data, metrics, height = 280, sharedScale = false }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const W = 900, H = height, PAD = { top: 20, right: 20, bottom: 40, left: 20 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (!data.length) return null;

  const xStep = plotW / Math.max(data.length - 1, 1);

  let sharedMin = 0, sharedMax = 1, sharedZeroY = null;
  if (sharedScale) {
    const allValues = [];
    for (const m of metrics) for (const d of data) allValues.push(m.getValue(d));
    sharedMin = Math.min(0, ...allValues);
    sharedMax = Math.max(0, ...allValues, 1);
    if (sharedMax === sharedMin) sharedMax = sharedMin + 1;
    sharedZeroY = PAD.top + plotH - ((0 - sharedMin) / (sharedMax - sharedMin)) * plotH;
  }

  const metricLines = metrics.map(m => {
    const values = data.map(d => m.getValue(d));
    const maxVal = Math.max(...values, 1);
    const points = data.map((d, i) => {
      const x = PAD.left + i * xStep;
      const v = m.getValue(d);
      const y = sharedScale
        ? PAD.top + plotH - ((v - sharedMin) / (sharedMax - sharedMin)) * plotH
        : PAD.top + plotH - ((v / maxVal) * plotH);
      return { x, y };
    });
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaBaseY = sharedScale ? sharedZeroY : (PAD.top + plotH);
    const areaPath = path + ` L${points[points.length - 1].x.toFixed(1)},${areaBaseY} L${PAD.left},${areaBaseY} Z`;
    return { ...m, values, maxVal, points, path, areaPath };
  });

  const totalDays = data.length > 1
    ? Math.ceil((toLocalDate(data[data.length - 1].date) - toLocalDate(data[0].date)) / 86400000)
    : 1;
  function formatDateLabel(dateStr) {
    const d = toLocalDate(dateStr);
    if (!d) return dateStr;
    if (totalDays <= 31) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    const yr = String(d.getFullYear()).slice(2);
    return d.toLocaleDateString('en-US', { month: 'short' }) + " '" + yr;
  }

  const tickCount = Math.min(data.length, 8);
  const tickInterval = Math.max(1, Math.floor((data.length - 1) / (tickCount - 1)));

  const gridLines = 4;
  const gridYs = Array.from({ length: gridLines + 1 }, (_, i) => PAD.top + plotH - (plotH / gridLines) * i);

  function formatMetricValue(m, val) {
    if (m.formatValue) return m.formatValue(val);
    return formatCompact(val);
  }

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: `${height + 20}px` }}
        onMouseLeave={() => setHoveredIndex(null)}>
        {gridYs.map((y, i) => (
          <line key={i} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.05)" />
        ))}
        {sharedScale && sharedMin < 0 && (
          <line x1={PAD.left} y1={sharedZeroY} x2={W - PAD.right} y2={sharedZeroY}
            stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3,3" />
        )}
        {data.map((d, i) => {
          if (data.length > 8 && i !== 0 && i !== data.length - 1 && i % tickInterval !== 0) return null;
          const x = PAD.left + i * xStep;
          return (
            <text key={i} x={x} y={H - 8} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle">
              {formatDateLabel(d.date)}
            </text>
          );
        })}
        {metricLines.map(m => (
          <g key={m.key}>
            <path d={m.areaPath} fill={m.color + '10'} />
            <path d={m.path} fill="none" stroke={m.color} strokeWidth="1.5" strokeLinejoin="round" opacity={hoveredIndex !== null ? 0.7 : 1} />
          </g>
        ))}
        {hoveredIndex !== null && (
          <line
            x1={PAD.left + hoveredIndex * xStep} y1={PAD.top}
            x2={PAD.left + hoveredIndex * xStep} y2={PAD.top + plotH}
            stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4,3"
          />
        )}
        {hoveredIndex !== null && metricLines.map(m => (
          <circle key={m.key} cx={m.points[hoveredIndex].x} cy={m.points[hoveredIndex].y}
            r="3.5" fill={m.color} stroke="#0e1420" strokeWidth="1.5" />
        ))}
        {data.map((d, i) => {
          const x = PAD.left + i * xStep - xStep / 2;
          return (
            <rect key={i} x={Math.max(x, 0)} y={PAD.top} width={xStep} height={plotH}
              fill="transparent" onMouseEnter={() => setHoveredIndex(i)} />
          );
        })}
      </svg>
      {hoveredIndex !== null && (
        <div style={{
          position: 'absolute',
          top: '8px',
          left: `${((PAD.left + hoveredIndex * xStep) / W) * 100}%`,
          transform: hoveredIndex > data.length * 0.7 ? 'translateX(-110%)' : 'translateX(10px)',
          background: 'rgba(18,18,31,0.95)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '8px', padding: '10px 14px', zIndex: 10, pointerEvents: 'none',
          minWidth: '140px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px', fontWeight: 600 }}>
            {(() => {
              const d = toLocalDate(data[hoveredIndex].date);
              return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : data[hoveredIndex].date;
            })()}
          </div>
          {metricLines.map(m => (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: m.color, flexShrink: 0 }} />
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', minWidth: '70px' }}>{m.label}</span>
              <span style={{ fontSize: '12px', color: '#fff', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {formatMetricValue(m, m.values[hoveredIndex])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
