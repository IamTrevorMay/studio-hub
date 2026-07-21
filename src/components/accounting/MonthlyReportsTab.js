import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { callEdgeFn } from '../../lib/edgeFn';
import { colors } from '../../lib/styleTokens';

// Monthly accounting report viewer. Reads monthly_reports snapshots — three
// per month (combined / mayday_media / neptune_performance), generated on the
// 3rd by the generate-monthly-report edge fn. "Generate now" regenerates the
// selected month (no notification on manual runs).

const SCOPE_TABS = [
  { key: 'combined', label: 'Overall' },
  { key: 'mayday_media', label: 'Mayday Media' },
  { key: 'neptune_performance', label: 'Neptune Performance' },
];

const fmtUsd = (cents) => {
  const v = Math.round((cents || 0) / 100);
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString()}`;
};
const fmtUsdExact = (cents) => {
  const v = (cents || 0) / 100;
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function DeltaBadge({ label, pct }) {
  const na = pct === null || pct === undefined;
  const up = !na && pct >= 0;
  const color = na ? 'rgba(255,255,255,0.42)' : up ? '#34d399' : '#f87171';
  return (
    <span style={{ fontSize: 11, color, whiteSpace: 'nowrap' }}>
      {label} {na ? 'n/a' : `${up ? '+' : ''}${pct}%`}
    </span>
  );
}

// invert: for expenses, growth is bad — flip the badge colors.
function KpiCard({ label, value, d, invert }) {
  const badge = (lbl, pct) => {
    const na = pct === null || pct === undefined;
    const up = !na && pct >= 0;
    const good = invert ? !up : up;
    const color = na ? 'rgba(255,255,255,0.42)' : good ? '#34d399' : '#f87171';
    return (
      <span key={lbl} style={{ fontSize: 11, color, whiteSpace: 'nowrap' }}>
        {lbl} {na ? 'n/a' : `${up ? '+' : ''}${pct}%`}
      </span>
    );
  };
  return (
    <div style={styles.kpiCard}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
      {d && (
        <div style={styles.kpiDeltas}>
          {badge('MoM', d.mom)}
          <span style={styles.dot}>·</span>
          {badge('3mo', d.vs3mo)}
          <span style={styles.dot}>·</span>
          {badge('YoY', d.yoy)}
        </div>
      )}
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

export default function MonthlyReportsTab() {
  const [reports, setReports] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [scope, setScope] = useState('combined');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchReports = useCallback(async () => {
    const { data, error } = await supabase
      .from('monthly_reports')
      .select('id, month_start, month_end, scope, data, narrative, generated_at')
      .order('month_start', { ascending: false })
      .limit(72); // 24 months × 3 scopes
    if (!error) {
      setReports(data || []);
      setSelectedMonth((prev) => prev || (data && data[0] ? data[0].month_start : null));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const months = useMemo(
    () => [...new Set(reports.map((r) => r.month_start))],
    [reports]
  );
  const report = reports.find((r) => r.month_start === selectedMonth && r.scope === scope);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      // Regenerate the selected month; with nothing selected the edge fn
      // defaults to the previous calendar month.
      await callEdgeFn('generate-monthly-report', selectedMonth ? { month_start: selectedMonth } : {});
      await fetchReports();
    } catch (err) {
      console.error('Generate failed:', err);
      window.alert(err.message || 'Generation failed');
    }
    setGenerating(false);
  };

  if (loading) return <p style={styles.loadingText}>Loading monthly reports…</p>;

  return (
    <div>
      <div style={styles.header}>
        {months.length > 0 && (
          <select
            value={selectedMonth || ''}
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={styles.monthSelect}
          >
            {months.map((m) => {
              const any = reports.find((r) => r.month_start === m);
              return <option key={m} value={m}>{any?.data?.window?.label || m}</option>;
            })}
          </select>
        )}
        <div style={styles.scopeBar}>
          {SCOPE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setScope(t.key)}
              style={{ ...styles.scopePill, ...(scope === t.key ? styles.scopePillActive : {}) }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={handleGenerate} disabled={generating} style={styles.genBtn}>
          {generating ? 'Generating…' : 'Generate now'}
        </button>
      </div>

      {!report ? (
        <div style={styles.empty}>
          <p style={styles.emptyText}>
            {months.length === 0
              ? 'No monthly reports yet. They generate automatically on the 3rd of each month — or click “Generate now” to build last month’s report.'
              : 'No report for this month and business yet — click “Generate now”.'}
          </p>
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
  const ytd = d.ytd || {};
  const pipeline = d.sponsor_pipeline;
  const subs = d.subscriptions || {};

  return (
    <>
      {d.txn_count === 0 && (
        <div style={styles.warnBanner}>
          No transactions recorded for this month — the Tiller sync may be behind. Sync and regenerate.
        </div>
      )}
      {d.narrative_failed && (
        <div style={styles.warnBanner}>
          AI summary unavailable for this report. The numbers below are still accurate.
        </div>
      )}

      {n.headline && <div style={styles.headline}>{n.headline}</div>}

      {/* KPI cards */}
      <div style={styles.kpiGrid}>
        <KpiCard label="Revenue" value={fmtUsd(totals.revenue?.value)} d={totals.revenue} />
        <KpiCard label="Expenses" value={fmtUsd(totals.expenses?.value)} d={totals.expenses} invert />
        <KpiCard label="Net" value={fmtUsd(totals.net?.value)} d={totals.net} />
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Net margin</div>
          <div style={styles.kpiValue}>{totals.margin_pct != null ? `${totals.margin_pct}%` : '—'}</div>
          <div style={{ ...styles.kpiDeltas, fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>
            YTD {ytd.year}: {fmtUsd(ytd.revenue)} in · {fmtUsd(ytd.expenses)} out · {fmtUsd(ytd.net)} net
          </div>
        </div>
      </div>

      {/* AI narrative */}
      {(n.wins || n.watch_outs || n.recommendations) && (
        <div style={styles.card}>
          <div style={styles.narrativeRow}>
            <NarrativeBlock title="Wins" items={n.wins} color="#34d399" />
            <NarrativeBlock title="Watch-outs" items={n.watch_outs} color="#fbbf24" />
            <NarrativeBlock title="Recommendations" items={n.recommendations} color="#8fb4d8" />
          </div>
        </div>
      )}

      {/* Category P&L tables */}
      <div style={styles.twoCol}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Revenue by category</div>
          <CategoryTable rows={d.revenue_by_category} />
        </div>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Expenses by category</div>
          <CategoryTable rows={d.expenses_by_category} invert />
        </div>
      </div>

      <div style={styles.twoCol}>
        {/* Sponsor pipeline (Mayday + combined only) */}
        {pipeline && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Sponsor pipeline</div>
            <div style={styles.rowLine}><span style={styles.rowName}>Booked this month (Sponsorship Income)</span><span style={styles.rowVal}>{fmtUsd(pipeline.booked_cents)}</span></div>
            <div style={styles.rowLine}><span style={styles.rowName}>Expected (not yet delivered)</span><span style={styles.rowVal}>{fmtUsd(pipeline.expected)}</span></div>
            <div style={styles.rowLine}><span style={styles.rowName}>Outstanding (delivered, in window)</span><span style={styles.rowVal}>{fmtUsd(pipeline.outstanding)}</span></div>
            <div style={styles.rowLine}>
              <span style={styles.rowName}>Late (45+ days)</span>
              <span style={{ ...styles.rowVal, color: pipeline.late > 0 ? '#f87171' : undefined }}>{fmtUsd(pipeline.late)}</span>
            </div>
            <div style={styles.rowLine}><span style={styles.rowName}>Total incoming</span><span style={styles.rowVal}>{fmtUsd(pipeline.incoming)}</span></div>
            <div style={styles.asOf}>Pipeline as of {pipeline.as_of} (snapshot at generation, not month end)</div>
          </div>
        )}

        {/* Subscriptions audit */}
        <div style={styles.card}>
          <div style={styles.cardTitleRow}>
            <span style={styles.cardTitle}>Subscriptions</span>
            <span style={styles.subsTotal}>
              {fmtUsdExact(subs.total)}
              {subs.mom != null && (
                <span style={{ marginLeft: 8 }}>
                  <DeltaBadge label="MoM" pct={subs.mom} />
                </span>
              )}
            </span>
          </div>
          {(!subs.vendors || subs.vendors.length === 0) ? (
            <div style={styles.muted}>No subscription charges this month</div>
          ) : (
            subs.vendors.map((v, i) => <VendorRow key={i} v={v} />)
          )}
          {Array.isArray(subs.gone) && subs.gone.map((g, i) => (
            <div key={`gone-${i}`} style={styles.rowLine}>
              <span style={{ ...styles.rowName, color: 'rgba(255,255,255,0.42)' }}>{titleCase(g.vendor)}</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)' }}>✕ gone (was {fmtUsdExact(g.prev_total)})</span>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.generatedAt}>
        {d.txn_count != null && <span>{d.txn_count.toLocaleString()} transactions · </span>}
        Generated {report.generated_at ? new Date(report.generated_at).toLocaleString() : ''}
      </div>
    </>
  );
}

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function VendorRow({ v }) {
  const tag = (() => {
    switch (v.status) {
      case 'new': return <span style={{ color: colors.accentFg }}>✦ new</span>;
      case 'returned': return <span style={{ color: colors.accentFg }}>↩ returned</span>;
      case 'increased': return <span style={{ color: '#f87171' }}>▲ was {fmtUsdExact(v.prev_total)}</span>;
      case 'decreased': return <span style={{ color: '#34d399' }}>▼ was {fmtUsdExact(v.prev_total)}</span>;
      default: return <span style={{ color: 'rgba(255,255,255,0.35)' }}>→</span>;
    }
  })();
  return (
    <div style={styles.rowLine}>
      <span style={styles.rowName} title={v.category}>{titleCase(v.vendor)}</span>
      <span style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
        {tag}
        <span style={styles.rowVal}>{fmtUsdExact(v.total)}</span>
      </span>
    </div>
  );
}

function CategoryTable({ rows, invert }) {
  if (!Array.isArray(rows) || rows.length === 0) return <div style={styles.muted}>No transactions</div>;
  const badgeCell = (pct) => {
    const na = pct === null || pct === undefined;
    const up = !na && pct >= 0;
    const good = invert ? !up : up;
    const color = na ? 'rgba(255,255,255,0.35)' : good ? '#34d399' : '#f87171';
    return <span style={{ color }}>{na ? '—' : `${up ? '+' : ''}${pct}%`}</span>;
  };
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Category</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>MoM</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>3mo</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>YoY</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={styles.td}>{r.category}</td>
            <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtUsd(r.value)}</td>
            <td style={{ ...styles.td, textAlign: 'right', fontSize: 12 }}>{badgeCell(r.mom)}</td>
            <td style={{ ...styles.td, textAlign: 'right', fontSize: 12 }}>{badgeCell(r.vs3mo)}</td>
            <td style={{ ...styles.td, textAlign: 'right', fontSize: 12 }}>{badgeCell(r.yoy)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const styles = {
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  monthSelect: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    color: '#e7ebf2', fontSize: 13, padding: '6px 10px', fontFamily: 'inherit', cursor: 'pointer',
  },
  scopeBar: { display: 'flex', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 3 },
  scopePill: {
    padding: '5px 12px', background: 'transparent', border: 'none', borderRadius: 6,
    color: 'rgba(255,255,255,0.55)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  },
  scopePillActive: { background: colors.accentSoft, color: colors.accentFg, fontWeight: 600 },
  genBtn: {
    marginLeft: 'auto', padding: '6px 14px', background: colors.accentA12,
    border: '1px solid rgba(91, 143, 199,0.3)', borderRadius: 8, color: colors.accentFg,
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  headline: { color: '#e7ebf2', fontSize: 16, fontWeight: 600, lineHeight: 1.45, margin: '4px 0 18px' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 },
  kpiCard: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '14px 16px' },
  kpiLabel: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 },
  kpiValue: { fontSize: 24, fontWeight: 700, color: '#e7ebf2', fontVariantNumeric: 'tabular-nums' },
  kpiDeltas: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  dot: { color: 'rgba(255,255,255,0.15)' },
  card: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  cardTitleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, gap: 12, flexWrap: 'wrap' },
  subsTotal: { color: '#e7ebf2', fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 },
  rowLine: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 13, gap: 12 },
  rowName: { color: 'rgba(255,255,255,0.72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowVal: { color: '#e7ebf2', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  asOf: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 10 },
  narrativeRow: { display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12 },
  narrativeHead: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 },
  narrativeList: { margin: 0, padding: 0, listStyle: 'none' },
  narrativeItem: { color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 1.5, marginBottom: 6, display: 'flex' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 11, color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td: { fontSize: 13, color: '#e7ebf2', padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  muted: { color: 'rgba(255,255,255,0.42)', fontSize: 13, padding: '6px 0' },
  loadingText: { color: 'rgba(255,255,255,0.42)', fontSize: 14, padding: '20px 0' },
  empty: { padding: '60px 20px', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.42)', fontSize: 14, maxWidth: 460, margin: '0 auto' },
  generatedAt: { color: 'rgba(255,255,255,0.42)', fontSize: 11, textAlign: 'right', marginTop: 4 },
  warnBanner: {
    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
    borderRadius: 8, padding: '10px 14px', marginBottom: 12,
    color: '#fbbf24', fontSize: 13, fontWeight: 500,
  },
};
