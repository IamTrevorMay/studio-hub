import React from 'react';
import FieldInput from './FieldInput';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { fmtCents, fmtPct, fmtNumber, READOUT_ROWS } from '../../../lib/marginModel';

// Workbook tab 6. You do not aim at these numbers — you set each bucket for its
// own reasons and read what comes out. The blended figure especially: when it
// moves, it is telling you your revenue mix moved, not that you did something
// wrong.

export default function ReadoutPanel({ model, onSetInput, onClearInput, onRecalculate, onSetRevenueTag, settings, saving }) {
  const { readoutRows, readout, totals, fields, revenueSummary } = model;

  const field = (section, key, subjectId) => ({
    onCommit: (v) => onSetInput(section, key, subjectId, v),
    onReset: () => onClearInput(section, key, subjectId),
  });

  return (
    <div>
      <section style={styles.section}>
        <div style={styles.sectionHead}>
          <div>
            <h3 style={styles.sectionTitle}>6 · The company readout</h3>
            <p style={styles.blurb}>
              Revenue and direct cost by bucket, then fixed overhead subtracted once at company level. Booked Tiller
              revenue wins where a category exists; rows without one fall back to price × units from the Products tab.
            </p>
          </div>
          <button type="button" style={styles.recalcBtn} onClick={() => onRecalculate('readout')} disabled={saving}>
            Recalculate
          </button>
        </div>

        <div style={styles.scroller}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Bucket</th>
                <th style={styles.thNum}>Monthly revenue</th>
                <th style={styles.thNum}>Monthly direct cost</th>
                <th style={styles.thNum}>Gross profit</th>
                <th style={styles.thNum}>Gross margin</th>
                <th style={styles.th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {readoutRows.map(row => (
                <tr key={row.key}>
                  <td style={styles.td}>
                    {row.label}
                    <div style={styles.subtle}>{row.note}</div>
                  </td>
                  <td style={styles.tdField}>
                    <FieldInput resolved={row.revenueField} kind="money" width={110} {...field('readout', 'revenue_monthly_cents', row.key)} />
                  </td>
                  <td style={styles.tdField}>
                    <FieldInput resolved={row.costField} kind="money" width={110} {...field('readout', 'direct_cost_monthly_cents', row.key)} />
                  </td>
                  <td style={styles.tdNum}>{fmtCents(row.grossCents)}</td>
                  <td style={styles.tdNum}>
                    {fmtPct(row.revenueCents ? row.grossCents / row.revenueCents : null)}
                  </td>
                  <td style={styles.td}>
                    <SourceTag source={row.revenueSource} />
                  </td>
                </tr>
              ))}

              <tr style={styles.subtotalRow}>
                <td style={{ ...styles.td, fontWeight: fontWeights.semibold }}>Labour subtotal</td>
                <td style={styles.tdNumStrong}>{fmtCents(readout.labour.revenueCents)}</td>
                <td style={styles.tdNumStrong}>{fmtCents(readout.labour.costCents)}</td>
                <td style={styles.tdNumStrong}>{fmtCents(readout.labour.grossCents)}</td>
                <td style={styles.tdNumStrong}>{fmtPct(readout.labour.margin)}</td>
                <td style={{ ...styles.td, ...styles.subtle }}>Target 25–30% until recurring covers the base</td>
              </tr>
              <tr style={styles.subtotalRow}>
                <td style={{ ...styles.td, fontWeight: fontWeights.semibold }}>Recurring subtotal</td>
                <td style={styles.tdNumStrong}>{fmtCents(readout.recurring.revenueCents)}</td>
                <td style={styles.tdNumStrong}>{fmtCents(readout.recurring.costCents)}</td>
                <td style={styles.tdNumStrong}>{fmtCents(readout.recurring.grossCents)}</td>
                <td style={styles.tdNumStrong}>{fmtPct(readout.recurring.margin)}</td>
                <td style={{ ...styles.td, ...styles.subtle }}>Should be high — this is where surplus is given back on purpose</td>
              </tr>
              <tr style={styles.totalRow}>
                <td style={{ ...styles.td, fontWeight: fontWeights.bold }}>Company total</td>
                <td style={styles.tdNumStrong}>{fmtCents(readout.total.revenueCents)}</td>
                <td style={styles.tdNumStrong}>{fmtCents(readout.total.costCents)}</td>
                <td style={styles.tdNumStrong}>{fmtCents(readout.total.grossCents)}</td>
                <td style={styles.tdNumStrong}>{fmtPct(readout.total.margin)}</td>
                <td style={{ ...styles.td, ...styles.subtle }}>Blended gross margin — a readout, not a goal</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={styles.opRow}>
          <Totline label="Monthly fixed overhead" value={fmtCents(totals.monthlyOverheadCents)} />
          <Totline label="Operating profit" value={fmtCents(readout.operatingProfitCents)} strong />
          <Totline label="Operating margin" value={fmtPct(readout.operatingMargin)} strong />
        </div>
        <p style={styles.note}>
          Operating margin is the Costco-comparable figure, and Costco's is about 3%. Their famous 11% is a gross
          margin — the two get conflated constantly.
        </p>
      </section>

      {/* ── Expansion recovery ───────────────────────────────────── */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Expansion recovery</h3>
        <p style={styles.blurb}>
          The point of measuring recovery time is to give yourself permission to be patient, not pressure to be fast.
          If the number is uncomfortable, the honest answers are less scope, more time, or cheaper capital.
        </p>
        <div style={styles.fieldGrid}>
          <Cell label="Expansion capital deployed">
            <FieldInput resolved={fields.expansionCapital} kind="money" width={130} {...field('readout', 'expansion_capital_cents', null)} />
          </Cell>
          <Cell label="Months of runway in the bank">
            <FieldInput resolved={fields.runwayMonths} kind="count" width={80} {...field('readout', 'runway_months', null)} />
          </Cell>
          <Cell label="Months to recover">
            <Readonly>
              {readout.monthsToRecoverExpansion === null
                ? (readout.operatingProfitCents <= 0 ? 'not at a loss' : '—')
                : fmtNumber(Math.round(readout.monthsToRecoverExpansion))}
            </Readonly>
          </Cell>
          <Cell label="Profit needed to recover in 24mo">
            <Readonly>{fmtCents(readout.profitNeededFor24Months)}</Readonly>
          </Cell>
        </div>
        {readout.monthsToRecoverExpansion !== null && readout.monthsToRecoverExpansion > 36 && (
          <div style={styles.warnNote}>
            Over 36 months. That is the range where the pressure to cut corners starts — worth reducing scope or
            extending the timeline before it turns into a pricing decision.
          </div>
        )}
      </section>

      {/* ── Revenue category mapping ─────────────────────────────── */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Revenue categories</h3>
        <p style={styles.blurb}>
          Which bucket each Tiller income category rolls into. Tracers, instruction and facility SaaS have no category
          yet — when you add one to the sheet, point it at its row here rather than waiting on a deploy.
        </p>
        {untaggedRevenue(revenueSummary).length > 0 && (
          <div style={styles.warnNote}>
            {untaggedRevenue(revenueSummary).length} income{' '}
            {untaggedRevenue(revenueSummary).length === 1 ? 'category is' : 'categories are'} unmapped and counting
            toward nothing.
          </div>
        )}
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Category</th>
              <th style={styles.thNum}>Trailing 12mo</th>
              <th style={styles.th}>Rolls into</th>
            </tr>
          </thead>
          <tbody>
            {revenueSummary.byCategory.map(c => {
              const current = settings?.revenue_map?.[c.category] ?? c.bucket ?? '';
              return (
                <tr key={c.category}>
                  <td style={styles.td}>{c.category}</td>
                  <td style={styles.tdNum}>{fmtCents(c.cents)}</td>
                  <td style={styles.td}>
                    <select
                      value={current}
                      onChange={(e) => onSetRevenueTag(c.category, e.target.value || null)}
                      style={{
                        ...styles.select,
                        color: current ? colors.text : colors.warning.fg,
                        borderColor: current ? colors.border : colors.warning.border,
                      }}
                    >
                      <option value="">— unmapped —</option>
                      {READOUT_ROWS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                      <option value="excluded">Excluded from the model</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function untaggedRevenue(revenueSummary) {
  return revenueSummary.byCategory.filter(c => !c.bucket);
}

/** The four numbers that actually say how you are doing. Pinned above every tab. */
export function ReadoutHeader({ model }) {
  const { readout } = model;
  const coverage = readout.overheadCoverageByRecurring;
  return (
    <div style={styles.headerGrid}>
      <Kpi
        label="Operating margin"
        value={fmtPct(readout.operatingMargin)}
        note="Costco's is about 3%"
      />
      <Kpi
        label="Overhead coverage by recurring"
        value={fmtPct(coverage)}
        note={coverage === null
          ? 'No recurring revenue booked yet'
          : coverage >= 1
            ? 'Covered — you have earned the right to lower a labour margin'
            : 'Below 100% — lowering labour margins now is optimism'}
        tone={coverage !== null && coverage >= 1 ? 'good' : 'neutral'}
        emphasis
      />
      <Kpi
        label="Revenue that is recurring"
        value={fmtPct(readout.recurringShareOfRevenue)}
        note={readout.recurringShareOfRevenue !== null && readout.recurringShareOfRevenue < 0.2
          ? 'Under 20% — living job to job'
          : 'Stability metric. Higher is calmer'}
        tone={readout.recurringShareOfRevenue !== null && readout.recurringShareOfRevenue < 0.2 ? 'warn' : 'neutral'}
      />
      <Kpi
        label="Blended gross margin"
        value={fmtPct(readout.total.margin)}
        note="Readout, not target"
      />
    </div>
  );
}

function Kpi({ label, value, note, tone = 'neutral', emphasis }) {
  const toneColor = tone === 'good' ? colors.success.fg : tone === 'warn' ? colors.warning.fg : colors.textDim;
  return (
    <div style={{
      ...styles.kpi,
      borderColor: emphasis ? colors.accentBorder : colors.border,
      background: emphasis ? colors.accentA08 : colors.whiteA03,
    }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
      <div style={{ ...styles.kpiNote, color: toneColor }}>{note}</div>
    </div>
  );
}

function SourceTag({ source }) {
  if (source === 'tiller') return <span style={{ ...styles.tag, ...styles.tagBooked }}>booked</span>;
  if (source === 'model') return <span style={{ ...styles.tag, ...styles.tagModel }}>modelled</span>;
  return <span style={{ ...styles.tag, ...styles.tagNone }}>no source</span>;
}

function Totline({ label, value, strong }) {
  return (
    <div style={styles.totline}>
      <span style={styles.totlineLabel}>{label}</span>
      <span style={{ ...styles.totlineValue, fontWeight: strong ? fontWeights.bold : fontWeights.medium }}>{value}</span>
    </div>
  );
}

function Cell({ label, children }) {
  return (
    <div style={styles.cell}>
      <div style={styles.cellLabel}>{label}</div>
      {children}
    </div>
  );
}

function Readonly({ children }) {
  return <div style={styles.readonly}>{children}</div>;
}

const styles = {
  headerGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: spacing.md, marginBottom: spacing.lg,
  },
  kpi: { border: `1px solid ${colors.border}`, borderRadius: radii.md, padding: `${spacing.md}px ${spacing.lg}px` },
  kpiLabel: { fontSize: fontSizes.xs, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: '0.4px' },
  kpiValue: { fontSize: fontSizes.display, fontWeight: fontWeights.bold, color: colors.text, fontVariantNumeric: 'tabular-nums', margin: `${spacing.xs}px 0` },
  kpiNote: { fontSize: fontSizes.xxs, lineHeight: 1.4 },

  section: {
    background: colors.bgRaised, border: `1px solid ${colors.border}`,
    borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg,
  },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.lg },
  sectionTitle: { margin: 0, fontSize: fontSizes.xl, fontWeight: fontWeights.semibold, color: colors.text },
  blurb: { margin: `${spacing.xs}px 0 ${spacing.md}px`, fontSize: fontSizes.sm, color: colors.textSubtle, lineHeight: 1.5, maxWidth: 760 },
  recalcBtn: {
    flexShrink: 0, padding: `${spacing.xs}px ${spacing.md}px`, background: colors.accentA12,
    border: `1px solid ${colors.accentBorder}`, borderRadius: radii.sm, color: colors.accentFg,
    fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, cursor: 'pointer', fontFamily: 'inherit',
  },
  scroller: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 760 },
  th: {
    textAlign: 'left', fontSize: fontSizes.xs, color: colors.textDim, textTransform: 'uppercase',
    letterSpacing: '0.4px', padding: `${spacing.xs}px ${spacing.sm}px`,
    borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap',
  },
  get thNum() { return { ...this.th, textAlign: 'right' }; },
  td: { fontSize: fontSizes.md, color: colors.text, padding: spacing.sm, borderBottom: `1px solid ${colors.whiteA05}`, verticalAlign: 'top' },
  get tdNum() { return { ...this.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }; },
  get tdNumStrong() { return { ...this.tdNum, fontWeight: fontWeights.semibold }; },
  tdField: { padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: `1px solid ${colors.whiteA05}`, textAlign: 'right' },
  subtotalRow: { background: colors.whiteA02 },
  totalRow: { background: colors.accentA06 },
  subtle: { fontSize: fontSizes.xxs, color: colors.textDim, marginTop: spacing.xs },
  tag: { fontSize: fontSizes.xxs, borderRadius: radii.xs, padding: '1px 6px', whiteSpace: 'nowrap' },
  tagBooked: { color: colors.success.fg, background: colors.success.bg, border: `1px solid ${colors.success.border}` },
  tagModel: { color: colors.accentFg, background: colors.accentA12, border: `1px solid ${colors.accentBorder}` },
  tagNone: { color: colors.textDim, background: colors.whiteA03, border: `1px solid ${colors.border}` },
  opRow: { display: 'flex', gap: spacing.xxxl, flexWrap: 'wrap', marginTop: spacing.lg },
  totline: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  totlineLabel: { fontSize: fontSizes.xs, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: '0.4px' },
  totlineValue: { fontSize: fontSizes.xxl, color: colors.text, fontVariantNumeric: 'tabular-nums' },
  note: { fontSize: fontSizes.sm, color: colors.textDim, lineHeight: 1.6, margin: `${spacing.md}px 0 0`, maxWidth: 760 },
  fieldGrid: { display: 'flex', gap: spacing.xxl, flexWrap: 'wrap' },
  cell: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  cellLabel: { fontSize: fontSizes.xs, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: '0.4px' },
  readonly: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text, fontVariantNumeric: 'tabular-nums', padding: `${spacing.xs}px 0` },
  select: {
    background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, padding: `${spacing.xs}px ${spacing.sm}px`,
    fontFamily: 'inherit', cursor: 'pointer',
  },
  warnNote: {
    marginTop: spacing.md, fontSize: fontSizes.sm, color: colors.warning.fgSoft, lineHeight: 1.6,
    background: colors.warning.bg, border: `1px solid ${colors.warning.border}`,
    borderRadius: radii.md, padding: `${spacing.sm}px ${spacing.md}px`, maxWidth: 760,
  },
};
