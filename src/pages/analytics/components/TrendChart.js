import React, { useState } from 'react';
import { formatCompact, toLocalDate } from '../utils';

export default function TrendChart({ data, metrics }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const W = 900, H = 280, PAD = { top: 20, right: 20, bottom: 40, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (!data.length) return null;

  const xStep = plotW / Math.max(data.length - 1, 1);

  // Compute per-metric max and build points
  const metricLines = metrics.map(m => {
    const values = data.map(d => m.getValue(d));
    const maxVal = Math.max(...values, 1);
    const points = data.map((d, i) => {
      const x = PAD.left + i * xStep;
      const y = PAD.top + plotH - ((m.getValue(d) / maxVal) * plotH);
      return { x, y };
    });

    // Split into segments at _gap boundaries
    const segments = [];
    let currentSeg = { points: [], startIdx: 0, interpolated: false };
    for (let i = 0; i < data.length; i++) {
      if (data[i]._gap) {
        // End current segment if it has points
        if (currentSeg.points.length > 0) {
          segments.push(currentSeg);
        }
        // Gap point is not drawn — creates a break
        currentSeg = { points: [], startIdx: i + 1, interpolated: false };
      } else {
        currentSeg.points.push(points[i]);
        if (data[i]._interpolated) currentSeg.interpolated = true;
      }
    }
    if (currentSeg.points.length > 0) segments.push(currentSeg);

    // Build path and area for each segment
    const segmentPaths = segments.map(seg => {
      const path = seg.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const areaPath = path + ` L${seg.points[seg.points.length - 1].x.toFixed(1)},${PAD.top + plotH} L${seg.points[0].x.toFixed(1)},${PAD.top + plotH} Z`;
      return { path, areaPath, interpolated: seg.interpolated };
    });

    // Also build the full path/area for backward compat (used by area fill)
    const fullPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const fullArea = fullPath + ` L${points[points.length - 1].x.toFixed(1)},${PAD.top + plotH} L${PAD.left},${PAD.top + plotH} Z`;

    return { ...m, values, maxVal, points, segmentPaths, fullArea };
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
  function formatMetricValue(m, val, idx) {
    if (m.formatValue) return m.formatValue(val);
    if (m.key === 'revenue') return '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (m.key === 'engagement') return val.toFixed(2) + '%';
    const formatted = formatCompact(val);
    if (idx != null && data[idx]?._interpolated) return formatted + ' (estimated)';
    return formatted;
  }

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      {metricLines.length > 1 && (
        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.42)', marginBottom: '2px' }}>
          Each line indexed to its own peak (100%) — hover for actual values.
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '300px' }}
        onMouseLeave={() => setHoveredIndex(null)}>
        {/* Grid lines + indexed y-axis (% of each line's own peak) */}
        {gridYs.map((y, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.left - 8} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.42)" fontSize="10">{i * 25}%</text>
          </g>
        ))}
        {/* X-axis labels */}
        {data.map((d, i) => {
          if (data.length <= 8) { /* show all */ }
          else if (i !== 0 && i !== data.length - 1 && i % tickInterval !== 0) return null;
          const x = PAD.left + i * xStep;
          return (
            <text key={i} x={x} y={H - 8} fill="rgba(255,255,255,0.42)" fontSize="10" textAnchor="middle">
              {formatDateLabel(d.date)}
            </text>
          );
        })}
        {/* Area fills and lines for each metric, split at gaps */}
        {metricLines.map(m => (
          <g key={m.key}>
            {m.segmentPaths.map((seg, si) => (
              <g key={si}>
                <path d={seg.areaPath} fill={m.color + (seg.interpolated ? '08' : '10')} />
                <path
                  d={seg.path}
                  fill="none"
                  stroke={m.color}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  opacity={seg.interpolated ? 0.5 : (hoveredIndex !== null ? 0.7 : 1)}
                  strokeDasharray={seg.interpolated ? '4,3' : 'none'}
                />
              </g>
            ))}
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
            r="3.5" fill={m.color} stroke="#161d2b" strokeWidth="1.5" />
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
          background: '#161d2b', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '8px', padding: '10px 14px', zIndex: 10, pointerEvents: 'none',
          minWidth: '140px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', marginBottom: '6px', fontWeight: 600 }}>
            {toLocalDate(data[hoveredIndex].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {data[hoveredIndex]._interpolated && (
              <span style={{ color: '#f59e0b', marginLeft: 6, fontStyle: 'italic' }}>(estimated)</span>
            )}
            {data[hoveredIndex]._gap && (
              <span style={{ color: '#ef4444', marginLeft: 6, fontStyle: 'italic' }}>(no data)</span>
            )}
          </div>
          {metricLines.map(m => (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: m.color, flexShrink: 0 }} />
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', minWidth: '70px' }}>{m.label}</span>
              <span style={{ fontSize: '12px', color: '#e7ebf2', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {formatMetricValue(m, m.values[hoveredIndex], hoveredIndex)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
