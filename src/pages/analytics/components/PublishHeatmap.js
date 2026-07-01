import React, { useState } from 'react';
import { formatCompact } from '../utils';
import { analysisStyles } from '../styles';
import { sequential } from '../viz';

// Best publish time by day-of-week × daypart. Hourly (24-col) buckets were too
// sparse for real posting cadence, so we bin into six 4-hour dayparts and shade
// with a single-hue ramp (perceptually ordered, unlike a multi-hue scale).

const DAYPARTS = [
  { label: '12–4a', start: 0 },
  { label: '4–8a', start: 4 },
  { label: '8a–12p', start: 8 },
  { label: '12–4p', start: 12 },
  { label: '4–8p', start: 16 },
  { label: '8p–12a', start: 20 },
];
const partIndex = (hour) => Math.min(5, Math.floor(hour / 4));

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
    const key = `${day}-${partIndex(hour)}`;
    if (!grid[key]) grid[key] = { count: 0, totalViews: 0 };
    grid[key].count += 1;
    grid[key].totalViews += Number(item.latest_metrics?.[0]?.views || 0);
  }

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cellW = 96, cellH = 30, labelW = 40, labelH = 22, gap = 3;
  const cols = DAYPARTS.length;
  const W = labelW + cols * (cellW + gap);
  const H = labelH + 7 * (cellH + gap);

  let maxAvg = 0;
  for (const cell of Object.values(grid)) {
    const avg = cell.count > 0 ? cell.totalViews / cell.count : 0;
    if (avg > maxAvg) maxAvg = avg;
  }

  function cellFill(day, part) {
    const cell = grid[`${day}-${part}`];
    if (!cell || cell.count === 0) return 'rgba(255,255,255,0.02)';
    const avg = cell.totalViews / cell.count;
    return sequential(maxAvg > 0 ? avg / maxAvg : 0);
  }

  const hasData = Object.keys(grid).length > 0;

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #8b5cf6' }}>
      <div style={analysisStyles.cardHeader}>
        <span style={{ ...analysisStyles.cardTitle, color: '#8b5cf6' }}>Best Publish Time</span>
        {/* Color key */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          <span>fewer views</span>
          <span style={{ width: 72, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${sequential(0.05)}, ${sequential(1)})` }} />
          <span>more</span>
        </div>
      </div>
      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: '4px 0 12px' }}>Average views by day of week and daypart (Pacific).</p>
      {!hasData ? (
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Not enough published content to map publish times yet.</p>
      ) : (
        <div style={{ overflowX: 'auto', position: 'relative' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, maxHeight: '260px' }}>
            {/* Daypart labels */}
            {DAYPARTS.map((dp, c) => (
              <text key={c} x={labelW + c * (cellW + gap) + cellW / 2} y={labelH - 6}
                fill="rgba(255,255,255,0.4)" fontSize="10" textAnchor="middle">{dp.label}</text>
            ))}
            {/* Day rows */}
            {dayLabels.map((label, d) => (
              <g key={d}>
                <text x={labelW - 8} y={labelH + d * (cellH + gap) + cellH / 2 + 3}
                  fill="rgba(255,255,255,0.4)" fontSize="10" textAnchor="end">{label}</text>
                {DAYPARTS.map((dp, c) => {
                  const cell = grid[`${d}-${c}`];
                  const active = hoveredCell === `${d}-${c}`;
                  return (
                    <rect key={c}
                      x={labelW + c * (cellW + gap)} y={labelH + d * (cellH + gap)}
                      width={cellW} height={cellH} rx="4" fill={cellFill(d, c)}
                      stroke={active ? 'rgba(255,255,255,0.5)' : 'transparent'} strokeWidth="1.5"
                      onMouseEnter={() => setHoveredCell(`${d}-${c}`)}
                      onMouseLeave={() => setHoveredCell(null)}
                      style={{ cursor: 'default' }}>
                      {cell && cell.count > 0 && <title>{`${dayLabels[d]} ${dp.label}`}</title>}
                    </rect>
                  );
                })}
              </g>
            ))}
          </svg>
          {hoveredCell && (() => {
            const [d, c] = hoveredCell.split('-').map(Number);
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
                <strong style={{ color: '#fff' }}>{dayLabels[d]} {DAYPARTS[c].label} PT</strong>
                <br />{count} post{count !== 1 ? 's' : ''} — avg {formatCompact(avg)} views
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
