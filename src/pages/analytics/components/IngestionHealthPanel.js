import React, { useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { styles } from '../styles';
import { getDaysInRange } from '../utils';

export default function IngestionHealthPanel({ logs, accounts, onRefresh }) {
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [revenueInput, setRevenueInput] = useState('');
  const [revenueSaving, setRevenueSaving] = useState(false);
  const [revenueResult, setRevenueResult] = useState(null);

  const accountMap = {};
  accounts.forEach(a => { accountMap[a.id] = a; });

  const statusColors = {
    running: '#f59e0b',
    success: '#4ade80',
    failed: '#f87171',
    partial: '#fb923c',
  };

  const canAddRevenue = (log) =>
    log.job_type === 'manual_csv_upload_tiktok' &&
    log.status === 'success' &&
    log.metadata?.date_start;

  async function handleSaveRevenue(log) {
    const totalCents = Math.round(parseFloat(revenueInput) * 100);
    if (!totalCents || totalCents <= 0) return;
    setRevenueSaving(true);
    setRevenueResult(null);
    try {
      const days = getDaysInRange(log.metadata.date_start, log.metadata.date_end);
      const numDays = days.length;
      const perDay = Math.floor(totalCents / numDays);
      const remainder = totalCents - perDay * numDays;
      const rows = days.map((d, i) => ({
        stripe_event_id: `manual_tiktok_${log.platform_account_id}_${d}`,
        event_type: 'charge',
        amount_cents: perDay + (i === numDays - 1 ? remainder : 0),
        net_amount_cents: perDay + (i === numDays - 1 ? remainder : 0),
        currency: 'usd',
        product_category: 'ad_revenue',
        is_recurring: false,
        occurred_at: `${d}T00:00:00Z`,
        metadata: { source: 'manual_input', platform: 'tiktok' },
        platform_account_id: log.platform_account_id,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error } = await supabase.from('revenue_events')
          .upsert(batch, { onConflict: 'stripe_event_id' });
        if (error) throw new Error(error.message);
      }
      setRevenueResult({ success: true, count: rows.length });
      setRevenueInput('');
      if (onRefresh) onRefresh();
    } catch (err) {
      setRevenueResult({ error: err.message });
    }
    setRevenueSaving(false);
  }

  return (
    <div style={{ ...styles.tableWrap, marginTop: '8px', maxHeight: '400px' }}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Platform</th>
            <th style={styles.th}>Job Type</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Processed</th>
            <th style={styles.th}>Started</th>
            <th style={styles.th}>Duration</th>
            <th style={styles.th}>Error</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => {
            const acct = accountMap[log.platform_account_id];
            const duration = log.completed_at && log.started_at
              ? Math.round((new Date(log.completed_at) - new Date(log.started_at)) / 1000) + 's'
              : '...';
            const isExpanded = expandedLogId === log.id;
            return (
              <React.Fragment key={log.id}>
                <tr style={i % 2 === 0 ? styles.trEven : {}}>
                  <td style={styles.td}>
                    <span style={{
                      display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
                      background: statusColors[log.status] || '#666', marginRight: '6px',
                    }} />
                    {log.status}
                  </td>
                  <td style={styles.td}>{acct?.account_name || '—'}</td>
                  <td style={styles.td}>{log.job_type}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{log.records_processed || 0}</td>
                  <td style={styles.td}>
                    {log.started_at ? new Date(log.started_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td style={styles.td}>{duration}</td>
                  <td style={{ ...styles.td, color: '#f87171', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {log.error_message || '—'}
                  </td>
                  <td style={styles.td}>
                    {canAddRevenue(log) ? (
                      <button
                        onClick={() => { setExpandedLogId(isExpanded ? null : log.id); setRevenueInput(''); setRevenueResult(null); }}
                        style={{ background: 'none', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '4px', color: '#f59e0b', cursor: 'pointer', padding: '2px 8px', fontSize: '13px', fontWeight: 700 }}
                        title="Add revenue for this upload's date range"
                      >$</button>
                    ) : '—'}
                  </td>
                </tr>
                {isExpanded && (
                  <tr style={{ background: 'rgba(245,158,11,0.05)' }}>
                    <td colSpan={8} style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                          Date range: <strong style={{ color: '#fff' }}>{log.metadata.date_start}</strong> to <strong style={{ color: '#fff' }}>{log.metadata.date_end}</strong>
                        </span>
                        <input
                          type="number" step="0.01" min="0" placeholder="Revenue ($)"
                          value={revenueInput} onChange={e => setRevenueInput(e.target.value)}
                          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', padding: '6px 10px', fontSize: '13px', width: '130px' }}
                        />
                        <button onClick={() => handleSaveRevenue(log)} disabled={revenueSaving || !revenueInput}
                          style={{ ...styles.uploadBtn, borderColor: '#f59e0b66', color: '#f59e0b', padding: '6px 14px', fontSize: '12px', opacity: revenueSaving || !revenueInput ? 0.5 : 1 }}>
                          {revenueSaving ? 'Saving...' : 'Save Revenue'}
                        </button>
                        {revenueResult && (
                          <span style={{ fontSize: '12px', color: revenueResult.error ? '#f87171' : '#4ade80' }}>
                            {revenueResult.error ? `Error: ${revenueResult.error}` : `Saved across ${revenueResult.count} days`}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {logs.length === 0 && (
            <tr><td colSpan={8} style={{ ...styles.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>No ingestion logs yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
