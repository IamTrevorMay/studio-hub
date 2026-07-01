import React, { useMemo, useState } from 'react';
import { deriveFormat, formatCompact } from '../utils';
import { analysisStyles } from '../styles';
import { MiniBar } from '../viz';

// "What to make next" by type. Groups published content into formats (Shorts /
// Long-form / Podcast / Editorial / Streams) — or by series when set — and ranks
// them on AVERAGE views per post, not totals, so a format isn't rewarded just
// for volume. Answers: which kind of content earns the most reach per post?

export default function FormatPerformance({ contentItems }) {
  const [groupBy, setGroupBy] = useState('format'); // 'format' | 'series'

  const hasSeries = useMemo(
    () => contentItems.some((it) => it.series && String(it.series).trim()),
    [contentItems],
  );

  const rows = useMemo(() => {
    const groups = {};
    for (const it of contentItems) {
      const views = Number(it.latest_metrics?.[0]?.views) || 0;
      const er = Number(it.latest_metrics?.[0]?.engagement_rate) || 0;
      const key = groupBy === 'series'
        ? (it.series && String(it.series).trim() ? it.series : '— Untagged —')
        : deriveFormat(it.content_type, it.platform_account?.platform);
      if (!groups[key]) groups[key] = { key, count: 0, totalViews: 0, erSum: 0, erCount: 0, best: 0 };
      const g = groups[key];
      g.count += 1;
      g.totalViews += views;
      if (er > 0) { g.erSum += er; g.erCount += 1; }
      if (views > g.best) g.best = views;
    }
    return Object.values(groups)
      .map((g) => ({
        key: g.key,
        count: g.count,
        avgViews: g.count > 0 ? g.totalViews / g.count : 0,
        avgEr: g.erCount > 0 ? g.erSum / g.erCount : 0,
        best: g.best,
      }))
      .sort((a, b) => b.avgViews - a.avgViews);
  }, [contentItems, groupBy]);

  if (rows.length === 0) return null;
  const maxAvg = Math.max(...rows.map((r) => r.avgViews), 1);

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #14b8a6' }}>
      <div style={analysisStyles.cardHeader}>
        <span style={{ ...analysisStyles.cardTitle, color: '#14b8a6' }}>Format Performance</span>
        {hasSeries && (
          <div style={{ display: 'flex', gap: 4 }}>
            {['format', 'series'].map((g) => (
              <button key={g} onClick={() => setGroupBy(g)}
                style={{
                  padding: '3px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'inherit', textTransform: 'capitalize',
                  border: '1px solid ' + (groupBy === g ? 'rgba(20,184,166,0.5)' : 'rgba(255,255,255,0.1)'),
                  background: groupBy === g ? 'rgba(20,184,166,0.15)' : 'transparent',
                  color: groupBy === g ? '#5eead4' : 'rgba(255,255,255,0.5)',
                }}>
                {g}
              </button>
            ))}
          </div>
        )}
      </div>
      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', margin: '4px 0 12px' }}>
        Average views per post by {groupBy}. Taller = more reach earned per post published.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', minWidth: 130, flexShrink: 0 }}>
              {r.key}
              <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 5 }}>×{r.count}</span>
            </span>
            <div style={{ flex: 1 }}>
              <MiniBar value={r.avgViews} max={maxAvg} color="#14b8a6" height={22} label={`${formatCompact(r.avgViews)} avg`} />
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', minWidth: 80, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {r.avgEr > 0 ? (r.avgEr * 100).toFixed(1) + '% eng' : '—'}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', minWidth: 80, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              best {formatCompact(r.best)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
