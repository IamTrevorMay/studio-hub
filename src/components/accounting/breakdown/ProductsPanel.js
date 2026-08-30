import React, { useState } from 'react';
import FieldInput from './FieldInput';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { fmtCents, fmtPct, MIN_HOURS_SAMPLE } from '../../../lib/marginModel';

// Workbook tabs 4–5. This is the tab the page exists for: what each product
// costs fully loaded, what it must sell for to hit its target margin, what you
// actually charge, and the size of the gap between those.
//
// Two things the spreadsheet cannot do:
//
//   • Hours are measured, not estimated, and carry their sample size. Below ten
//     reported units the average is withheld rather than shown — one viral
//     video is not a price.
//   • Headroom is a real column. "Price to hit target" and "price to list" are
//     separate numbers, so the gap you leave on purpose is measured instead of
//     remembered.

const BAND_COLORS = {
  good: colors.success.fg,
  warn: colors.warning.fg,
  bad:  colors.danger.fg,
  none: colors.textDim,
};

export default function ProductsPanel({
  model, onSetInput, onClearInput, onUpdateProduct, onAddProduct, onArchiveProduct, saving,
}) {
  const { productRows, recurringRows, impliedMerchCostCents, totals } = model;
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');

  const field = (section, key, subjectId) => ({
    onCommit: (v) => onSetInput(section, key, subjectId, v),
    onReset: () => onClearInput(section, key, subjectId),
  });
  // Columns stored on margin_products rather than margin_inputs. They are
  // always the operator's own choice, so they resolve as plain manual values.
  const own = (product, column, transform = (v) => v) => ({
    resolved: { value: product[column] === null || product[column] === undefined ? null : Number(product[column]), source: 'manual' },
    onCommit: (v) => onUpdateProduct(product.id, { [column]: v === null ? null : transform(v) }),
  });

  const totalGapAnnual = productRows.reduce((sum, r) => sum + (r.gapAnnualCents || 0), 0);

  return (
    <div>
      <section style={styles.section}>
        <div style={styles.sectionHead}>
          <div>
            <h3 style={styles.sectionTitle}>4 · Labour products</h3>
            <p style={styles.blurb}>
              Cost-up pricing, where a margin percentage is a real number. Price = fully loaded cost ÷ (1 − target
              margin) — margin, not markup. Targets sit at 28–35% because you carry salaried people and have no
              recurring base yet; the Readout tells you when that changes.
            </p>
          </div>
        </div>

        <div style={styles.scroller}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{ ...styles.th, ...styles.stickyCol }}>Product</th>
                <th style={styles.thNum}>Hrs / unit</th>
                <th style={styles.thNum}>Loaded rate</th>
                <th style={styles.thNum}>Direct</th>
                <th style={styles.thNum}>Rework</th>
                <th style={styles.thNum}>OH / unit</th>
                <th style={styles.thNum}>Loaded cost</th>
                <th style={styles.thNum}>Target</th>
                <th style={styles.thNum}>Price to hit target</th>
                <th style={styles.thNum}>Headroom</th>
                <th style={styles.thNum}>Price to list</th>
                <th style={styles.thNum}>Actual price</th>
                <th style={styles.thNum}>Actual margin</th>
                <th style={styles.thNum}>Gap / unit</th>
                <th style={styles.thNum}>Units / yr</th>
                <th style={styles.thNum}>Gap / yr</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {productRows.map(r => (
                <tr key={r.product.id}>
                  <td style={{ ...styles.td, ...styles.stickyCol }}>
                    <div style={styles.productName}>{r.product.name}</div>
                    <div style={styles.subtle}>{r.product.unit_label}</div>
                  </td>

                  <td style={styles.tdField}>
                    <FieldInput resolved={r.fields.hours} kind="hours" width={78} {...field('products', 'hours_per_unit', r.product.id)} />
                    <SampleNote row={r} />
                  </td>

                  <td style={styles.tdField}>
                    <FieldInput resolved={r.fields.rate} kind="money" width={86} {...field('products', 'rate_cents', r.product.id)} />
                  </td>

                  <td style={styles.tdNum}>{fmtCents(r.directCents)}</td>
                  <td style={styles.tdField}>
                    <FieldInput {...own(r.product, 'rework_pct')} kind="pct" width={64} />
                  </td>
                  <td style={styles.tdNum}>{fmtCents(r.overheadCents)}</td>
                  <td style={{ ...styles.tdNum, fontWeight: fontWeights.semibold }}>{fmtCents(r.fullyLoadedCents)}</td>

                  <td style={styles.tdField}>
                    <FieldInput {...own(r.product, 'target_margin')} kind="pct" width={64} />
                  </td>
                  <td style={{ ...styles.tdNum, color: colors.accentFg, fontWeight: fontWeights.semibold }}>
                    {fmtCents(r.targetPriceCents)}
                  </td>

                  <td style={styles.tdField}>
                    <FieldInput {...own(r.product, 'headroom_pct')} kind="pct" width={64} />
                  </td>
                  <td style={{ ...styles.tdNum, fontWeight: fontWeights.semibold }}>{fmtCents(r.listCents)}</td>

                  <td style={styles.tdField}>
                    <FieldInput {...own(r.product, 'actual_price_cents')} kind="money" width={90} />
                  </td>
                  <td style={{ ...styles.tdNum, color: BAND_COLORS[r.band], fontWeight: fontWeights.semibold }}>
                    {fmtPct(r.actualMargin)}
                  </td>
                  <td style={{ ...styles.tdNum, color: gapColor(r.gapPerUnitCents) }}>{signed(r.gapPerUnitCents)}</td>

                  <td style={styles.tdField}>
                    <FieldInput resolved={r.fields.units} kind="count" width={70} {...field('products', 'units_per_year', r.product.id)} />
                  </td>
                  <td style={{ ...styles.tdNum, color: gapColor(r.gapAnnualCents), fontWeight: fontWeights.semibold }}>
                    {signed(r.gapAnnualCents)}
                  </td>
                  <td style={styles.td}>
                    <button type="button" style={styles.linkBtn} onClick={() => onArchiveProduct(r.product.id)} title="Remove this product">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={styles.footerRow}>
          <div style={styles.gapTotal}>
            Across every product with a price and a volume, current pricing runs{' '}
            <strong style={{ color: gapColor(totalGapAnnual) }}>{signed(totalGapAnnual)}</strong> a year against target.
          </div>
          {showAdd ? (
            <div style={styles.addRow}>
              <input
                autoFocus
                style={styles.textInput}
                value={newName}
                placeholder="Product name"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { onAddProduct({ name: newName.trim() }); setNewName(''); setShowAdd(false); } }}
              />
              <button
                type="button" style={styles.primaryBtn} disabled={!newName.trim() || saving}
                onClick={() => { onAddProduct({ name: newName.trim() }); setNewName(''); setShowAdd(false); }}
              >Add</button>
              <button type="button" style={styles.linkBtn} onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" style={styles.addBtn} onClick={() => setShowAdd(true)}>+ Add product</button>
          )}
        </div>

        <p style={styles.note}>
          Break-even is {totals.breakEvenHourlyCents === null ? '—' : `${fmtCents(totals.breakEvenHourlyCents, { decimals: 2 })}/hr`}.
          Content is the one product where you do not set the price — there, the actual price column is your realistic
          average revenue per video, and a thin margin is information rather than failure.
        </p>
      </section>

      {/* ── 5. Recurring ─────────────────────────────────────────── */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>5 · Recurring products</h3>
        <p style={styles.blurb}>
          Marginal cost is near zero here, so a margin percentage says little. What matters is how much surplus you
          hand back on purpose. This is the base that has to carry your fixed costs before labour margins can safely
          come down.
        </p>

        <MembershipBlock
          rows={recurringRows.filter(r => r.kind === 'membership')}
          impliedMerchCostCents={impliedMerchCostCents}
          field={field} own={own}
        />
        <SaasBlock rows={recurringRows.filter(r => r.kind === 'saas')} field={field} own={own} />
        <MerchBlock rows={recurringRows.filter(r => r.kind === 'merch')} field={field} own={own} />
      </section>
    </div>
  );
}

function SampleNote({ row }) {
  if (!row.hasAutoHours) {
    return <div style={styles.sampleNote} title="No match rules — type the hours yourself">manual</div>;
  }
  if (row.belowSampleFloor) {
    return (
      <div style={{ ...styles.sampleNote, color: colors.warning.fg }} title={`Fewer than ${MIN_HOURS_SAMPLE} reported units — too small to price off`}>
        n={row.sampleSize} — not enough data
      </div>
    );
  }
  if (row.sampleSize) return <div style={styles.sampleNote}>n={row.sampleSize}</div>;
  return <div style={styles.sampleNote}>no reported hours</div>;
}

function MembershipBlock({ rows, impliedMerchCostCents, field, own }) {
  if (!rows.length) return null;
  return (
    <div style={styles.subBlock}>
      <h4 style={styles.subTitle}>Membership — the Costco fee</h4>
      {rows.map(r => {
        const f = r.fields;
        const drift = impliedMerchCostCents !== null && f.merchCost.value !== null
          && Math.abs(impliedMerchCostCents - f.merchCost.value) > 10;
        return (
          <div key={r.product.id}>
            <div style={styles.fieldGrid}>
              <Cell label="Price / member / mo">
                <FieldInput {...own(r.product, 'actual_price_cents')} kind="money" width={90} />
              </Cell>
              <Cell label="Members"><FieldInput resolved={f.members} kind="count" width={90} {...field('recurring', 'members', r.product.id)} /></Cell>
              <Cell label="Processing"><FieldInput resolved={f.processing} kind="pct" width={72} {...field('recurring', 'processing_pct', r.product.id)} /></Cell>
              <Cell label="Merch cost / member"><FieldInput resolved={f.merchCost} kind="money" width={80} {...field('recurring', 'merch_cost_cents', r.product.id)} /></Cell>
              <Cell label="Other cost / member"><FieldInput resolved={f.otherCost} kind="money" width={80} {...field('recurring', 'other_cost_cents', r.product.id)} /></Cell>
              <Cell label="Cost to serve one"><Readonly>{fmtCents(f.costPerMemberCents, { decimals: 2 })}</Readonly></Cell>
              <Cell label="Contribution / member"><Readonly strong>{fmtCents(r.contributionCents, { decimals: 2 })}</Readonly></Cell>
              <Cell label="Substack revenue (12mo)"><Readonly>{fmtCents(f.revenueAnnual.value)}</Readonly></Cell>
            </div>

            {f.members.source === 'empty' && (
              <div style={styles.infoNote}>
                Member count is manual. Substack removed its public subscriber-count endpoint in about March 2026, so
                <code style={styles.code}>sync-substack</code> no longer lands a headcount — the revenue above is real,
                the per-member figures below it are only as good as this number.
              </div>
            )}

            <div style={styles.fieldGrid}>
              <Cell label="Merch units / member / mo"><FieldInput resolved={f.unitsPerMemberMonth} kind="count" width={72} {...field('recurring', 'units_per_member_month', r.product.id)} /></Cell>
              <Cell label="Would have sold anyway"><FieldInput resolved={f.cannibalisation} kind="pct" width={72} {...field('recurring', 'cannibalisation_pct', r.product.id)} /></Cell>
              <Cell label="Implied merch cost / member">
                <Readonly>{fmtCents(impliedMerchCostCents, { decimals: 2 })}</Readonly>
              </Cell>
            </div>

            {drift && (
              <div style={styles.warnNote}>
                The merch table implies {fmtCents(impliedMerchCostCents, { decimals: 2 })} per member per month, but the
                assumption above says {fmtCents(f.merchCost.value, { decimals: 2 })}. One of them is stale.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SaasBlock({ rows, field, own }) {
  if (!rows.length) return null;
  return (
    <div style={styles.subBlock}>
      <h4 style={styles.subTitle}>Facility SaaS — price on value, never on cost</h4>
      <div style={styles.scroller}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Tier</th>
              <th style={styles.thNum}>Value to customer / mo</th>
              <th style={styles.thNum}>Price as % of value</th>
              <th style={styles.thNum}>Price / mo</th>
              <th style={styles.thNum}>Cost to serve</th>
              <th style={styles.thNum}>Contribution</th>
              <th style={styles.thNum}>Customers</th>
              <th style={styles.thNum}>Monthly total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.product.id}>
                <td style={styles.td}>{r.product.name}</td>
                <td style={styles.tdField}><FieldInput resolved={r.fields.value} kind="money" width={96} {...field('recurring', 'value_cents', r.product.id)} /></td>
                <td style={styles.tdField}><FieldInput resolved={r.fields.pricePct} kind="pct" width={64} {...field('recurring', 'price_pct_of_value', r.product.id)} /></td>
                <td style={styles.tdField}><FieldInput {...own(r.product, 'actual_price_cents')} kind="money" width={90} placeholder={r.unitPriceCents !== null ? String(r.unitPriceCents / 100) : ''} /></td>
                <td style={styles.tdField}><FieldInput resolved={r.fields.costToServe} kind="money" width={80} {...field('recurring', 'cost_to_serve_cents', r.product.id)} /></td>
                <td style={styles.tdNum}>{fmtCents(r.contributionCents)}</td>
                <td style={styles.tdField}><FieldInput resolved={r.fields.customers} kind="count" width={64} {...field('recurring', 'customers', r.product.id)} /></td>
                <td style={{ ...styles.tdNum, fontWeight: fontWeights.semibold }}>{fmtCents(r.monthlyRevenueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={styles.note}>
        Ten to twenty percent of delivered value is the defensible band. Start higher than feels comfortable —
        raising a price on an existing customer is painful, discounting is easy — and grandfather the pilot facility
        permanently.
      </p>
    </div>
  );
}

function MerchBlock({ rows, field, own }) {
  if (!rows.length) return null;
  return (
    <div style={styles.subBlock}>
      <h4 style={styles.subTitle}>Merch — the perk that sells memberships</h4>
      <div style={styles.scroller}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Item</th>
              <th style={styles.thNum}>COGS</th>
              <th style={styles.thNum}>Fulfilment</th>
              <th style={styles.thNum}>Unit cost</th>
              <th style={styles.thNum}>Member buffer</th>
              <th style={styles.thNum}>Member price</th>
              <th style={styles.thNum}>Public margin</th>
              <th style={styles.thNum}>Public price</th>
              <th style={styles.thNum}>Given up / unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.product.id}>
                <td style={styles.td}>{r.product.name}</td>
                <td style={styles.tdField}><FieldInput resolved={r.fields.cogs} kind="money" width={72} {...field('recurring', 'cogs_cents', r.product.id)} /></td>
                <td style={styles.tdField}><FieldInput resolved={r.fields.fulfilment} kind="money" width={72} {...field('recurring', 'fulfilment_cents', r.product.id)} /></td>
                <td style={styles.tdNum}>{fmtCents(r.fields.unitCostCents, { decimals: 2 })}</td>
                <td style={styles.tdField}><FieldInput resolved={r.fields.buffer} kind="pct" width={64} {...field('recurring', 'member_buffer_pct', r.product.id)} /></td>
                <td style={{ ...styles.tdNum, fontWeight: fontWeights.semibold }}>{fmtCents(r.fields.memberPriceCents, { decimals: 2 })}</td>
                <td style={styles.tdField}><FieldInput {...own(r.product, 'target_margin')} kind="pct" width={64} /></td>
                <td style={styles.tdNum}>{fmtCents(r.fields.publicPriceCents, { decimals: 2 })}</td>
                <td style={styles.tdNum}>{fmtCents(r.fields.marginGivenUpCents, { decimals: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={styles.note}>
        At dead-zero margin you personally absorb every misprint, return and lost parcel — hence the buffer. Most
        member purchases are incremental and cost you nothing; only the cannibalised ones are a real cost.
      </p>
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

function Readonly({ children, strong }) {
  return <div style={{ ...styles.readonly, fontWeight: strong ? fontWeights.bold : fontWeights.medium }}>{children}</div>;
}

function signed(cents) {
  if (cents === null || cents === undefined) return '—';
  return `${cents > 0 ? '+' : ''}${fmtCents(cents)}`;
}

function gapColor(cents) {
  if (cents === null || cents === undefined || cents === 0) return colors.textDim;
  return cents > 0 ? colors.success.fg : colors.danger.fg;
}

const styles = {
  section: {
    background: colors.bgRaised, border: `1px solid ${colors.border}`,
    borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg,
  },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.lg },
  sectionTitle: { margin: 0, fontSize: fontSizes.xl, fontWeight: fontWeights.semibold, color: colors.text },
  blurb: { margin: `${spacing.xs}px 0 ${spacing.md}px`, fontSize: fontSizes.sm, color: colors.textSubtle, lineHeight: 1.5, maxWidth: 760 },
  // Wide by nature — 16 columns of a cost stack. The table scrolls inside its
  // own container so the page body never scrolls sideways.
  scroller: { overflowX: 'auto', marginBottom: spacing.md },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 1180 },
  th: {
    textAlign: 'left', fontSize: fontSizes.xs, color: colors.textDim, textTransform: 'uppercase',
    letterSpacing: '0.4px', padding: `${spacing.xs}px ${spacing.sm}px`,
    borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap',
  },
  get thNum() { return { ...this.th, textAlign: 'right' }; },
  stickyCol: { position: 'sticky', left: 0, background: colors.bgRaised, zIndex: 1, minWidth: 170 },
  td: { fontSize: fontSizes.md, color: colors.text, padding: spacing.sm, borderBottom: `1px solid ${colors.whiteA05}`, verticalAlign: 'top' },
  get tdNum() { return { ...this.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }; },
  tdField: { padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: `1px solid ${colors.whiteA05}`, textAlign: 'right', verticalAlign: 'top' },
  productName: { fontWeight: fontWeights.medium },
  subtle: { fontSize: fontSizes.xxs, color: colors.textDim, marginTop: spacing.xs },
  sampleNote: { fontSize: fontSizes.xxs, color: colors.textDim, textAlign: 'right', marginTop: spacing.xs, whiteSpace: 'nowrap' },
  footerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing.lg, flexWrap: 'wrap' },
  gapTotal: { fontSize: fontSizes.sm, color: colors.textSubtle },
  note: { fontSize: fontSizes.sm, color: colors.textDim, lineHeight: 1.6, margin: `${spacing.md}px 0 0`, maxWidth: 760 },
  subBlock: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTop: `1px solid ${colors.border}` },
  subTitle: { margin: `0 0 ${spacing.md}px`, fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text },
  fieldGrid: { display: 'flex', gap: spacing.xl, flexWrap: 'wrap', marginBottom: spacing.md },
  cell: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  cellLabel: { fontSize: fontSizes.xs, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: '0.4px' },
  readonly: { fontSize: fontSizes.lg, color: colors.text, fontVariantNumeric: 'tabular-nums', padding: `${spacing.xs}px 0` },
  infoNote: {
    fontSize: fontSizes.sm, color: colors.textSubtle, lineHeight: 1.6, background: colors.whiteA03,
    border: `1px solid ${colors.border}`, borderRadius: radii.md,
    padding: `${spacing.sm}px ${spacing.md}px`, marginBottom: spacing.md, maxWidth: 760,
  },
  warnNote: {
    fontSize: fontSizes.sm, color: colors.warning.fgSoft, lineHeight: 1.6, background: colors.warning.bg,
    border: `1px solid ${colors.warning.border}`, borderRadius: radii.md,
    padding: `${spacing.sm}px ${spacing.md}px`, marginBottom: spacing.md, maxWidth: 760,
  },
  code: { fontFamily: 'monospace', fontSize: fontSizes.xs, padding: '1px 4px', background: colors.whiteA06, borderRadius: radii.xs, margin: '0 2px' },
  addRow: { display: 'flex', gap: spacing.sm, alignItems: 'center' },
  textInput: {
    background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.md, padding: `${spacing.xs}px ${spacing.sm}px`, fontFamily: 'inherit',
  },
  addBtn: {
    background: 'none', border: `1px dashed ${colors.borderStrong}`, borderRadius: radii.sm,
    color: colors.textSubtle, fontSize: fontSizes.sm, padding: `${spacing.xs}px ${spacing.md}px`,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  primaryBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: colors.accentA12,
    border: `1px solid ${colors.accentBorder}`, borderRadius: radii.sm, color: colors.accentFg,
    fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, cursor: 'pointer', fontFamily: 'inherit',
  },
  linkBtn: {
    background: 'none', border: 'none', color: colors.textDim, fontSize: fontSizes.sm,
    cursor: 'pointer', fontFamily: 'inherit', padding: spacing.xs,
  },
};
