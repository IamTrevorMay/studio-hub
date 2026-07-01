import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';
import { PLATFORM_META } from '../constants';

function statusColor(row) {
  const hoursSince = row.hours_since_success;
  const failures = row.consecutive_failures || 0;
  const hasYesterday = (row.yesterday_row_count || 0) >= row.expected_row_count;
  const tokenBad = row.token_status === 'expired' || row.token_status === 'revoked';

  if (tokenBad || hoursSince > 50 || failures >= 3) return '#c2483d';
  // Stale data (cached/identical API responses) looks healthy on every other
  // check, so it must downgrade an otherwise-green account to amber.
  if (hoursSince > 26 || failures >= 1 || !hasYesterday || row.stale) return '#c98a2b';
  return '#2f8f5b';
}

function relativeTime(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function HealthDot({ row }) {
  const [hovered, setHovered] = useState(false);
  const meta = PLATFORM_META[row.platform] || {};
  const color = statusColor(row);
  const hasYesterday = (row.yesterday_row_count || 0) >= row.expected_row_count;

  return (
    <div
      style={styles.dotWrap}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ ...styles.dot, background: color, borderColor: meta.color || 'rgba(255,255,255,0.2)' }}>
        <span style={styles.dotIcon}>{meta.icon || row.platform?.slice(0, 2).toUpperCase()}</span>
      </div>
      {hovered && (
        <div style={styles.tooltip}>
          <div style={styles.tooltipName}>{row.account_name || meta.label || row.platform}</div>
          <div style={styles.tooltipRow}>Last synced: {relativeTime(row.last_synced_at)}</div>
          <div style={styles.tooltipRow}>Last success: {relativeTime(row.last_success_at)}</div>
          {row.consecutive_failures > 0 && (
            <div style={{ ...styles.tooltipRow, color: '#f87171' }}>
              Failures: {row.consecutive_failures} consecutive
            </div>
          )}
          <div style={styles.tooltipRow}>
            Yesterday data: {hasYesterday ? 'present' : 'missing'}
          </div>
          {row.stale && (
            <div style={{ ...styles.tooltipRow, color: '#fbbf24' }}>
              {row.stale_reason || 'Data appears stale'}
            </div>
          )}
          {row.token_status !== 'valid' && row.token_status !== 'unknown' && (
            <div style={{ ...styles.tooltipRow, color: '#f87171' }}>
              Token: {row.token_status}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SyncHealthWidget() {
  const [health, setHealth] = useState([]);

  const fetchHealth = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_sync_health');
    if (!error && data) setHealth(data);
  }, []);

  useEffect(() => {
    fetchHealth();
    const iv = setInterval(fetchHealth, 60000);
    return () => clearInterval(iv);
  }, [fetchHealth]);

  if (health.length === 0) return null;

  return (
    <div style={styles.container}>
      <span style={styles.label}>Sync</span>
      {health.map((row) => (
        <HealthDot key={row.platform_account_id} row={row} />
      ))}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: '#ffffff',
    border: '1px solid #dbe2ec',
    borderRadius: 10,
    boxShadow: '0 1px 2px rgba(38,48,67,0.05)',
  },
  label: {
    fontSize: 11,
    fontWeight: 700,
    color: '#8791a0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginRight: 4,
  },
  dotWrap: {
    position: 'relative',
    display: 'inline-flex',
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid',
    cursor: 'default',
  },
  dotIcon: {
    fontSize: 9,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1,
  },
  tooltip: {
    position: 'absolute',
    top: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginTop: 6,
    background: 'rgba(18,18,31,0.96)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '10px 12px',
    zIndex: 20,
    minWidth: 180,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
  tooltipName: {
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    marginBottom: 6,
  },
  tooltipRow: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 1.5,
  },
};
