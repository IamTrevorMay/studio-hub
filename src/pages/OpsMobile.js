import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import BottomSheet from '../components/mobile/BottomSheet';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';

// Mobile Ops dashboard. Read-only mirror of the desktop page focused on
// the "is anything on fire" use case: platform health at a glance,
// recent ingestion runs with tap-to-see-error, and cron status. No
// admin actions today — fixes still happen on desktop.

const STATUS_COLORS = {
  healthy:  '#22c55e',
  stale:    '#eab308',
  warning:  '#f97316',
  critical: '#ef4444',
  unknown:  '#6b7280',
};
const STATUS_LABELS = {
  healthy: 'Healthy', stale: 'Stale', warning: 'Warning',
  critical: 'Critical', unknown: 'Unknown',
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

function fmtRelative(d) {
  if (!d) return 'Never';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const TABS = ['Health', 'Runs', 'Cron'];

export default function OpsMobile() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('Health');
  const [accounts, setAccounts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [cronJobs, setCronJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openLog, setOpenLog] = useState(null);
  const [openAccount, setOpenAccount] = useState(null);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [accountsRes, logsRes, cronRes] = await Promise.all([
        supabase.from('platform_accounts').select('*').eq('is_active', true).order('platform'),
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
    } catch (err) { console.error('Ops fetch error:', err); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useVisibilityRefresh(fetchData);

  useEffect(() => {
    const ch = supabase
      .channel('ops-mobile')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingestion_logs' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_accounts' }, fetchData)
      .subscribe();
    return () => { ch.unsubscribe().catch(() => null); supabase.removeChannel(ch); };
  }, [fetchData]);

  useEffect(() => {
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const counts = useMemo(() => {
    const out = { healthy: 0, stale: 0, warning: 0, critical: 0, unknown: 0 };
    for (const a of accounts) out[getAccountStatus(a)] += 1;
    return out;
  }, [accounts]);

  if (!isAdmin) return <div style={styles.empty}>Admin access required.</div>;

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>Ops</h1>
        <button onClick={fetchData} disabled={refreshing} style={styles.refreshBtn}>
          {refreshing ? '…' : '↻'}
        </button>
      </div>

      <div style={styles.summaryRow}>
        {['critical', 'warning', 'stale', 'healthy'].map((k) => (
          <div key={k} style={{ ...styles.summaryTile, borderColor: STATUS_COLORS[k] }}>
            <div style={{ ...styles.summaryCount, color: STATUS_COLORS[k] }}>{counts[k]}</div>
            <div style={styles.summaryLabel}>{STATUS_LABELS[k]}</div>
          </div>
        ))}
      </div>

      <div style={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...styles.tab, ...(t === tab ? styles.tabActive : {}) }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={styles.pane}>
        {loading ? (
          <div style={styles.empty}>Loading…</div>
        ) : tab === 'Health' ? (
          <HealthList accounts={accounts} onTap={setOpenAccount} />
        ) : tab === 'Runs' ? (
          <RunsList logs={logs} onTap={setOpenLog} />
        ) : (
          <CronList jobs={cronJobs} />
        )}
      </div>

      <BottomSheet
        open={!!openLog}
        onClose={() => setOpenLog(null)}
        title={openLog ? `${openLog.platform_account?.platform || 'Run'} · ${openLog.job_type || ''}` : ''}
        maxHeight="80vh"
      >
        {openLog && <LogDetail log={openLog} />}
      </BottomSheet>

      <BottomSheet
        open={!!openAccount}
        onClose={() => setOpenAccount(null)}
        title={openAccount?.account_name || openAccount?.platform || 'Account'}
        maxHeight="80vh"
      >
        {openAccount && <AccountDetail account={openAccount} />}
      </BottomSheet>
    </div>
  );
}

// ─── Health ───────────────────────────────────────────────────

function HealthList({ accounts, onTap }) {
  if (accounts.length === 0) return <div style={styles.empty}>No active accounts.</div>;
  return (
    <div style={styles.list}>
      {accounts.map((a) => {
        const status = getAccountStatus(a);
        return (
          <button key={a.id} onClick={() => onTap(a)} style={{ ...styles.row, borderLeft: `3px solid ${STATUS_COLORS[status]}` }}>
            <div style={styles.rowTop}>
              <span style={styles.rowPlatform}>{a.platform}</span>
              <span style={{ ...styles.statusDot, background: STATUS_COLORS[status] }} />
            </div>
            <div style={styles.rowTitle}>{a.account_name || a.platform}</div>
            <div style={styles.rowSub}>
              Last success: {fmtRelative(a.last_success_at)}
              {a.consecutive_failures > 0 && <span style={{ color: '#f87171', marginLeft: 8 }}>· {a.consecutive_failures} failures</span>}
            </div>
            {a.last_error_message && (
              <div style={styles.rowError}>{a.last_error_message.slice(0, 100)}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function AccountDetail({ account }) {
  const status = getAccountStatus(account);
  return (
    <div style={detailStyles.root}>
      <div style={detailStyles.row}>
        <div style={detailStyles.label}>Status</div>
        <div style={{ ...detailStyles.value, color: STATUS_COLORS[status], fontWeight: 700 }}>
          {STATUS_LABELS[status]}
        </div>
      </div>
      <div style={detailStyles.row}>
        <div style={detailStyles.label}>Platform</div>
        <div style={detailStyles.value}>{account.platform}</div>
      </div>
      <div style={detailStyles.row}>
        <div style={detailStyles.label}>Token</div>
        <div style={{ ...detailStyles.value, color: account.token_status === 'valid' ? '#22c55e' : '#f87171' }}>
          {account.token_status || 'unknown'}
        </div>
      </div>
      <div style={detailStyles.row}>
        <div style={detailStyles.label}>Last success</div>
        <div style={detailStyles.value}>{fmtRelative(account.last_success_at)}</div>
      </div>
      <div style={detailStyles.row}>
        <div style={detailStyles.label}>Consecutive failures</div>
        <div style={detailStyles.value}>{account.consecutive_failures || 0}</div>
      </div>
      {account.last_error_message && (
        <div style={detailStyles.errorBlock}>{account.last_error_message}</div>
      )}
    </div>
  );
}

// ─── Runs ─────────────────────────────────────────────────────

function RunsList({ logs, onTap }) {
  const [filter, setFilter] = useState('all');
  const platforms = useMemo(() =>
    Array.from(new Set(logs.map((l) => l.platform_account?.platform).filter(Boolean))),
    [logs]);
  const filtered = logs.filter((l) => {
    if (filter === 'all') return true;
    if (filter === 'failed') return l.status === 'failed';
    return l.platform_account?.platform === filter;
  });
  return (
    <>
      <div style={styles.filterRow}>
        {['all', 'failed', ...platforms].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{ ...styles.filterPill, ...(filter === f ? styles.filterPillActive : {}) }}
          >
            {f === 'all' ? 'All' : f === 'failed' ? 'Failed' : f}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div style={styles.empty}>No runs match filter.</div>
      ) : (
        <div style={styles.list}>
          {filtered.map((l) => (
            <button key={l.id} onClick={() => onTap(l)} style={styles.row}>
              <div style={styles.rowTop}>
                <span style={{
                  ...styles.runStatus,
                  background:
                    l.status === 'success' ? 'rgba(34,197,94,0.15)' :
                    l.status === 'failed' ? 'rgba(239,68,68,0.15)' :
                    'rgba(234,179,8,0.15)',
                  color:
                    l.status === 'success' ? '#22c55e' :
                    l.status === 'failed' ? '#ef4444' : '#eab308',
                }}>{l.status}</span>
                <span style={{ flex: 1 }} />
                <span style={styles.rowMeta}>{fmtRelative(l.started_at)}</span>
              </div>
              <div style={styles.rowTitle}>
                {l.platform_account?.platform || '—'} · {l.job_type || '—'}
              </div>
              <div style={styles.rowSub}>
                {l.records_processed != null && <>{l.records_processed} records</>}
                {l.error_message && (
                  <span style={{ color: '#f87171', marginLeft: 8 }}>· {l.error_message.slice(0, 60)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function LogDetail({ log }) {
  return (
    <div style={detailStyles.root}>
      <div style={detailStyles.row}>
        <div style={detailStyles.label}>Status</div>
        <div style={{
          ...detailStyles.value, fontWeight: 700,
          color: log.status === 'success' ? '#22c55e' : log.status === 'failed' ? '#f87171' : '#eab308',
        }}>{log.status}</div>
      </div>
      <div style={detailStyles.row}>
        <div style={detailStyles.label}>Platform / Job</div>
        <div style={detailStyles.value}>{(log.platform_account?.platform || '—') + ' · ' + (log.job_type || '—')}</div>
      </div>
      <div style={detailStyles.row}>
        <div style={detailStyles.label}>Started</div>
        <div style={detailStyles.value}>{log.started_at ? new Date(log.started_at).toLocaleString() : '—'}</div>
      </div>
      {log.finished_at && (
        <div style={detailStyles.row}>
          <div style={detailStyles.label}>Finished</div>
          <div style={detailStyles.value}>{new Date(log.finished_at).toLocaleString()}</div>
        </div>
      )}
      {log.records_processed != null && (
        <div style={detailStyles.row}>
          <div style={detailStyles.label}>Records processed</div>
          <div style={detailStyles.value}>{log.records_processed}</div>
        </div>
      )}
      {log.metadata && Object.keys(log.metadata).length > 0 && (
        <div>
          <div style={detailStyles.label}>Metadata</div>
          <pre style={detailStyles.codeBlock}>{JSON.stringify(log.metadata, null, 2)}</pre>
        </div>
      )}
      {log.error_message && <div style={detailStyles.errorBlock}>{log.error_message}</div>}
    </div>
  );
}

// ─── Cron ─────────────────────────────────────────────────────

function CronList({ jobs }) {
  if (jobs.length === 0) return <div style={styles.empty}>No cron jobs (RPC get_cron_status may not be deployed).</div>;
  return (
    <div style={styles.list}>
      {jobs.map((j) => (
        <div key={j.jobid} style={styles.row}>
          <div style={styles.rowTop}>
            <span style={{
              ...styles.runStatus,
              background: j.active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: j.active ? '#22c55e' : '#f87171',
            }}>{j.active ? 'Active' : 'Off'}</span>
            <span style={{ flex: 1 }} />
            <span style={styles.rowMeta}>{fmtRelative(j.last_run_at)}</span>
          </div>
          <div style={styles.rowTitle}>{j.jobname}</div>
          <div style={{ ...styles.rowSub, fontFamily: 'monospace' }}>{j.schedule}</div>
          {j.last_status && (
            <div style={styles.rowSub}>
              Last run: <span style={{ color: j.last_status === 'succeeded' ? '#22c55e' : '#f87171' }}>{j.last_status}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = {
  root: { display: 'flex', flexDirection: 'column', minHeight: '100%', background: '#0f0f1a', color: '#e2e8f0' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
  },
  title: { margin: 0, fontSize: mobileTokens.font.xl, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' },
  refreshBtn: {
    ...mobileTapButton, width: 38, height: 38,
    background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: mobileTokens.radius.md, color: '#a5b4fc',
    fontSize: 18, lineHeight: 1, fontFamily: 'inherit',
  },
  summaryRow: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6,
    padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.md}px`,
  },
  summaryTile: {
    padding: '8px 6px', textAlign: 'center',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid', borderRadius: mobileTokens.radius.md,
  },
  summaryCount: { fontSize: 22, fontWeight: 800, lineHeight: 1 },
  summaryLabel: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 },
  tabs: {
    display: 'flex', gap: 6, padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.sm}px`,
  },
  tab: {
    flex: 1, ...mobileTapButton, minHeight: 36,
    padding: '8px 12px', borderRadius: mobileTokens.radius.pill,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.55)', fontSize: mobileTokens.font.sm, fontWeight: 600,
  },
  tabActive: { background: 'rgba(99,102,241,0.18)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' },
  pane: { flex: 1, minHeight: 0, padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px` },
  filterRow: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: `${mobileTokens.space.sm}px 0` },
  filterPill: {
    ...mobileTapButton, minHeight: 32, padding: '5px 12px',
    borderRadius: mobileTokens.radius.pill,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.55)', fontSize: mobileTokens.font.xs, fontWeight: 600,
  },
  filterPillActive: { background: 'rgba(99,102,241,0.18)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: {
    ...mobileTapButton, width: '100%', textAlign: 'left',
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: mobileTokens.radius.md,
    display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch',
  },
  rowTop: { display: 'flex', alignItems: 'center', gap: 6 },
  rowPlatform: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 },
  rowTitle: { fontSize: mobileTokens.font.md, fontWeight: 600, color: '#fff' },
  rowSub: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.55)' },
  rowMeta: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)' },
  rowError: { fontSize: mobileTokens.font.xs, color: '#fca5a5', padding: '4px 6px', background: 'rgba(239,68,68,0.08)', borderRadius: 4 },
  runStatus: { padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 },
  statusDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  empty: { padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: mobileTokens.font.md },
};

const detailStyles = {
  root: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  label: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, flexShrink: 0 },
  value: { fontSize: mobileTokens.font.sm, color: '#fff', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' },
  errorBlock: {
    marginTop: 8, padding: 10,
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6, color: '#fca5a5',
    fontSize: mobileTokens.font.xs, fontFamily: 'monospace',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  codeBlock: {
    margin: '4px 0 0', padding: 10,
    background: 'rgba(0,0,0,0.3)', borderRadius: 6,
    color: 'rgba(255,255,255,0.8)', fontSize: 11, fontFamily: 'monospace',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    maxHeight: 180, overflowY: 'auto',
  },
};
