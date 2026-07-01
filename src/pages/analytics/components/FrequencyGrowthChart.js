import React, { useState } from 'react';
import { PLATFORM_META } from '../constants';
import { formatCompact, getISOWeekKey } from '../utils';
import { analysisStyles } from '../styles';

export default function FrequencyGrowthChart({ contentItems, audienceSnapshots, accounts }) {
  // Group content by ISO week
  const weekPosts = {};
  for (const item of contentItems) {
    if (!item.published_at) continue;
    const dt = new Date(item.published_at);
    const week = getISOWeekKey(dt);
    if (!weekPosts[week]) weekPosts[week] = { count: 0, byPlatform: {} };
    weekPosts[week].count += 1;
    const platform = (() => {
      const acct = accounts.find(a => a.id === item.platform_account_id);
      return acct?.platform || 'unknown';
    })();
    weekPosts[week].byPlatform[platform] = (weekPosts[week].byPlatform[platform] || 0) + 1;
  }

  // Group follower gains by ISO week
  const weekFollowers = {};
  for (const snap of audienceSnapshots) {
    if (!snap.date) continue;
    const dt = new Date(snap.date + 'T00:00:00');
    const week = getISOWeekKey(dt);
    if (!weekFollowers[week]) weekFollowers[week] = 0;
    weekFollowers[week] += Number(snap.followers_gained) || 0;
  }

  // Merge weeks
  const allWeeks = [...new Set([...Object.keys(weekPosts), ...Object.keys(weekFollowers)])].sort();
  if (allWeeks.length < 2) return null;

  const data = allWeeks.map(week => ({
    week,
    posts: weekPosts[week]?.count || 0,
    byPlatform: weekPosts[week]?.byPlatform || {},
    followersGained: weekFollowers[week] || 0,
  }));

  const W = 900, H = 300, PAD = { top: 30, right: 60, bottom: 45, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxPosts = Math.max(...data.map(d => d.posts), 1);
  const maxFol = Math.max(...data.map(d => Math.abs(d.followersGained)), 1);
  const minFol = Math.min(...data.map(d => d.followersGained), 0);
  const folRange = Math.max(maxFol, Math.abs(minFol)) || 1;

  const barW = Math.min(plotW / data.length * 0.6, 40);
  const xStep = plotW / Math.max(data.length - 1, 1);

  // Platforms for stacked bars
  const allPlatforms = [...new Set(data.flatMap(d => Object.keys(d.byPlatform)))];

  // Line path for followers
  const linePoints = data.map((d, i) => {
    const x = PAD.left + i * xStep;
    const y = PAD.top + plotH / 2 - (d.followersGained / folRange) * (plotH / 2);
    return { x, y };
  });
  const linePath = linePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Zero line for followers
  const zeroY = PAD.top + plotH / 2;

  const [hoveredWeek, setHoveredWeek] = useState(null);

  // X-axis tick filtering
  const tickCount = Math.min(data.length, 10);
  const tickInterval = Math.max(1, Math.floor(data.length / tickCount));

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #22c55e' }}>
      <div style={analysisStyles.cardHeader}>
        <span style={{ ...analysisStyles.cardTitle, color: '#22c55e' }}>Upload Frequency vs Growth</span>
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '8px', borderRadius: '2px', background: 'rgba(99,102,241,0.6)' }} />
            <span style={{ color: '#8791a0' }}>Posts/week</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '2px', background: '#22c55e' }} />
            <span style={{ color: '#8791a0' }}>Followers gained</span>
          </div>
        </div>
      </div>
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '320px' }}
          onMouseLeave={() => setHoveredWeek(null)}>
          {/* Grid */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => {
            const y = PAD.top + plotH * pct;
            return <line key={pct} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(38,48,67,0.06)" />;
          })}
          {/* Zero line */}
          <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} stroke="rgba(38,48,67,0.14)" strokeDasharray="4,3" />
          {/* Left Y axis labels (posts) */}
          {[0, Math.round(maxPosts / 2), maxPosts].map(v => {
            const y = PAD.top + plotH - (v / maxPosts) * plotH;
            return <text key={v} x={PAD.left - 8} y={y + 3} fill="rgba(99,102,241,0.5)" fontSize="10" textAnchor="end">{v}</text>;
          })}
          {/* Right Y axis labels (followers) */}
          {[folRange, 0, -folRange].map((v, i) => {
            const y = PAD.top + (i / 2) * plotH;
            return <text key={i} x={W - PAD.right + 8} y={y + 3} fill="rgba(34,197,94,0.5)" fontSize="10" textAnchor="start">{v >= 0 ? '+' : ''}{formatCompact(v)}</text>;
          })}
          {/* Stacked bars */}
          {data.map((d, i) => {
            const x = PAD.left + i * xStep - barW / 2;
            let cumH = 0;
            return (
              <g key={i}>
                {allPlatforms.map(platform => {
                  const count = d.byPlatform[platform] || 0;
                  if (count === 0) return null;
                  const segH = (count / maxPosts) * plotH;
                  const meta = PLATFORM_META[platform] || { color: '#666' };
                  const barY = PAD.top + plotH - cumH - segH;
                  cumH += segH;
                  return (
                    <rect key={platform} x={x} y={barY} width={barW} height={segH}
                      fill={meta.color} fillOpacity={0.6} rx="2" />
                  );
                })}
              </g>
            );
          })}
          {/* Followers line */}
          <path d={linePath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" />
          {linePoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={hoveredWeek === i ? 4 : 2.5}
              fill="#22c55e" stroke="#ffffff" strokeWidth="1" />
          ))}
          {/* X-axis labels */}
          {data.map((d, i) => {
            if (data.length > 10 && i !== 0 && i !== data.length - 1 && i % tickInterval !== 0) return null;
            const x = PAD.left + i * xStep;
            return (
              <text key={i} x={x} y={H - 8} fill="#8791a0" fontSize="9" textAnchor="middle"
                transform={`rotate(-30, ${x}, ${H - 8})`}>
                {d.week}
              </text>
            );
          })}
          {/* Hover guide */}
          {hoveredWeek !== null && (
            <line x1={PAD.left + hoveredWeek * xStep} y1={PAD.top}
              x2={PAD.left + hoveredWeek * xStep} y2={PAD.top + plotH}
              stroke="rgba(38,48,67,0.16)" strokeWidth="1" strokeDasharray="4,3" />
          )}
          {/* Invisible hover rects */}
          {data.map((d, i) => (
            <rect key={i} x={PAD.left + i * xStep - xStep / 2} y={PAD.top}
              width={xStep} height={plotH} fill="transparent"
              onMouseEnter={() => setHoveredWeek(i)} />
          ))}
        </svg>
        {hoveredWeek !== null && data[hoveredWeek] && (() => {
          const d = data[hoveredWeek];
          const xPct = ((PAD.left + hoveredWeek * xStep) / W) * 100;
          return (
            <div style={{
              position: 'absolute', top: '8px',
              left: `${xPct}%`,
              transform: xPct > 70 ? 'translateX(-110%)' : 'translateX(10px)',
              background: '#ffffff', border: '1px solid #dbe2ec',
              borderRadius: '8px', padding: '10px 14px', pointerEvents: 'none',
              zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#263043', marginBottom: '6px' }}>Week of {d.week}</div>
              <div style={{ fontSize: '11px', color: '#5a6473', marginBottom: '3px' }}>
                Posts: <strong style={{ color: '#a5b4fc' }}>{d.posts}</strong>
              </div>
              {Object.entries(d.byPlatform).map(([p, count]) => (
                <div key={p} style={{ fontSize: '10px', color: PLATFORM_META[p]?.color || '#666', paddingLeft: '8px' }}>
                  {PLATFORM_META[p]?.label || p}: {count}
                </div>
              ))}
              <div style={{ fontSize: '11px', color: '#5a6473', marginTop: '4px' }}>
                Followers: <strong style={{ color: d.followersGained >= 0 ? '#4ade80' : '#f87171' }}>
                  {d.followersGained >= 0 ? '+' : ''}{formatCompact(d.followersGained)}
                </strong>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
