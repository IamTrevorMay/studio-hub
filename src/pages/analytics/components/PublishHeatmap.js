import React, { useState } from 'react';
import { formatCompact } from '../utils';
import { analysisStyles } from '../styles';

export default function PublishHeatmap({ contentItems }) {
  const [hoveredCell, setHoveredCell] = useState(null);

  const grid = {};
  for (const item of contentItems) {
    if (!item.published_at) continue;
    const dt = new Date(item.published_at);
    const ptParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(dt);
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = dayMap[ptParts.find(p => p.type === 'weekday')?.value] ?? 0;
    const hour = parseInt(ptParts.find(p => p.type === 'hour')?.value, 10) || 0;
    const key = `${day}-${hour}`;
    if (!grid[key]) grid[key] = { count: 0, totalViews: 0 };
    grid[key].count += 1;
    const views = item.latest_metrics?.[0]?.views || 0;
    grid[key].totalViews += Number(views);
  }

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cellW = 28, cellH = 24, labelW = 36, labelH = 20;
  const W = labelW + 24 * cellW + 4;
  const H = labelH + 7 * cellH + 4;

  let maxAvg = 0;
  for (const cell of Object.values(grid)) {
    const avg = cell.count > 0 ? cell.totalViews / cell.count : 0;
    if (avg > maxAvg) maxAvg = avg;
  }

  function cellColor(day, hour) {
    const cell = grid[`${day}-${hour}`];
    if (!cell || cell.count === 0) return 'rgba(255,255,255,0.02)';
    const avg = cell.totalViews / cell.count;
    const intensity = maxAvg > 0 ? avg / maxAvg : 0;
    if (intensity < 0.25) return `rgba(99,102,241,${0.15 + intensity * 0.6})`;
    if (intensity < 0.5) return `rgba(139,92,246,${0.3 + intensity * 0.5})`;
    if (intensity < 0.75) return `rgba(245,158,11,${0.4 + intensity * 0.4})`;
    return `rgba(250,204,21,${0.5 + intensity * 0.4})`;
  }

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #8b5cf6' }}>
      <span style={{ ...analysisStyles.cardTitle, color: '#8b5cf6' }}>Best Publish Time</span>
      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: '4px 0 12px' }}>Average views by day of week and hour (Pacific). Brighter = more views.</p>
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '240px' }}>
          {/* Hour labels */}
          {Array.from({ length: 24 }, (_, h) => (
            <text key={h} x={labelW + h * cellW + cellW / 2} y={labelH - 4}
              fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="middle">{h}</text>
          ))}
          {/* Day labels + cells */}
          {dayLabels.map((label, d) => (
            <g key={d}>
              <text x={labelW - 6} y={labelH + d * cellH + cellH / 2 + 3}
                fill="rgba(255,255,255,0.4)" fontSize="10" textAnchor="end">{label}</text>
              {Array.from({ length: 24 }, (_, h) => {
                const cell = grid[`${d}-${h}`];
                return (
                  <rect key={h}
                    x={labelW + h * cellW + 1} y={labelH + d * cellH + 1}
                    width={cellW - 2} height={cellH - 2}
                    rx="3" fill={cellColor(d, h)}
                    stroke={hoveredCell === `${d}-${h}` ? 'rgba(255,255,255,0.4)' : 'transparent'}
                    strokeWidth="1"
                    onMouseEnter={() => setHoveredCell(`${d}-${h}`)}
                    onMouseLeave={() => setHoveredCell(null)}
                    style={{ cursor: 'default' }}
                  />
                );
              })}
            </g>
          ))}
        </svg>
        {hoveredCell && (() => {
          const [d, h] = hoveredCell.split('-').map(Number);
          const cell = grid[hoveredCell];
          const count = cell?.count || 0;
          const avg = count > 0 ? Math.round(cell.totalViews / count) : 0;
          return (
            <div style={{
              position: 'absolute', top: '4px', right: '8px',
              background: 'rgba(18,18,31,0.95)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px', padding: '8px 12px', pointerEvents: 'none',
              fontSize: '11px', color: 'rgba(255,255,255,0.6)',
            }}>
              <strong style={{ color: '#fff' }}>{dayLabels[d]} {h}:00 PT</strong>
              <br />{count} post{count !== 1 ? 's' : ''} — avg {formatCompact(avg)} views
            </div>
          );
        })()}
      </div>
    </div>
  );
}
