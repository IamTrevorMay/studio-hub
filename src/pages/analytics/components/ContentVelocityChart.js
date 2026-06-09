import React, { useState } from 'react';
import { PLATFORM_META } from '../constants';
import { formatCompact } from '../utils';
import { analysisStyles } from '../styles';

export default function ContentVelocityChart({ contentItems }) {
  const [hoveredDot, setHoveredDot] = useState(null);
  const now = new Date();

  const dots = contentItems
    .filter(item => item.published_at && item.latest_metrics?.[0]?.views)
    .map(item => {
      const published = new Date(item.published_at);
      const daysOld = Math.max(1, Math.round((now - published) / 86400000));
      const views = Number(item.latest_metrics[0].views) || 0;
      const platform = item.platform_account?.platform || 'unknown';
      const meta = PLATFORM_META[platform] || { label: platform, color: '#666' };
      return {
        id: item.id, title: item.title || '(Untitled)', daysOld, views,
        platform, color: meta.color, label: meta.label,
        accountName: item.platform_account?.account_name || meta.label,
      };
    })
    .filter(d => d.views > 0);

  if (dots.length === 0) return null;

  const W = 900, H = 340, PAD = { top: 30, right: 30, bottom: 50, left: 60 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxDays = Math.max(...dots.map(d => d.daysOld));
  const maxViews = Math.max(...dots.map(d => d.views));
  const logMax = Math.log10(Math.max(maxViews, 10));
  const logMin = 0;

  function xPos(days) { return PAD.left + (days / maxDays) * plotW; }
  function yPos(views) {
    const logVal = views > 0 ? Math.log10(views) : 0;
    return PAD.top + plotH - ((logVal - logMin) / (logMax - logMin)) * plotH;
  }

  // Y-axis ticks (powers of 10)
  const yTicks = [];
  for (let p = 0; p <= Math.ceil(logMax); p++) {
    yTicks.push(Math.pow(10, p));
  }

  // X-axis ticks
  const xTickCount = Math.min(8, maxDays);
  const xTickInterval = Math.max(1, Math.ceil(maxDays / xTickCount));
  const xTicks = [];
  for (let t = 0; t <= maxDays; t += xTickInterval) xTicks.push(t);

  // Legend - unique platforms
  const platforms = [...new Set(dots.map(d => d.platform))];

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #3b82f6' }}>
      <div style={analysisStyles.cardHeader}>
        <span style={{ ...analysisStyles.cardTitle, color: '#3b82f6' }}>Content Velocity</span>
        <div style={{ display: 'flex', gap: '12px' }}>
          {platforms.map(p => {
            const meta = PLATFORM_META[p] || { label: p, color: '#666' };
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: meta.color }} />
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>{meta.label}</span>
              </div>
            );
          })}
        </div>
      </div>
      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: '4px 0 12px' }}>
        Total views vs days since publish. Dots higher and to the left gained traction fastest.
      </p>
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '360px' }}
          onMouseLeave={() => setHoveredDot(null)}>
          {/* Grid */}
          {yTicks.map(t => {
            const y = yPos(t);
            if (y < PAD.top || y > PAD.top + plotH) return null;
            return (
              <g key={t}>
                <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.05)" />
                <text x={PAD.left - 8} y={y + 3} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="end">
                  {formatCompact(t)}
                </text>
              </g>
            );
          })}
          {/* X axis labels */}
          {xTicks.map(t => {
            const x = xPos(t);
            return (
              <text key={t} x={x} y={H - 12} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle">
                {t}d
              </text>
            );
          })}
          {/* Axis labels */}
          <text x={W / 2} y={H - 0} fill="rgba(255,255,255,0.25)" fontSize="10" textAnchor="middle">Days since publish</text>
          <text x={14} y={H / 2} fill="rgba(255,255,255,0.25)" fontSize="10" textAnchor="middle" transform={`rotate(-90, 14, ${H / 2})`}>Views (log scale)</text>
          {/* Dots */}
          {dots.map((d, i) => (
            <circle key={d.id}
              cx={xPos(d.daysOld)} cy={yPos(d.views)}
              r={hoveredDot === i ? 6 : 4}
              fill={d.color} fillOpacity={hoveredDot === i ? 1 : 0.7}
              stroke={hoveredDot === i ? '#fff' : d.color} strokeWidth={hoveredDot === i ? 2 : 0.5}
              onMouseEnter={() => setHoveredDot(i)}
              style={{ cursor: 'pointer', transition: 'r 0.15s' }}
            />
          ))}
        </svg>
        {hoveredDot !== null && dots[hoveredDot] && (() => {
          const d = dots[hoveredDot];
          const xPct = (xPos(d.daysOld) / W) * 100;
          return (
            <div style={{
              position: 'absolute', top: '8px',
              left: `${xPct}%`,
              transform: xPct > 70 ? 'translateX(-110%)' : 'translateX(10px)',
              background: 'rgba(18,18,31,0.95)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px', padding: '10px 14px', pointerEvents: 'none',
              maxWidth: '280px', zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.title}
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                <span style={{ color: d.color }}>{d.label}</span>
                <span>{formatCompact(d.views)} views</span>
                <span>{d.daysOld}d old</span>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
