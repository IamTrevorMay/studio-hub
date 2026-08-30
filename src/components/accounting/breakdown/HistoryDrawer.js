import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { fmtCents, fmtPct } from '../../../lib/marginModel';

// Workbook tabs 7–8: the quarterly close and the decision log.
//
// The guide's argument for these is that in three years the log is the record
// of whether you held your line. Snapshots are taken by hand rather than by
// cron, so a quarter is only closed when the inputs are actually current.

export default function HistoryDrawer({ model, period, onCloseQuarter, onAddDecision, onDeleteDecision, products, saving }) {
  const [snapshots, setSnapshots] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(emptyDecision());

  const loadHistory = useCallback(async () => {
    const [snapRes, decRes] = await Promise.all([
      supabase.from('margin_snapshots').select('*').order('period_end', { ascending: false }).limit(24),
      supabase.from('margin_decisions').select('*').order('decided_on', { ascending: false }).limit(100),
    ]);
    setSnapshots(snapRes.data || []);
    setDecisions(decRes.data || []);
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory, saving]);

  const closeQuarter = async () => {
    const { readout, totals } = model;
    await onCloseQuarter(`Close ${period.end}`, {
      period,
      operatingMargin: readout.operatingMargin,
      blendedMargin: readout.total.margin,
      labourMargin: readout.labour.margin,
      recurringMargin: readout.recurring.margin,
      overheadCoverageByRecurring: readout.overheadCoverageByRecurring,
      recurringShareOfRevenue: readout.recurringShareOfRevenue,
      monthlyOverheadCents: totals.monthlyOverheadCents,
      operatingProfitCents: readout.operatingProfitCents,
      breakEvenHourlyCents: totals.breakEvenHourlyCents,
      blendedRateCents: totals.blendedRateCents,
    });
    loadHistory();
  };

  return (
    <div>
      <section style={styles.section}>
        <div style={styles.sectionHead}>
          <div>
            <h3 style={styles.sectionTitle}>7 · Quarterly close</h3>
            <p style={styles.blurb}>
              Ninety minutes, four times a year. Did measured hours match what you assumed? Has overhead moved? Is any
              product below target, and is that pricing, scope or efficiency? Is coverage by recurring climbing — and
              are you anywhere near having to reduce value at the same price?
            </p>
          </div>
          <button type="button" style={styles.primaryBtn} onClick={closeQuarter} disabled={saving}>
            Close quarter ({period.end})
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div style={styles.empty}>No quarters closed yet. The first snapshot becomes the baseline everything else is read against.</div>
        ) : (
          <div style={styles.scroller}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Closed</th>
                  <th style={styles.thNum}>Operating</th>
                  <th style={styles.thNum}>Blended</th>
                  <th style={styles.thNum}>Labour</th>
                  <th style={styles.thNum}>Recurring</th>
                  <th style={styles.thNum}>OH coverage</th>
                  <th style={styles.thNum}>% recurring</th>
                  <th style={styles.thNum}>Break-even / hr</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map(s => (
                  <tr key={s.id}>
                    <td style={styles.td}>{s.period_end}</td>
                    <td style={styles.tdNum}>{fmtPct(s.data?.operatingMargin)}</td>
                    <td style={styles.tdNum}>{fmtPct(s.data?.blendedMargin)}</td>
                    <td style={styles.tdNum}>{fmtPct(s.data?.labourMargin)}</td>
                    <td style={styles.tdNum}>{fmtPct(s.data?.recurringMargin)}</td>
                    <td style={styles.tdNum}>{fmtPct(s.data?.overheadCoverageByRecurring)}</td>
                    <td style={styles.tdNum}>{fmtPct(s.data?.recurringShareOfRevenue)}</td>
                    <td style={styles.tdNum}>{fmtCents(s.data?.breakEvenHourlyCents, { decimals: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHead}>
          <div>
            <h3 style={styles.sectionTitle}>8 · Decision log</h3>
            <p style={styles.blurb}>
              Every price and packaging change, with the honest reason. Grandfather existing customers on every rise —
              increases touch new customers only.
            </p>
          </div>
          {!adding && (
            <button type="button" style={styles.addBtn} onClick={() => { setDraft(emptyDecision()); setAdding(true); }}>
              + Log a change
            </button>
          )}
        </div>

        {adding && (
          <div style={styles.form}>
            <div style={styles.formRow}>
              <Labeled label="Date">
                <input type="date" style={styles.input} value={draft.decided_on}
                  onChange={(e) => setDraft({ ...draft, decided_on: e.target.value })} />
              </Labeled>
              <Labeled label="Product">
                <select style={styles.input} value={draft.product_id || ''}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    const p = products.find(x => x.id === id);
                    setDraft({ ...draft, product_id: id, product_label: p?.name || draft.product_label });
                  }}>
                  <option value="">— other —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Labeled>
              <Labeled label="Old price ($)">
                <input type="number" style={styles.input} value={draft.oldPrice}
                  onChange={(e) => setDraft({ ...draft, oldPrice: e.target.value })} />
              </Labeled>
              <Labeled label="New price ($)">
                <input type="number" style={styles.input} value={draft.newPrice}
                  onChange={(e) => setDraft({ ...draft, newPrice: e.target.value })} />
              </Labeled>
              <Labeled label="Grandfathered">
                <select style={styles.input} value={draft.grandfathered ? 'yes' : 'no'}
                  onChange={(e) => setDraft({ ...draft, grandfathered: e.target.value === 'yes' })}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Labeled>
            </div>
            <input style={{ ...styles.input, width: '100%' }} placeholder="What changed"
              value={draft.what_changed} onChange={(e) => setDraft({ ...draft, what_changed: e.target.value })} />
            <textarea style={{ ...styles.input, width: '100%', minHeight: 60, resize: 'vertical' }}
              placeholder="Why — the actual reason, honestly stated"
              value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
            <div style={styles.formActions}>
              <button
                type="button" style={styles.primaryBtn}
                disabled={!draft.what_changed.trim() || saving}
                onClick={async () => {
                  await onAddDecision({
                    decided_on: draft.decided_on,
                    product_id: draft.product_id,
                    product_label: draft.product_label || 'Other',
                    what_changed: draft.what_changed.trim(),
                    old_price_cents: toCents(draft.oldPrice),
                    new_price_cents: toCents(draft.newPrice),
                    reason: draft.reason.trim() || null,
                    grandfathered: draft.grandfathered,
                  });
                  setAdding(false);
                  loadHistory();
                }}
              >Save</button>
              <button type="button" style={styles.linkBtn} onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        )}

        {decisions.length === 0 ? (
          <div style={styles.empty}>Nothing logged yet.</div>
        ) : (
          decisions.map(d => (
            <div key={d.id} style={styles.decision}>
              <div style={styles.decisionHead}>
                <span style={styles.decisionDate}>{d.decided_on}</span>
                <span style={styles.decisionProduct}>{d.product_label}</span>
                {d.old_price_cents !== null && d.new_price_cents !== null && (
                  <span style={styles.decisionPrices}>
                    {fmtCents(d.old_price_cents)} → {fmtCents(d.new_price_cents)}
                  </span>
                )}
                {d.grandfathered && <span style={styles.grandfathered}>grandfathered</span>}
                <button type="button" style={styles.linkBtn}
                  onClick={() => onDeleteDecision(d.id).then(loadHistory)}>✕</button>
              </div>
              <div style={styles.decisionWhat}>{d.what_changed}</div>
              {d.reason && <div style={styles.decisionWhy}>{d.reason}</div>}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function emptyDecision() {
  return {
    decided_on: new Date().toISOString().slice(0, 10),
    product_id: null, product_label: '', what_changed: '', reason: '',
    oldPrice: '', newPrice: '', grandfathered: true,
  };
}

function toCents(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? Math.round(n * 100) : null;
}

function Labeled({ label, children }) {
  return (
    <div style={styles.labeled}>
      <div style={styles.labelText}>{label}</div>
      {children}
    </div>
  );
}

const styles = {
  section: {
    background: colors.bgRaised, border: `1px solid ${colors.border}`,
    borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg,
  },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { margin: 0, fontSize: fontSizes.xl, fontWeight: fontWeights.semibold, color: colors.text },
  blurb: { margin: `${spacing.xs}px 0 0`, fontSize: fontSizes.sm, color: colors.textSubtle, lineHeight: 1.5, maxWidth: 720 },
  scroller: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 720 },
  th: {
    textAlign: 'left', fontSize: fontSizes.xs, color: colors.textDim, textTransform: 'uppercase',
    letterSpacing: '0.4px', padding: `${spacing.xs}px ${spacing.sm}px`,
    borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap',
  },
  get thNum() { return { ...this.th, textAlign: 'right' }; },
  td: { fontSize: fontSizes.md, color: colors.text, padding: spacing.sm, borderBottom: `1px solid ${colors.whiteA05}` },
  get tdNum() { return { ...this.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }; },
  empty: { fontSize: fontSizes.sm, color: colors.textDim, padding: `${spacing.md}px 0` },
  form: {
    display: 'flex', flexDirection: 'column', gap: spacing.sm, padding: spacing.md,
    background: colors.whiteA03, border: `1px solid ${colors.border}`,
    borderRadius: radii.md, marginBottom: spacing.md,
  },
  formRow: { display: 'flex', gap: spacing.md, flexWrap: 'wrap' },
  formActions: { display: 'flex', gap: spacing.sm, alignItems: 'center' },
  labeled: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  labelText: { fontSize: fontSizes.xs, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: '0.4px' },
  input: {
    background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.md, padding: `${spacing.xs}px ${spacing.sm}px`,
    fontFamily: 'inherit', outline: 'none',
  },
  decision: { padding: `${spacing.sm}px 0`, borderBottom: `1px solid ${colors.whiteA05}` },
  decisionHead: { display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' },
  decisionDate: { fontSize: fontSizes.xs, color: colors.textDim, fontVariantNumeric: 'tabular-nums' },
  decisionProduct: { fontSize: fontSizes.md, color: colors.text, fontWeight: fontWeights.medium },
  decisionPrices: { fontSize: fontSizes.sm, color: colors.textSubtle, fontVariantNumeric: 'tabular-nums' },
  grandfathered: {
    fontSize: fontSizes.xxs, color: colors.success.fg, background: colors.success.bg,
    border: `1px solid ${colors.success.border}`, borderRadius: radii.xs, padding: '1px 6px',
  },
  decisionWhat: { fontSize: fontSizes.sm, color: colors.textMuted, marginTop: spacing.xs },
  decisionWhy: { fontSize: fontSizes.sm, color: colors.textDim, marginTop: spacing.xs, lineHeight: 1.5 },
  primaryBtn: {
    flexShrink: 0, padding: `${spacing.xs}px ${spacing.md}px`, background: colors.accentA12,
    border: `1px solid ${colors.accentBorder}`, borderRadius: radii.sm, color: colors.accentFg,
    fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, cursor: 'pointer', fontFamily: 'inherit',
  },
  addBtn: {
    flexShrink: 0, background: 'none', border: `1px dashed ${colors.borderStrong}`, borderRadius: radii.sm,
    color: colors.textSubtle, fontSize: fontSizes.sm, padding: `${spacing.xs}px ${spacing.md}px`,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  linkBtn: {
    background: 'none', border: 'none', color: colors.textDim, fontSize: fontSizes.sm,
    cursor: 'pointer', fontFamily: 'inherit', padding: spacing.xs, marginLeft: 'auto',
  },
};
