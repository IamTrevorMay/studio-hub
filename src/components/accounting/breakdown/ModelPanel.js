import React, { useState } from 'react';
import FieldInput from './FieldInput';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import {
  CLASSIFICATIONS, REVIEW_TAGS,
  fmtCents, fmtPct, fmtHours, fmtNumber,
} from '../../../lib/marginModel';

// Workbook tabs 1–3: the cost foundation.
//
//   1. What does the business cost to keep open, whether or not you sell?
//   2. What does an hour of each person actually cost?
//   3. Turn (1) into a per-hour number so unit prices can carry it.
//
// Everything on the Products tab is priced off the break-even rate at the
// bottom of this panel, so a wrong utilisation here is a wrong price there.

export default function ModelPanel({ model, settings, onSetInput, onClearInput, onSetCategoryTag,
  onRecalculate, onAddPerson, onUpdatePerson, onArchivePerson, profiles, saving }) {
  const { expenseSummary, peopleRows, totals, fields, hoursCheck } = model;
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPersonLabel, setNewPersonLabel] = useState('');

  const field = (section, key, subjectId) => ({
    onCommit: (v) => onSetInput(section, key, subjectId, v),
    onReset: () => onClearInput(section, key, subjectId),
  });

  const untagged = expenseSummary.byCategory.filter(c => !c.classification);

  return (
    <div>
      {/* ── 1. Overhead ──────────────────────────────────────────── */}
      <Section
        title="1 · Fixed overhead"
        blurb="What the business costs to keep open whether or not you sell anything this month. Salaries are deliberately not here — they are priced per hour below, and counting them twice inflates every price downstream."
        onRecalculate={() => onRecalculate('overhead')}
        saving={saving}
      >
        {untagged.length > 0 && (
          <div style={styles.warnBanner}>
            {untagged.length} expense {untagged.length === 1 ? 'category' : 'categories'} worth{' '}
            {fmtCents(untagged.reduce((s, c) => s + c.cents, 0))} {untagged.length === 1 ? 'is' : 'are'} untagged
            and sitting outside the model. Tag them below.
          </div>
        )}

        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Category</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Trailing 12mo</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Monthly</th>
              <th style={styles.th}>Counts as</th>
            </tr>
          </thead>
          <tbody>
            {expenseSummary.byCategory.map(c => {
              const tag = c.classification;
              const needsReview = REVIEW_TAGS.has(c.category) && !settings?.category_map?.[c.category];
              return (
                <tr key={c.category}>
                  <td style={styles.td}>
                    {c.category}
                    {needsReview && <span style={styles.reviewFlag} title="Seeded tag — worth confirming">review</span>}
                  </td>
                  <td style={{ ...styles.td, ...styles.num }}>{fmtCents(c.cents)}</td>
                  <td style={{ ...styles.td, ...styles.num, color: colors.textSubtle }}>{fmtCents(Math.round(c.cents / 12))}</td>
                  <td style={styles.td}>
                    <select
                      value={tag || ''}
                      onChange={(e) => onSetCategoryTag(c.category, e.target.value || null)}
                      style={{
                        ...styles.select,
                        color: tag ? colors.text : colors.warning.fg,
                        borderColor: tag ? colors.border : colors.warning.border,
                      }}
                    >
                      <option value="">— untagged —</option>
                      {Object.values(CLASSIFICATIONS).map(k => (
                        <option key={k.key} value={k.key}>{k.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={styles.totalsGrid}>
          <Totline label="Fixed overhead pool" value={fmtCents(expenseSummary.totals.overhead)} strong />
          <Totline label="Direct labour (priced per hour below)" value={fmtCents(expenseSummary.totals.direct_labour)} />
          <Totline label="Direct variable" value={fmtCents(expenseSummary.totals.direct_variable)} />
          <Totline label="Benefits" value={fmtCents(expenseSummary.totals.benefits)} />
        </div>

        <div style={styles.inlineFields}>
          <LabeledField label="Annual fixed overhead" help="Derived from the tagged categories above. Type over it to model a change you know is coming.">
            <FieldInput resolved={fields.overheadAnnual} kind="money" width={150} {...field('overhead', 'overhead_annual_cents', null)} />
          </LabeledField>
          <LabeledField label="Contingency" help="5–10% for what you have not thought of yet.">
            <FieldInput resolved={fields.contingency} kind="pct" width={90} {...field('overhead', 'contingency_pct', null)} />
          </LabeledField>
          <LabeledField label="Overhead incl. contingency">
            <div style={styles.readonlyValue}>{fmtCents(totals.overheadAnnualCents)}</div>
          </LabeledField>
        </div>
      </Section>

      {/* ── 2. Labour rates ──────────────────────────────────────── */}
      <Section
        title="2 · What an hour actually costs"
        blurb="Salary understates a person by roughly a third, and nobody bills eight hours a day. Utilisation is the most consequential number on this page: set it too high and every price downstream comes out too low."
        onRecalculate={() => onRecalculate('labour')}
        saving={saving}
      >
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Person</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Annual salary</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Taxes</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Benefits + tools</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Loaded cost</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Paid hrs</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Utilisation</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Billable hrs</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Loaded rate</th>
              <th style={styles.th} />
            </tr>
          </thead>
          <tbody>
            {peopleRows.map(p => {
              // The workbook's quarter-close check, running continuously.
              const drift = p.measuredUtilisation !== null && p.fields.utilisation.value
                ? p.measuredUtilisation - p.fields.utilisation.value
                : null;
              return (
                <tr key={p.id}>
                  <td style={styles.td}>
                    {p.profile_id ? (
                      <div>{p.label}</div>
                    ) : (
                      // Planned lines are yours to name — "Editor 3", "Trevor".
                      <input
                        style={styles.nameInput}
                        defaultValue={p.label}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next && next !== p.label) onUpdatePerson(p.id, { label: next });
                        }}
                      />
                    )}
                    {!p.profile_id && <div style={styles.subtle}>planned — no payroll link</div>}
                  </td>
                  <td style={styles.tdField}><FieldInput resolved={p.fields.salary} kind="money" width={110} {...field('labour', 'annual_salary_cents', p.id)} /></td>
                  <td style={styles.tdField}><FieldInput resolved={p.fields.tax} kind="pct" width={72} {...field('labour', 'employer_tax_pct', p.id)} /></td>
                  <td style={styles.tdField}><FieldInput resolved={p.fields.benefits} kind="money" width={100} {...field('labour', 'benefits_annual_cents', p.id)} /></td>
                  <td style={{ ...styles.td, ...styles.num }}>{fmtCents(p.loadedAnnualCents)}</td>
                  <td style={styles.tdField}><FieldInput resolved={p.fields.paidHours} kind="hours" width={72} {...field('labour', 'paid_hours', p.id)} /></td>
                  <td style={styles.tdField}>
                    <FieldInput resolved={p.fields.utilisation} kind="pct" width={72} {...field('labour', 'utilisation', p.id)} />
                    {drift !== null && Math.abs(drift) > 0.1 && (
                      <div style={styles.driftHint} title="Reported hours ÷ paid hours over the trailing 12 months">
                        measured {fmtPct(p.measuredUtilisation, 0)}
                      </div>
                    )}
                  </td>
                  <td style={{ ...styles.td, ...styles.num, color: colors.textSubtle }}>{fmtNumber(Math.round(p.billableHours))}</td>
                  <td style={{ ...styles.td, ...styles.num, fontWeight: fontWeights.semibold }}>
                    {p.rateCents === null ? '—' : `${fmtCents(p.rateCents, { decimals: 2 })}/hr`}
                  </td>
                  <td style={styles.td}>
                    <button type="button" style={styles.linkBtn} onClick={() => onArchivePerson(p.id)} title="Remove from the model">✕</button>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td style={{ ...styles.td, fontWeight: fontWeights.semibold }}>Blended</td>
              <td colSpan={3} />
              <td style={{ ...styles.td, ...styles.num, fontWeight: fontWeights.semibold }}>{fmtCents(totals.totalLoadedAnnual)}</td>
              <td colSpan={2} />
              <td style={{ ...styles.td, ...styles.num, fontWeight: fontWeights.semibold }}>{fmtNumber(Math.round(totals.totalBillableHours))}</td>
              <td style={{ ...styles.td, ...styles.num, fontWeight: fontWeights.semibold }}>
                {totals.blendedRateCents === null ? '—' : `${fmtCents(totals.blendedRateCents, { decimals: 2 })}/hr`}
              </td>
              <td />
            </tr>
          </tbody>
        </table>

        <div style={styles.hoursCheck}>
          <strong style={{ color: colors.text }}>Reality check.</strong>{' '}
          {fmtHours(hoursCheck.total)} of hours were reported across assignments and tasks in the last 12 months,
          against {fmtNumber(Math.round(totals.totalBillableHours))} billable hours assumed above.
          {hoursCheck.unmatched > 0 && (
            <> {fmtHours(hoursCheck.unmatched)} of those landed on no product — those hours are real work the
            Products tab is not pricing.</>
          )}
        </div>

        {addingPerson ? (
          <div style={styles.addRow}>
            <select
              style={styles.select}
              value={newPersonLabel}
              onChange={(e) => setNewPersonLabel(e.target.value)}
            >
              <option value="">— add a planned line —</option>
              {profiles
                .filter(pr => !peopleRows.some(p => p.profile_id === pr.id))
                .map(pr => <option key={pr.id} value={`profile:${pr.id}`}>{pr.full_name || 'Unnamed'}</option>)}
              <option value="planned">Planned role (no profile)</option>
            </select>
            <button
              type="button"
              style={styles.primaryBtn}
              onClick={async () => {
                if (!newPersonLabel) return;
                if (newPersonLabel === 'planned') {
                  await onAddPerson({ label: 'Planned role', profile_id: null });
                } else {
                  const id = newPersonLabel.split(':')[1];
                  const pr = profiles.find(x => x.id === id);
                  await onAddPerson({ label: pr?.full_name || 'Unnamed', profile_id: id });
                }
                setNewPersonLabel(''); setAddingPerson(false);
              }}
            >Add</button>
            <button type="button" style={styles.linkBtn} onClick={() => setAddingPerson(false)}>Cancel</button>
          </div>
        ) : (
          <button type="button" style={styles.addBtn} onClick={() => setAddingPerson(true)}>+ Add person</button>
        )}
      </Section>

      {/* ── 3. Overhead per hour ─────────────────────────────────── */}
      <Section
        title="3 · Overhead per billable hour"
        blurb="Overhead is one pool. Every hour you sell carries a slice of it, or the rent comes out of profit instead of out of your prices."
        onRecalculate={() => onRecalculate('model')}
        saving={saving}
      >
        <div style={styles.inlineFields}>
          <LabeledField
            label="Overhead recovered by hourly products"
            help="At 100% your labour products alone cover every fixed cost, and every membership dollar is upside. Lower it and you are betting on recurring revenue to close the gap — the Readout tells you whether that bet is paying off."
          >
            <FieldInput resolved={fields.recovery} kind="pct" width={90} {...field('model', 'overhead_recovery_pct', null)} />
          </LabeledField>
          <LabeledField label="Overhead per hour">
            <div style={styles.readonlyValue}>
              {totals.ohPerHourCents === null ? '—' : `${fmtCents(totals.ohPerHourCents, { decimals: 2 })}/hr`}
            </div>
          </LabeledField>
        </div>

        <div style={styles.breakEven}>
          <div style={styles.breakEvenLabel}>True break-even hourly rate</div>
          <div style={styles.breakEvenValue}>
            {totals.breakEvenHourlyCents === null ? '—' : `${fmtCents(totals.breakEvenHourlyCents, { decimals: 2 })}/hr`}
          </div>
          <div style={styles.breakEvenNote}>
            Blended people cost {totals.blendedRateCents === null ? '—' : fmtCents(totals.blendedRateCents, { decimals: 2 })}
            {' '}+ overhead {totals.ohPerHourCents === null ? '—' : fmtCents(totals.ohPerHourCents, { decimals: 2 })}.
            Sell an hour below this and you lose money on it.
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, blurb, onRecalculate, saving, children }) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHead}>
        <div>
          <h3 style={styles.sectionTitle}>{title}</h3>
          {blurb && <p style={styles.blurb}>{blurb}</p>}
        </div>
        {onRecalculate && (
          <button type="button" style={styles.recalcBtn} onClick={onRecalculate} disabled={saving}>
            Recalculate
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function LabeledField({ label, help, children }) {
  return (
    <div style={styles.labeledField}>
      <div style={styles.fieldLabel} title={help}>{label}</div>
      {children}
    </div>
  );
}

function Totline({ label, value, strong }) {
  return (
    <div style={styles.totline}>
      <span style={{ ...styles.totlineLabel, color: strong ? colors.text : colors.textSubtle }}>{label}</span>
      <span style={{ ...styles.totlineValue, fontWeight: strong ? fontWeights.bold : fontWeights.medium }}>{value}</span>
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
  recalcBtn: {
    flexShrink: 0, padding: `${spacing.xs}px ${spacing.md}px`, background: colors.accentA12,
    border: `1px solid ${colors.accentBorder}`, borderRadius: radii.sm, color: colors.accentFg,
    fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, cursor: 'pointer', fontFamily: 'inherit',
  },
  table: { width: '100%', borderCollapse: 'collapse', marginBottom: spacing.md },
  th: {
    textAlign: 'left', fontSize: fontSizes.xs, color: colors.textDim, textTransform: 'uppercase',
    letterSpacing: '0.5px', padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: `1px solid ${colors.border}`,
    whiteSpace: 'nowrap',
  },
  td: { fontSize: fontSizes.md, color: colors.text, padding: `${spacing.sm}px`, borderBottom: `1px solid ${colors.whiteA05}`, verticalAlign: 'top' },
  tdField: { padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: `1px solid ${colors.whiteA05}`, textAlign: 'right', verticalAlign: 'top' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  subtle: { fontSize: fontSizes.xxs, color: colors.textDim, marginTop: spacing.xs },
  nameInput: {
    background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.md, padding: `${spacing.xs}px ${spacing.sm}px`,
    fontFamily: 'inherit', outline: 'none', width: 150,
  },
  driftHint: { fontSize: fontSizes.xxs, color: colors.warning.fg, textAlign: 'right', marginTop: spacing.xs },
  select: {
    background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, padding: `${spacing.xs}px ${spacing.sm}px`,
    fontFamily: 'inherit', cursor: 'pointer',
  },
  reviewFlag: {
    marginLeft: spacing.sm, fontSize: fontSizes.xxs, color: colors.warning.fg,
    background: colors.warning.bg, border: `1px solid ${colors.warning.border}`,
    borderRadius: radii.xs, padding: '1px 5px',
  },
  warnBanner: {
    background: colors.warning.bg, border: `1px solid ${colors.warning.border}`, borderRadius: radii.md,
    padding: `${spacing.sm}px ${spacing.md}px`, marginBottom: spacing.md,
    color: colors.warning.fgSoft, fontSize: fontSizes.sm, lineHeight: 1.5,
  },
  totlineLabel: { fontSize: fontSizes.sm },
  totlineValue: { fontSize: fontSizes.md, fontVariantNumeric: 'tabular-nums', color: colors.text },
  totline: { display: 'flex', justifyContent: 'space-between', gap: spacing.md, padding: `${spacing.xs}px 0` },
  totalsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: `0 ${spacing.xxl}px`, marginBottom: spacing.md },
  inlineFields: { display: 'flex', gap: spacing.xxl, flexWrap: 'wrap', alignItems: 'flex-end' },
  labeledField: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  fieldLabel: { fontSize: fontSizes.xs, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: '0.4px' },
  readonlyValue: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text, fontVariantNumeric: 'tabular-nums', padding: `${spacing.xs}px 0` },
  breakEven: {
    marginTop: spacing.lg, padding: spacing.lg, background: colors.accentA08,
    border: `1px solid ${colors.accentBorder}`, borderRadius: radii.md,
  },
  breakEvenLabel: { fontSize: fontSizes.xs, color: colors.accentFg, textTransform: 'uppercase', letterSpacing: '0.5px' },
  breakEvenValue: { fontSize: fontSizes.displayLg, fontWeight: fontWeights.bold, color: colors.text, fontVariantNumeric: 'tabular-nums', margin: `${spacing.xs}px 0` },
  breakEvenNote: { fontSize: fontSizes.sm, color: colors.textSubtle, lineHeight: 1.5 },
  hoursCheck: {
    fontSize: fontSizes.sm, color: colors.textSubtle, lineHeight: 1.6,
    background: colors.whiteA03, border: `1px solid ${colors.border}`,
    borderRadius: radii.md, padding: `${spacing.sm}px ${spacing.md}px`, marginBottom: spacing.md,
  },
  addRow: { display: 'flex', gap: spacing.sm, alignItems: 'center' },
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
