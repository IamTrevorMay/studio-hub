import React from 'react';
import { formatCompact } from '../utils';
import { analysisStyles } from '../styles';
import { MiniBar, EmptyChart, platformColor } from '../viz';

// "Which platform monetizes best." The bar now encodes RPM (revenue per 1K
// views) — the metric the card is actually about — with a marker for the
// blended average so each platform reads against the benchmark. Revenue and
// views ride along as context numbers.
export default function RPMCard({ revenueData, timeSeries, accounts }) {
  const revenueByAccount = {};
  for (const r of revenueData) {
    if (!revenueByAccount[r.platform_account_id]) revenueByAccount[r.platform_account_id] = 0;
    revenueByAccount[r.platform_account_id] += (r.net_amount_cents || r.amount_cents || 0);
  }

  const viewsByAccount = {};
  for (const r of timeSeries) {
    if (!viewsByAccount[r.platform_account_id]) viewsByAccount[r.platform_account_id] = 0;
    viewsByAccount[r.platform_account_id] += Number(r.total_views) || 0;
  }

  const rows = Object.entries(revenueByAccount)
    .filter(([, cents]) => cents > 0)
    .map(([accountId, cents]) => {
      const acct = accounts.find(a => a.id === accountId);
      const platform = acct?.platform || 'unknown';
      const views = viewsByAccount[accountId] || 0;
      const revenue = cents / 100;
      const rpm = views > 0 ? (revenue / (views / 1000)) : 0;
      return { accountId, name: acct?.account_name || platform, platform, color: platformColor(platform), revenue, views, rpm };
    })
    .sort((a, b) => b.rpm - a.rpm);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalViews = rows.reduce((s, r) => s + r.views, 0);
  const blendedRpm = totalViews > 0 ? (totalRevenue / (totalViews / 1000)) : 0;
  const maxRpm = Math.max(...rows.map(r => r.rpm), 0.01);

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #f59e0b' }}>
      <div style={analysisStyles.cardHeader}>
        <span style={{ ...analysisStyles.cardTitle, color: '#f59e0b' }}>Revenue per 1K Views (RPM)</span>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.42)' }}>
          Blended RPM: <strong style={{ color: '#f59e0b' }}>${blendedRpm.toFixed(2)}</strong>
        </span>
      </div>
      {rows.length === 0 ? (
        <div style={{ marginTop: '12px' }}><EmptyChart label="No revenue with view data for this range." height={80} /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
          {rows.map(r => (
            <div key={r.accountId} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: r.color, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', minWidth: '120px', flexShrink: 0 }}>{r.name}</span>
              <div style={{ flex: 1 }}>
                <MiniBar
                  value={r.rpm} max={maxRpm} color={r.color} height={22}
                  label={`$${r.rpm.toFixed(2)}/1K`}
                  refPct={maxRpm > 0 ? (blendedRpm / maxRpm) * 100 : null}
                />
              </div>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.42)', minWidth: '70px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatCompact(r.views)} views
              </span>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.42)', minWidth: '70px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                ${r.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
          ))}
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.32)', marginTop: '2px' }}>
            Bar = RPM · vertical marker = blended average (${blendedRpm.toFixed(2)})
          </div>
        </div>
      )}
    </div>
  );
}
