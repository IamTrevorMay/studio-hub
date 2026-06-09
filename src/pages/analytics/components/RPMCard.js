import React from 'react';
import { PLATFORM_META } from '../constants';
import { formatCompact } from '../utils';
import { analysisStyles } from '../styles';

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
      const meta = PLATFORM_META[platform] || { label: platform, color: '#666' };
      const views = viewsByAccount[accountId] || 0;
      const revenue = cents / 100;
      const rpm = views > 0 ? (revenue / (views / 1000)) : 0;
      return { accountId, name: acct?.account_name || meta.label, platform, color: meta.color, revenue, views, rpm };
    })
    .sort((a, b) => b.revenue - a.revenue);

  if (rows.length === 0) return null;

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalViews = rows.reduce((s, r) => s + r.views, 0);
  const blendedRpm = totalViews > 0 ? (totalRevenue / (totalViews / 1000)) : 0;
  const maxRevenue = Math.max(...rows.map(r => r.revenue));

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #f59e0b' }}>
      <div style={analysisStyles.cardHeader}>
        <span style={{ ...analysisStyles.cardTitle, color: '#f59e0b' }}>Revenue per 1K Views (RPM)</span>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
          Blended RPM: <strong style={{ color: '#f59e0b' }}>${blendedRpm.toFixed(2)}</strong>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
        {rows.map(r => (
          <div key={r.accountId} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: r.color, flexShrink: 0 }} />
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', minWidth: '120px', flexShrink: 0 }}>{r.name}</span>
            <div style={{ flex: 1, position: 'relative', height: '22px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '4px',
                background: `linear-gradient(90deg, ${r.color}44, ${r.color}88)`,
                width: `${maxRevenue > 0 ? (r.revenue / maxRevenue) * 100 : 0}%`,
                transition: 'width 0.3s ease',
              }} />
              <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: '#fff', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                ${r.revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', minWidth: '70px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {formatCompact(r.views)} views
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b', minWidth: '65px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              ${r.rpm.toFixed(2)}/1K
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
