import React, { useState } from 'react';
import { formatCompact, toLocalDate } from '../utils';

export default function TrendChart({ data, metrics }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const W = 900, H = 280, PAD = { top: 20, right: 20, bottom: 40, left: 20 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (!data.length) return null;

  const xStep = plotW / Math.max(data.length - 1, 1);

  // Compute per-metric max and build paths
  const metricLines = metrics.map(m => {
    const values = data.map(d => m.getValue(d));
    const maxVal = Math.max(...values, 1);
    const points = data.map((d, i) => {
      const x = PAD.left + i * xStep;
      const y = PAD.top + plotH - ((m.getValue(d) / maxVal) * plotH);
      return { x, y };
    });
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = path + ` L${points[points.length - 1].x.toFixed(1)},${PAD.top + plotH} L${PAD.left},${PAD.top + plotH} Z`;
    return { ...m, values, maxVal, points, path, areaPath };
  });

  // Dynamic x-axis date formatting
  const totalDays = data.length > 1
    ? Math.ceil((toLocalDate(data[data.length - 1].date) - toLocalDate(data[0].date)) / 86400000)
    : 1;
  function formatDateLabel(dateStr) {
    const d = toLocalDate(dateStr);
    if (totalDays <= 31) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    const yr = String(d.getFullYear()).slice(2);
    return d.toLocaleDateString('en-US', { month: 'short' }) + " '" + yr;
  }

  const tickCount = Math.min(data.length, 8);
  const tickInterval = Math.max(1, Math.floor((data.length - 1) / (tickCount - 1)));

  // Grid lines
  const gridLines = 4;
  const gridYs = Array.from({ length: gridLines + 1 }, (_, i) => PAD.top + plotH - (plotH / gridLines) * i);

  // Tooltip formatter
  function formatMetricValue(m, val) {
    if (m.formatValue) return m.formatValue(val);
    if (m.key === 'revenue') return '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (m.key === 'engagement') return val.toFixed(2) + '%';
    return formatCompact(val);
  }

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '300px' }}
        onMouseLeave={() => setHoveredIndex(null)}>
        {/* Grid lines */}
        {gridYs.map((y, i) => (
          <line key={i} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.05)" />
        ))}
        {/* X-axis labels */}
        {data.map((d, i) => {
          if (data.length <= 8) { /* show all */ }
          else if (i !== 0 && i !== data.length - 1 && i % tickInterval !== 0) return null;
          const x = PAD.left + i * xStep;
          return (
            <text key={i} x={x} y={H - 8} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle">
              {formatDateLabel(d.date)}
            </text>
          );
        })}
        {/* Area fills and lines for each metric */}
        {metricLines.map(m => (
          <g key={m.key}>
            <path d={m.areaPath} fill={m.color + '10'} />
            <path d={m.path} fill="none" stroke={m.color} strokeWidth="1.5" strokeLinejoin="round" opacity={hoveredIndex !== null ? 0.7 : 1} />
          </g>
        ))}
        {/* Hover guide line */}
        {hoveredIndex !== null && (
          <line
            x1={PAD.left + hoveredIndex * xStep} y1={PAD.top}
            x2={PAD.left + hoveredIndex * xStep} y2={PAD.top + plotH}
            stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4,3"
          />
        )}
        {/* Hover dots */}
        {hoveredIndex !== null && metricLines.map(m => (
          <circle key={m.key} cx={m.points[hoveredIndex].x} cy={m.points[hoveredIndex].y}
            r="3.5" fill={m.color} stroke="#12121f" strokeWidth="1.5" />
        ))}
        {/* Invisible hover rects */}
        {data.map((d, i) => {
          const x = PAD.left + i * xStep - xStep / 2;
          return (
            <rect key={i} x={Math.max(x, 0)} y={PAD.top} width={xStep} height={plotH}
              fill="transparent" onMouseEnter={() => setHoveredIndex(i)} />
          );
        })}
      </svg>
      {/* Tooltip */}
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
            {toLocalDate(data[hoveredIndex].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
