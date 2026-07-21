import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { colors } from '../lib/styleTokens';

const STATUS_COLORS = {
  healthy: '#22c55e',
  stale: '#eab308',
  warning: '#f97316',
  critical: '#ef4444',
  unknown: '#6b7280',
};

function getAccountStatus(account) {
  if (account.consecutive_failures >= 3) return 'critical';
  if (account.consecutive_failures >= 1) return 'warning';
  if (account.last_success_at) {
    const hoursSince = (Date.now() - new Date(account.last_success_at).getTime()) / 3600000;
    if (hoursSince > 48) return 'stale';
  }
  if (!account.last_success_at) return 'unknown';
  return 'healthy';
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAbsoluteTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// Relative time on top, absolute timestamp beneath it (muted) so a frozen
// "9d ago" is self-evidently an old fetch rather than a real outage.
function TimeCell({ value }) {
  if (!value) return <span style={styles.cardValue}>Never</span>;
  return (
    <span style={styles.timeCell}>
      <span>{formatRelativeTime(value)}</span>
      <span style={styles.timeAbsolute}>{formatAbsoluteTime(value)}</span>
    </span>
  );
}

export default function Ops() {
  const [accounts, setAccounts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [cronJobs, setCronJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logFilter, setLogFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [lastFetched, setLastFetched] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [accountsRes, logsRes, cronRes] = await Promise.all([
        supabase
          .from('platform_accounts')
          .select('*')
          .eq('is_active', true)
          .order('platform'),
        supabase
          .from('ingestion_logs')
          .select('*, platform_account:platform_accounts(platform, account_name)')
          .order('started_at', { ascending: false })
          .limit(50),
        supabase.rpc('get_cron_status'),
      ]);

      if (accountsRes.data) setAccounts(accountsRes.data);
      if (logsRes.data) setLogs(logsRes.data);
      if (cronRes.data) setCronJobs(cronRes.data);
      setLastFetched(new Date());
    } catch (err) {
      console.error('Ops data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useVisibilityRefresh(fetchData);

  // Live updates so the page reflects new sync runs without manual refresh.
  useEffect(() => {
    const channel = supabase
      .channel('ops-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingestion_logs' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_accounts' }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  // Fallback poll every 60s in case realtime drops or the table isn't in the publication.
  useEffect(() => {
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const filteredLogs = logs.filter(log => {
    if (logFilter === 'all') return true;
    if (logFilter === 'failed') return log.status === 'failed';
    return log.platform_account?.platform === logFilter;
  });

  const filteredAccounts = accounts.filter(a => {
    if (statusFilter === 'all') return true;
    return getAccountStatus(a) === statusFilter;
  });

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading ops data...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Ops</h1>
        <div style={styles.headerRight}>
          {lastFetched && (
            <span style={styles.lastFetched}>
              Data last fetched {formatAbsoluteTime(lastFetched)}
            </span>
          )}
          <button onClick={fetchData} style={styles.refreshBtn}>Refresh</button>
        </div>
      </div>

      {/* Platform Health Cards */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Platform Health</h2>
          <div style={styles.filterRow}>
            {['all', 'healthy', 'stale', 'warning', 'critical'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  ...styles.filterPill,
                  background: statusFilter === s ? 'rgba(91, 143, 199,0.2)' : 'transparent',
                  borderColor: statusFilter === s ? '#5b8fc7' : 'rgba(255,255,255,0.1)',
                }}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div style={styles.cardGrid}>
          {filteredAccounts.map(account => {
            const status = getAccountStatus(account);
            return (
              <div key={account.id} style={{ ...styles.card, borderLeftColor: STATUS_COLORS[status] }}>
                <div style={styles.cardHeader}>
                  <span style={styles.cardPlatform}>{account.platform}</span>
                  <span style={{ ...styles.statusDot, background: STATUS_COLORS[status] }} />
                </div>
                <div style={styles.cardName}>{account.account_name || account.platform}</div>
                <div style={styles.cardMeta}>
                  <div style={styles.cardRow}>
                    <span style={styles.cardLabel}>Last success:</span>
                    <span style={styles.cardValue}><TimeCell value={account.last_success_at} /></span>
                  </div>
                  <div style={styles.cardRow}>
                    <span style={styles.cardLabel}>Token:</span>
                    <span style={{ ...styles.cardValue, color: account.token_status === 'valid' ? '#22c55e' : account.token_status === 'unknown' ? '#6b7280' : '#ef4444' }}>
                      {account.token_status}
                    </span>
                  </div>
                  {account.consecutive_failures > 0 && (
                    <div style={styles.cardRow}>
                      <span style={styles.cardLabel}>Failures:</span>
                      <span style={{ ...styles.cardValue, color: '#ef4444' }}>{account.consecutive_failures}</span>
                    </div>
                  )}
                  {account.last_error_message && (
                    <div style={styles.cardError}>{account.last_error_message.substring(0, 80)}</div>
                  )}
                </div>
              </div>
            );
          })}
          {filteredAccounts.length === 0 && (
            <div style={styles.emptyState}>No accounts match filter</div>
          )}
        </div>
      </section>

      {/* Recent Ingestion Runs */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Recent Ingestion Runs</h2>
          <div style={styles.filterRow}>
            {['all', 'failed', ...new Set(logs.map(l => l.platform_account?.platform).filter(Boolean))].map(f => (
              <button
                key={f}
                onClick={() => setLogFilter(f)}
                style={{
                  ...styles.filterPill,
                  background: logFilter === f ? 'rgba(91, 143, 199,0.2)' : 'transparent',
                  borderColor: logFilter === f ? '#5b8fc7' : 'rgba(255,255,255,0.1)',
                }}
              >
                {f === 'all' ? 'All' : f === 'failed' ? 'Failed' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Platform</th>
                <th style={styles.th}>Job Type</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Started</th>
                <th style={styles.th}>Records</th>
                <th style={styles.th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map(log => (
                <tr key={log.id} style={styles.tr}>
                  <td style={styles.td}>{log.platform_account?.platform || '—'}</td>
                  <td style={styles.td}>{log.job_type}</td>
                  <td style={styles.td}>
                    <span style={{
                      ...styles.statusBadge,
                      background: log.status === 'success' ? 'rgba(34,197,94,0.15)' : log.status === 'failed' ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.15)',
                      color: log.status === 'success' ? '#22c55e' : log.status === 'failed' ? '#ef4444' : '#eab308',
                    }}>
                      {log.status}
                    </span>
                  </td>
                  <td style={styles.td}><TimeCell value={log.started_at} /></td>
                  <td style={styles.td}>{log.records_processed ?? '—'}</td>
                  <td style={{ ...styles.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {log.error_message ? log.error_message.substring(0, 60) : '—'}
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center' }}>No logs match filter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cron Job Status */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Cron Jobs</h2>
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Job Name</th>
                <th style={styles.th}>Schedule</th>
                <th style={styles.th}>Active</th>
                <th style={styles.th}>Last Run</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {cronJobs.map(job => (
                <tr key={job.jobid} style={styles.tr}>
                  <td style={styles.td}>{job.jobname}</td>
                  <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12 }}>{job.schedule}</td>
                  <td style={styles.td}>
                    <span style={{ color: job.active ? '#22c55e' : '#ef4444' }}>{job.active ? 'Yes' : 'No'}</span>
                  </td>
                  <td style={styles.td}><TimeCell value={job.last_run_at} /></td>
                  <td style={styles.td}>
                    {job.last_status && (() => {
                      const inProgress = job.last_status === 'running' || job.last_status === 'starting';
                      const bg = job.last_status === 'succeeded' ? 'rgba(34,197,94,0.15)'
                        : inProgress ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)';
                      const fg = job.last_status === 'succeeded' ? '#22c55e'
                        : inProgress ? '#f59e0b' : '#ef4444';
                      return (
                      <span style={{ ...styles.statusBadge, background: bg, color: fg }}>
                        {job.last_status}
                      </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
              {cronJobs.length === 0 && (
                <tr><td colSpan={5} style={{ ...styles.td, textAlign: 'center' }}>No cron jobs found (RPC may not be deployed yet)</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const styles = {
  container: {
    padding: '32px',
    maxWidth: 1200,
    margin: '0 auto',
  },
  loading: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    padding: 40,
    textAlign: 'center',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#fff',
    margin: 0,
  },
  refreshBtn: {
    padding: '8px 16px',
    background: colors.accentA15,
    border: '1px solid rgba(91, 143, 199,0.3)',
    borderRadius: 8,
    color: colors.accentFg,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  lastFetched: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  timeCell: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.3,
  },
  timeAbsolute: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },
  section: {
    marginBottom: 40,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.9)',
    margin: 0,
  },
  filterRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  filterPill: {
    padding: '4px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 12,
  },
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderLeft: '3px solid',
    borderRadius: 10,
    padding: '14px 16px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardPlatform: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: 'rgba(255,255,255,0.5)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  cardName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    marginBottom: 10,
  },
  cardMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  cardRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  cardValue: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  cardError: {
    fontSize: 11,
    color: '#fca5a5',
    marginTop: 6,
    padding: '4px 6px',
    background: 'rgba(239,68,68,0.08)',
    borderRadius: 4,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  emptyState: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    padding: 20,
    textAlign: 'center',
  },
  tableWrapper: {
    overflowX: 'auto',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  },
  td: {
    padding: '10px 12px',
    color: 'rgba(255,255,255,0.75)',
    whiteSpace: 'nowrap',
  },
  statusBadge: {
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
  },
};
