import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { callEdgeFn } from '../lib/edgeFn';
import { mobileTokens } from '../utils/mobileTokens';
import { daysAgoStr } from './analytics/utils';

// Mobile Analytics — Admin Mode. Two tabs:
//   • Weekly Report (default): the AI weekly KPI brief (summary always shown,
//     per-platform/revenue/content in collapsibles). Week picker + Generate now.
//   • Platform KPIs: per-account followers / views / engagement / revenue (30d).
// Charts and deep content tables stay desktop-only.

const PLATFORM_META = {
  youtube:    { label: 'YouTube',    color: '#FF0000', icon: '▶' },
  facebook:   { label: 'Facebook',   color: '#1877F2', icon: 'f' },
  instagram:  { label: 'Instagram',  color: '#E4405F', icon: '◉' },
  tiktok:     { label: 'TikTok',     color: '#00F2EA', icon: '♪' },
  substack:   { label: 'Substack',   color: '#FF6719', icon: 'S' },
  twitch:     { label: 'Twitch',     color: '#9146FF', icon: 'T' },
  stripe:     { label: 'Stripe',     color: '#635BFF', icon: '$' },
  fourthwall: { label: 'Fourthwall', color: '#E8451C', icon: '4' },
};

function fmtCount(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}
const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtUsd = (cents) => `$${Math.round((cents || 0) / 100).toLocaleString()}`;
const fmtSigned = (n) => `${n >= 0 ? '+' : ''}${Number(n || 0).toLocaleString()}`;

export default function AnalyticsMobile() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('weekly');

  if (!isAdmin) return <p style={styles.empty}>Analytics is admin-only.</p>;

  return (
    <div style={styles.root}>
      <div style={styles.tabs} role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'weekly'}
          onClick={() => setTab('weekly')}
          style={{ ...styles.tab, ...(tab === 'weekly' ? styles.tabActive : {}) }}
        >
          Weekly Report
        </button>
        <button
          role="tab"
          aria-selected={tab === 'kpis'}
          onClick={() => setTab('kpis')}
          style={{ ...styles.tab, ...(tab === 'kpis' ? styles.tabActive : {}) }}
        >
          Platform KPIs
        </button>
      </div>

      {tab === 'weekly' ? <WeeklyReportTab isAdmin={isAdmin} /> : <PlatformKpisTab />}
    </div>
  );
}

/* ───────────────────────── Weekly Report ───────────────────────── */

function WeeklyReportTab({ isAdmin }) {
  const [reports, setReports] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchReports = useCallback(async () => {
    const { data, error } = await supabase
      .from('weekly_reports')
      .select('id, week_start, week_end, data, narrative, generated_at')
      .order('week_start', { ascending: false })
      .limit(26);
    if (!error) {
      setReports(data || []);
      setSelectedId((prev) => prev || (data && data[0] ? data[0].id : null));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      await callEdgeFn('generate-weekly-report', {});
      await fetchReports();
    } catch (err) {
      console.error('Generate failed:', err);
      window.alert(err.message || 'Generation failed');
    }
    setGenerating(false);
  };

  if (loading) return <p style={styles.empty}>Loading weekly report…</p>;

  const report = reports.find((r) => r.id === selectedId) || reports[0];

  return (
    <div style={styles.tabBody}>
      <div style={styles.reportControls}>
        {reports.length > 0 && (
          <select
            value={report?.id || ''}
            onChange={(e) => setSelectedId(e.target.value)}
            style={styles.weekSelect}
          >
            {reports.map((r) => (
              <option key={r.id} value={r.id}>{r.week_start} → {r.week_end}</option>
            ))}
          </select>
        )}
        {isAdmin && (
          <button onClick={handleGenerate} disabled={generating} style={styles.genBtn}>
            {generating ? 'Generating…' : 'Generate now'}
          </button>
        )}
      </div>

      {!report ? (
        <p style={styles.emptyText}>No weekly reports yet. They generate automatically every Saturday — or tap “Generate now”.</p>
      ) : (
        <ReportBody report={report} />
      )}
    </div>
  );
}

function DeltaBadge({ label, pct }) {
  const na = pct === null || pct === undefined;
  const up = !na && pct >= 0;
  const color = na ? 'rgba(255,255,255,0.35)' : up ? '#34d399' : '#f87171';
  return (
    <span style={{ fontSize: 11, color, whiteSpace: 'nowrap' }}>
      {label} {na ? 'n/a' : `${up ? '+' : ''}${pct}%`}
    </span>
  );
}

function KpiCard({ label, value, d }) {
  return (
    <div style={styles.kpiCard}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
      <div style={styles.kpiDeltas}>
        <DeltaBadge label="WoW" pct={d?.wow} />
        <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
        <DeltaBadge label="4wk" pct={d?.vs4wk} />
      </div>
    </div>
  );
}

function NarrativeBlock({ title, items, color }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...styles.narrativeHead, color }}>{title}</div>
      <ul style={styles.narrativeList}>
        {items.map((x, i) => (
          <li key={i} style={styles.narrativeItem}>
            <span style={{ color, marginRight: 6 }}>●</span>{String(x)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Collapsible({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={styles.collapsible}>
      <button onClick={() => setOpen((o) => !o)} style={styles.collapsibleHead}>
        <span>{title}</span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
          <path d="M3 5l4 4 4-4z" />
        </svg>
      </button>
      {open && <div style={styles.collapsibleBody}>{children}</div>}
    </div>
  );
}

function CompletenessBadge({ pct }) {
  if (pct == null) return null;
  const color = pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';
  const bg = pct >= 90 ? 'rgba(34,197,94,0.1)' : pct >= 70 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)';
  return (
    <div style={{ ...styles.completenessBadge, background: bg, borderColor: color + '30' }}>
      <div style={{ ...styles.completenessBar, width: `${Math.min(pct, 100)}%`, background: color }} />
      <span style={{ ...styles.completenessText, color }}>Data completeness: {pct}%</span>
    </div>
  );
}

function ReportBody({ report }) {
  const d = report.data || {};
  const n = report.narrative || {};
  const totals = d.totals || {};
  const audience = d.audience || {};
  const reach = d.reach || {};
  const revenue = d.revenue || {};
  const content = d.content || {};
  const cadence = d.cadence || [];
  const gained = audience.gained_by_platform || {};
  const viewsByP = reach.views_by_platform || {};
  const hasNarrative = n.wins || n.watch_outs || n.recommendations;

  return (
    <>
      {d.data_completeness_pct != null && <CompletenessBadge pct={d.data_completeness_pct} />}

      {d.narrative_failed && (
        <div style={styles.aiBanner}>AI summary unavailable for this report. KPI data below is still accurate.</div>
      )}

      {n.headline && <div style={styles.headline}>{n.headline}</div>}

      {/* KPI cards — always shown */}
      <div style={styles.kpiGrid}>
        <KpiCard label="Views" value={fmtNum(totals.views?.value)} d={totals.views} />
        <KpiCard label="Followers gained" value={fmtSigned(totals.followers_gained?.value)} d={totals.followers_gained} />
        <KpiCard label="Engagement" value={fmtNum(totals.engagement?.value)} d={totals.engagement} />
        <KpiCard label="Revenue" value={fmtUsd(totals.revenue_cents?.value)} d={totals.revenue_cents} />
      </div>

      {/* Narrative — always shown */}
      {hasNarrative && (
        <div style={styles.card}>
          <NarrativeBlock title="Wins" items={n.wins} color="#34d399" />
          <NarrativeBlock title="Watch-outs" items={n.watch_outs} color="#fbbf24" />
          <NarrativeBlock title="Recommendations" items={n.recommendations} color="#a5b4fc" />
        </div>
      )}

      {/* Collapsible detail sections */}
      <Collapsible title="Audience growth">
        {Object.keys(gained).length === 0 ? <div style={styles.muted}>No data</div> : (
          Object.entries(gained).sort((a, b) => b[1] - a[1]).map(([p, v]) => (
            <div key={p} style={styles.rowLine}>
              <span style={styles.platName}>{p}</span>
              <span style={{ color: v >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>{fmtSigned(v)}</span>
            </div>
          ))
        )}
      </Collapsible>

      <Collapsible title="Views by platform">
        {Object.keys(viewsByP).length === 0 ? <div style={styles.muted}>No data</div> : (
          Object.entries(viewsByP).sort((a, b) => (b[1].views || 0) - (a[1].views || 0)).map(([p, v]) => (
            <div key={p} style={styles.rowLine}>
              <span style={styles.platName}>{p}</span>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{fmtNum(v.views)}</span>
            </div>
          ))
        )}
      </Collapsible>

      <Collapsible title="Revenue">
        <div style={styles.rowLine}><span style={styles.platName}>Total (net + YouTube est.)</span><span style={styles.revVal}>{fmtUsd(revenue.total_cents)}</span></div>
        <div style={styles.rowLine}><span style={styles.platName}>Direct net</span><span style={styles.revVal}>{fmtUsd(revenue.net_cents)}</span></div>
        <div style={styles.rowLine}><span style={styles.platName}>Gross</span><span style={styles.revVal}>{fmtUsd(revenue.gross_cents)}</span></div>
        {revenue.margin_pct != null && <div style={styles.rowLine}><span style={styles.platName}>Net margin</span><span style={styles.revVal}>{revenue.margin_pct}%</span></div>}
        <div style={styles.rowLine}><span style={styles.platName}>YouTube est. / RPM</span><span style={styles.revVal}>{fmtUsd(revenue.youtube_est_cents)} · ${revenue.youtube_rpm ?? 0}</span></div>
      </Collapsible>

      <Collapsible title="Cadence vs goals">
        {(!cadence || cadence.length === 0) ? <div style={styles.muted}>No goals set for this month</div> : (
          cadence.map((c, i) => (
            <div key={i} style={styles.rowLine}>
              <span style={styles.platName}>{c.source}</span>
              <span style={{ color: c.met ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
                {c.published}/{c.weekly_target} {c.met ? '✓' : ''}
              </span>
            </div>
          ))
        )}
      </Collapsible>

      <Collapsible title="Top content this week">
        <ContentList rows={content.top} />
      </Collapsible>

      {Array.isArray(content.bottom) && content.bottom.length > 0 && (
        <Collapsible title="Lowest performers">
          <ContentList rows={content.bottom} />
        </Collapsible>
      )}

      <div style={styles.generatedAt}>
        Generated {report.generated_at ? new Date(report.generated_at).toLocaleString() : ''}
      </div>
    </>
  );
}

function ContentList({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return <div style={styles.muted}>No content published this week</div>;
  return (
    <div>
      {rows.map((c, i) => (
        <div key={i} style={styles.contentRow}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={styles.contentTitle}>
              {c.url ? <a href={c.url} target="_blank" rel="noreferrer" style={styles.link}>{c.title}</a> : c.title}
            </div>
            <div style={styles.contentSub}>{c.platform}{c.engagement_rate ? ` · ${Number(c.engagement_rate).toFixed(1)}% eng` : ''}</div>
          </div>
          <span style={styles.contentViews}>{fmtNum(c.views)}</span>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Platform KPIs ───────────────────────── */

function PlatformKpisTab() {
  const [accounts, setAccounts] = useState([]);
  const [stats, setStats] = useState({}); // accountId -> { followers, gained, views, engagement, revenue_cents }
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const { data: accts } = await supabase
        .from('platform_accounts')
        .select('*')
        .eq('is_active', true)
        .order('platform');
      const list = accts || [];
      setAccounts(list);
      const ids = list.map((a) => a.id);
      const start = daysAgoStr(30);

      if (ids.length === 0) { setStats({}); setLoading(false); return; }

      const [audRes, pdmRes, revRes] = await Promise.all([
        supabase.from('audience_snapshots')
          .select('platform_account_id, date, followers_total, followers_gained')
          .in('platform_account_id', ids).gte('date', start),
        supabase.from('platform_daily_metrics')
          .select('platform_account_id, date, views, likes, comments, shares')
          .in('platform_account_id', ids).gte('date', start),
        supabase.from('revenue_events')
          .select('platform_account_id, occurred_at, amount_cents, net_amount_cents')
          .in('platform_account_id', ids).gte('occurred_at', start),
      ]);

      const acc = {};
      ids.forEach((id) => { acc[id] = { followers: null, latestDate: '', gained: 0, views: 0, engagement: 0, revenue_cents: 0 }; });

      for (const r of audRes.data || []) {
        const s = acc[r.platform_account_id]; if (!s) continue;
        s.gained += r.followers_gained || 0;
        if (!s.latestDate || r.date > s.latestDate) { s.latestDate = r.date; s.followers = r.followers_total; }
      }
      for (const r of pdmRes.data || []) {
        const s = acc[r.platform_account_id]; if (!s) continue;
        s.views += r.views || 0;
        s.engagement += (r.likes || 0) + (r.comments || 0) + (r.shares || 0);
      }
      for (const r of revRes.data || []) {
        const s = acc[r.platform_account_id]; if (!s) continue;
        s.revenue_cents += (r.net_amount_cents ?? r.amount_cents) || 0;
      }
      setStats(acc);
    } catch (err) {
      console.error('Platform KPIs fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <p style={styles.empty}>Loading…</p>;

  const totalFollowers = accounts.reduce((s, a) => s + (stats[a.id]?.followers || 0), 0);
  const totalGained = accounts.reduce((s, a) => s + (stats[a.id]?.gained || 0), 0);

  return (
    <div style={styles.tabBody}>
      <div style={styles.totalCard}>
        <div style={styles.totalLabel}>Total followers</div>
        <div style={styles.totalValue}>{fmtCount(totalFollowers)}</div>
        <div style={styles.totalDelta}>
          <span style={{ color: totalGained >= 0 ? '#86efac' : '#fca5a5' }}>
            {totalGained >= 0 ? '+' : ''}{fmtCount(Math.abs(totalGained))}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.45)', marginLeft: 6 }}>past 30 days</span>
        </div>
      </div>

      <div style={styles.accountList}>
        {accounts.map((acct) => {
          const meta = PLATFORM_META[acct.platform] || { label: acct.platform, color: '#94a3b8', icon: '?' };
          const s = stats[acct.id] || {};
          return (
            <div key={acct.id} style={styles.acctCard}>
              <div style={styles.acctTop}>
                <div style={{ ...styles.acctIcon, background: `${meta.color}22`, color: meta.color }}>{meta.icon}</div>
                <div style={styles.acctBody}>
                  <div style={styles.acctHeader}>
                    <span style={styles.acctName}>{acct.account_name || meta.label}</span>
                    <span style={styles.acctPlatform}>{meta.label}</span>
                  </div>
                  <div style={styles.acctStats}>
                    <span style={styles.acctFollowers}>{fmtCount(s.followers)}</span>
                    <span style={styles.acctFollowersLabel}>followers</span>
                    {s.gained != null && (
                      <span style={{ ...styles.acctDelta, color: s.gained >= 0 ? '#86efac' : '#fca5a5' }}>
                        {s.gained >= 0 ? '+' : ''}{fmtCount(Math.abs(s.gained))}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div style={styles.metricRow}>
                <Metric label="Views" value={fmtCount(s.views)} />
                <Metric label="Engagement" value={fmtCount(s.engagement)} />
                <Metric label="Revenue" value={fmtUsd(s.revenue_cents)} />
              </div>
            </div>
          );
        })}
      </div>

      <p style={styles.footer}>Views, engagement & revenue are the last 30 days. For charts and content performance, open Mayday Studio on desktop.</p>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricValue}>{value}</div>
      <div style={styles.metricLabel}>{label}</div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100%',
    background: '#0f0f1a',
    color: '#e2e8f0',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.md,
  },
  tabs: { display: 'flex', gap: 6 },
  tab: {
    flex: 1, minHeight: 38, padding: '8px 12px', borderRadius: mobileTokens.radius.pill,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.55)', fontSize: mobileTokens.font.sm, fontWeight: 600,
    fontFamily: 'inherit', cursor: 'pointer',
  },
  tabActive: { background: 'rgba(99,102,241,0.18)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' },
  tabBody: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md },
  empty: { color: 'rgba(255,255,255,0.4)', textAlign: 'center', fontSize: mobileTokens.font.md, padding: mobileTokens.space.xxl, margin: 0 },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: mobileTokens.font.md, textAlign: 'center', padding: `${mobileTokens.space.xl}px ${mobileTokens.space.md}px` },

  // Weekly report controls
  reportControls: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  weekSelect: {
    flex: 1, minWidth: 140, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '8px 10px', fontFamily: 'inherit',
  },
  genBtn: {
    padding: '8px 14px', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 8, color: '#a5b4fc', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
  },

  headline: { color: '#e2e8f0', fontSize: 15, fontWeight: 600, lineHeight: 1.45 },

  kpiGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  kpiCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px' },
  kpiLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 },
  kpiValue: { fontSize: 20, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' },
  kpiDeltas: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 },

  card: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 14 },
  narrativeHead: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 },
  narrativeList: { margin: 0, padding: 0, listStyle: 'none' },
  narrativeItem: { color: 'rgba(255,255,255,0.78)', fontSize: 13, lineHeight: 1.5, marginBottom: 6, display: 'flex' },

  collapsible: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' },
  collapsibleHead: {
    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
    color: '#cbd5e1', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', textAlign: 'left',
  },
  collapsibleBody: { padding: '0 14px 12px' },

  rowLine: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 },
  platName: { color: 'rgba(255,255,255,0.7)', textTransform: 'capitalize' },
  revVal: { color: '#e2e8f0', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  muted: { color: 'rgba(255,255,255,0.35)', fontSize: 13, padding: '6px 0' },

  contentRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  contentTitle: { fontSize: 13, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  contentSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'capitalize', marginTop: 2 },
  contentViews: { fontSize: 13, fontWeight: 600, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  link: { color: '#a5b4fc', textDecoration: 'none' },

  generatedAt: { color: 'rgba(255,255,255,0.3)', fontSize: 11, textAlign: 'right' },

  completenessBadge: { position: 'relative', overflow: 'hidden', borderRadius: 8, border: '1px solid', padding: '8px 14px' },
  completenessBar: { position: 'absolute', top: 0, left: 0, bottom: 0, opacity: 0.15 },
  completenessText: { position: 'relative', fontSize: 12, fontWeight: 600 },
  aiBanner: {
    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8,
    padding: '10px 14px', color: '#fbbf24', fontSize: 13, fontWeight: 500,
  },

  // Platform KPIs
  totalCard: {
    background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(129,140,248,0.08))',
    border: '1px solid rgba(99,102,241,0.25)', borderRadius: mobileTokens.radius.lg,
    padding: mobileTokens.space.lg, display: 'flex', flexDirection: 'column', gap: 4,
  },
  totalLabel: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 },
  totalValue: { fontSize: mobileTokens.font.title, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px', lineHeight: 1.1 },
  totalDelta: { fontSize: mobileTokens.font.sm, fontWeight: 600 },
  accountList: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
  acctCard: { padding: mobileTokens.space.md, background: 'rgba(255,255,255,0.04)', borderRadius: mobileTokens.radius.md, display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md },
  acctTop: { display: 'flex', gap: mobileTokens.space.md },
  acctIcon: { width: 44, height: 44, borderRadius: mobileTokens.radius.sm, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: mobileTokens.font.lg, fontWeight: 700, flexShrink: 0 },
  acctBody: { flex: 1, minWidth: 0 },
  acctHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: mobileTokens.space.sm },
  acctName: { fontSize: mobileTokens.font.md, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  acctPlatform: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, flexShrink: 0 },
  acctStats: { marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 6 },
  acctFollowers: { fontSize: mobileTokens.font.lg, fontWeight: 700, color: '#e2e8f0' },
  acctFollowersLabel: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)' },
  acctDelta: { marginLeft: 'auto', fontSize: mobileTokens.font.sm, fontWeight: 700 },
  metricRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: mobileTokens.space.md },
  metric: { textAlign: 'center' },
  metricValue: { fontSize: mobileTokens.font.md, fontWeight: 700, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' },
  metricLabel: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 },

  footer: {
    marginTop: mobileTokens.space.md, padding: mobileTokens.space.md,
    background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)',
    borderRadius: mobileTokens.radius.sm, color: 'rgba(255,255,255,0.55)',
    fontSize: mobileTokens.font.sm, textAlign: 'center',
  },
};
