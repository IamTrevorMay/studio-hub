import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';
import { callEdgeFn } from '../../../lib/edgeFn';
import { useAuth } from '../../../contexts/AuthContext';

// Weekly KPI report viewer. Reads weekly_reports snapshots (generated every
// Saturday by the generate-weekly-report edge fn). Admins can force a refresh
// of the current week via "Generate now" (no email/notification on manual run).

const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtUsd = (cents) => `$${Math.round((cents || 0) / 100).toLocaleString()}`;
const fmtSigned = (n) => `${n >= 0 ? '+' : ''}${Number(n || 0).toLocaleString()}`;

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
    <div style={{ flex: 1, minWidth: 220 }}>
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

export default function WeeklyReport() {
  const { isAdmin } = useAuth();
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

  if (loading) return <p style={styles.loadingText}>Loading weekly report…</p>;

  const report = reports.find((r) => r.id === selectedId) || reports[0];

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.title}>Weekly Report</h2>
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
        <div style={styles.empty}>
          <p style={styles.emptyText}>No weekly reports yet. They generate automatically every Saturday — or click “Generate now”.</p>
        </div>
      ) : (
        <ReportBody report={report} />
      )}
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

  return (
    <>
      {n.headline && <div style={styles.headline}>{n.headline}</div>}

      {/* KPI cards */}
      <div style={styles.kpiGrid}>
        <KpiCard label="Views" value={fmtNum(totals.views?.value)} d={totals.views} />
        <KpiCard label="Followers gained" value={fmtSigned(totals.followers_gained?.value)} d={totals.followers_gained} />
        <KpiCard label="Engagement" value={fmtNum(totals.engagement?.value)} d={totals.engagement} />
        <KpiCard label="Revenue" value={fmtUsd(totals.revenue_cents?.value)} d={totals.revenue_cents} />
      </div>

      {/* AI narrative */}
      {(n.wins || n.watch_outs || n.recommendations) && (
        <div style={styles.card}>
          <div style={styles.narrativeRow}>
            <NarrativeBlock title="Wins" items={n.wins} color="#34d399" />
            <NarrativeBlock title="Watch-outs" items={n.watch_outs} color="#fbbf24" />
            <NarrativeBlock title="Recommendations" items={n.recommendations} color="#a5b4fc" />
          </div>
        </div>
      )}

      <div style={styles.twoCol}>
        {/* Audience growth by platform */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Audience growth</div>
          {Object.keys(gained).length === 0 ? <div style={styles.muted}>No data</div> : (
            Object.entries(gained).sort((a, b) => b[1] - a[1]).map(([p, v]) => (
              <div key={p} style={styles.rowLine}>
                <span style={styles.platName}>{p}</span>
                <span style={{ color: v >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>{fmtSigned(v)}</span>
              </div>
            ))
          )}
        </div>

        {/* Reach by platform */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Views by platform</div>
          {Object.keys(viewsByP).length === 0 ? <div style={styles.muted}>No data</div> : (
            Object.entries(viewsByP).sort((a, b) => (b[1].views || 0) - (a[1].views || 0)).map(([p, v]) => (
              <div key={p} style={styles.rowLine}>
                <span style={styles.platName}>{p}</span>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{fmtNum(v.views)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Revenue + cadence */}
      <div style={styles.twoCol}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Revenue</div>
          <div style={styles.rowLine}><span style={styles.platName}>Total (net + YouTube est.)</span><span style={styles.revVal}>{fmtUsd(revenue.total_cents)}</span></div>
          <div style={styles.rowLine}><span style={styles.platName}>Direct net</span><span style={styles.revVal}>{fmtUsd(revenue.net_cents)}</span></div>
          <div style={styles.rowLine}><span style={styles.platName}>Gross</span><span style={styles.revVal}>{fmtUsd(revenue.gross_cents)}</span></div>
          {revenue.margin_pct != null && <div style={styles.rowLine}><span style={styles.platName}>Net margin</span><span style={styles.revVal}>{revenue.margin_pct}%</span></div>}
          <div style={styles.rowLine}><span style={styles.platName}>YouTube est. / RPM</span><span style={styles.revVal}>{fmtUsd(revenue.youtube_est_cents)} · ${revenue.youtube_rpm ?? 0}</span></div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>Cadence vs goals</div>
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
        </div>
      </div>

      {/* Top / bottom content */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Top content this week</div>
        <ContentTable rows={content.top} />
      </div>
      {Array.isArray(content.bottom) && content.bottom.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardTitle}>Lowest performers</div>
          <ContentTable rows={content.bottom} />
        </div>
      )}

      <div style={styles.generatedAt}>
        Generated {report.generated_at ? new Date(report.generated_at).toLocaleString() : ''}
      </div>
    </>
  );
}

function ContentTable({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return <div style={styles.muted}>No content published this week</div>;
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Title</th>
          <th style={styles.th}>Platform</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>Views</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>Eng. rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c, i) => (
          <tr key={i}>
            <td style={styles.td}>
              {c.url ? <a href={c.url} target="_blank" rel="noreferrer" style={styles.link}>{c.title}</a> : c.title}
            </td>
            <td style={{ ...styles.td, color: 'rgba(255,255,255,0.5)' }}>{c.platform}</td>
            <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(c.views)}</td>
            <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.engagement_rate ? `${Number(c.engagement_rate).toFixed(1)}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const styles = {
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' },
  weekSelect: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    color: '#e2e8f0', fontSize: 13, padding: '6px 10px', fontFamily: 'inherit', cursor: 'pointer',
  },
  genBtn: {
    marginLeft: 'auto', padding: '6px 14px', background: 'rgba(99,102,241,0.12)',
    border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, color: '#a5b4fc',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  headline: { color: '#e2e8f0', fontSize: 16, fontWeight: 600, lineHeight: 1.45, margin: '4px 0 18px' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 },
  kpiCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '14px 16px' },
  kpiLabel: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 },
  kpiValue: { fontSize: 24, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' },
  kpiDeltas: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 },
  card: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 13, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 },
  rowLine: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 },
  platName: { color: 'rgba(255,255,255,0.7)', textTransform: 'capitalize' },
  revVal: { color: '#e2e8f0', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  narrativeRow: { display: 'flex', gap: 24, flexWrap: 'wrap' },
  narrativeHead: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 },
  narrativeList: { margin: 0, padding: 0, listStyle: 'none' },
  narrativeItem: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 1.5, marginBottom: 6, display: 'flex' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td: { fontSize: 13, color: '#e2e8f0', padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  link: { color: '#a5b4fc', textDecoration: 'none' },
  muted: { color: 'rgba(255,255,255,0.35)', fontSize: 13, padding: '6px 0' },
  loadingText: { color: 'rgba(255,255,255,0.4)', fontSize: 14, padding: '20px 0' },
  empty: { padding: '60px 20px', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: 14, maxWidth: 420, margin: '0 auto' },
  generatedAt: { color: 'rgba(255,255,255,0.3)', fontSize: 11, textAlign: 'right', marginTop: 4 },
};
