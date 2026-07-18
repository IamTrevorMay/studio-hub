import React from 'react';
import { colors } from '../lib/styleTokens';

export default function VelocityChart({ sprints }) {
  // sprints = array of completed sprints with { start_date, velocity }, newest last
  if (!sprints || sprints.length === 0) return null;

  const maxVelocity = Math.max(...sprints.map(s => s.velocity || 0), 1);
  const avg = sprints.length > 0
    ? (sprints.reduce((sum, s) => sum + (s.velocity || 0), 0) / sprints.length).toFixed(1)
    : 0;

  const barWidth = 28;
  const barGap = 6;
  const chartHeight = 48;
  const labelHeight = 18;
  const totalWidth = sprints.length * (barWidth + barGap) - barGap;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px' }}>
      <svg
        width={totalWidth}
        height={chartHeight + labelHeight}
        style={{ overflow: 'visible' }}
      >
        {sprints.map((sprint, i) => {
          const v = sprint.velocity || 0;
          const barH = maxVelocity > 0 ? (v / maxVelocity) * chartHeight : 0;
          const x = i * (barWidth + barGap);
          const label = new Date(sprint.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          return (
            <g key={sprint.id}>
              {/* Bar */}
              <rect
                x={x}
                y={chartHeight - barH}
                width={barWidth}
                height={Math.max(barH, 2)}
                rx={4}
                fill={i === sprints.length - 1 ? '#5b8fc7' : 'rgba(91, 143, 199,0.4)'}
              />
              {/* Velocity number */}
              {v > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={chartHeight - barH - 4}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.5)"
                  fontSize="10"
                  fontWeight="600"
                >
                  {v}
                </text>
              )}
              {/* Week label */}
              <text
                x={x + barWidth / 2}
                y={chartHeight + 14}
                textAnchor="middle"
                fill="rgba(255,255,255,0.3)"
                fontSize="9"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', paddingBottom: labelHeight + 2 }}>
        avg: <span style={{ color: colors.accentFg, fontWeight: 600 }}>{avg}</span> pts/sprint
      </div>
    </div>
  );
}
