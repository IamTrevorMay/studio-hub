import React, { useState } from 'react';
import useBreakdownData from './useBreakdownData';
import ModelPanel from './ModelPanel';
import ProductsPanel from './ProductsPanel';
import ReadoutPanel, { ReadoutHeader } from './ReadoutPanel';
import HistoryDrawer from './HistoryDrawer';
import usePersistedTab from '../../../hooks/usePersistedTab';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

// Accounting → Breakdown. The margin-target model from Mayday_Margin_Workbook,
// wired to real data.
//
// Sub-tabs run in dependency order — the Model feeds the Products, the Products
// feed the Readout — but Products opens first, because that is where aiming at
// a target margin actually happens. The four headline ratios stay pinned above
// all three so the answer to "how are we doing" never needs a tab change.

const SUBTABS = [
  { key: 'products', label: 'Products', hint: 'Price each product to its target margin' },
  { key: 'model',    label: 'Model',    hint: 'Overhead, loaded rates, break-even hourly' },
  { key: 'readout',  label: 'Readout',  hint: 'Company-level result. Read it, do not aim at it' },
  { key: 'history',  label: 'History',  hint: 'Quarterly closes and the decision log' },
];

const BUSINESS_SUBTABS = [
  { key: 'all', label: 'Overall' },
  { key: 'mayday_media', label: 'Mayday Media' },
  { key: 'neptune_performance', label: 'Neptune Performance' },
];

export default function BreakdownTab() {
  const [business, setBusiness] = useState('all');
  const [sub, setSub] = usePersistedTab(
    'accounting-breakdown', 'products',
    SUBTABS.map(t => t.key),
  );

  const data = useBreakdownData({ business });
  const { loading, saving, error, model, period, raw } = data;

  if (loading) return <div style={styles.loading}>Building the model…</div>;
  if (error && !model) return <div style={styles.error}>{error}</div>;
  if (!model) return null;

  const shared = {
    model,
    saving,
    onSetInput: data.setInput,
    onClearInput: data.clearInput,
    onRecalculate: data.recalculate,
  };

  return (
    <div>
      <div style={styles.topBar}>
        <div style={styles.subTabs}>
          {SUBTABS.map(t => (
            <button
              key={t.key}
              type="button"
              title={t.hint}
              onClick={() => setSub(t.key)}
              style={{ ...styles.subTab, ...(sub === t.key ? styles.subTabActive : null) }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={styles.rightControls}>
          <div style={styles.periodChip} title="Overhead is monthly, salaries are annual, and hours-per-unit needs a sample — a short window makes all three swing on one slow month.">
            {period.start} → {period.end}
          </div>
          <div style={styles.subTabs}>
            {BUSINESS_SUBTABS.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setBusiness(t.key)}
                style={{ ...styles.subTab, ...(business === t.key ? styles.subTabActive : null) }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            style={styles.recalcAll}
            disabled={saving}
            onClick={() => data.recalculate()}
            title="Discard every override and let the derived values win again. Fields with no data source — membership assumptions, SaaS tiers, merch costs — are left exactly as you typed them."
          >
            {saving ? 'Working…' : 'Recalculate all'}
          </button>
        </div>
      </div>

      {error && <div style={styles.errorInline}>{error}</div>}

      <ReadoutHeader model={model} />

      {sub === 'products' && (
        <ProductsPanel
          {...shared}
          onUpdateProduct={data.updateProduct}
          onAddProduct={data.addProduct}
          onArchiveProduct={data.archiveProduct}
        />
      )}

      {sub === 'model' && (
        <ModelPanel
          {...shared}
          settings={raw.settings}
          profiles={raw.profiles}
          onSetCategoryTag={data.setCategoryTag}
          onAddPerson={data.addPerson}
          onUpdatePerson={data.updatePerson}
          onArchivePerson={data.archivePerson}
        />
      )}

      {sub === 'readout' && (
        <ReadoutPanel {...shared} settings={raw.settings} onSetRevenueTag={data.setRevenueTag} />
      )}

      {sub === 'history' && (
        <HistoryDrawer
          model={model}
          period={period}
          products={raw.products}
          saving={saving}
          onCloseQuarter={data.closeQuarter}
          onAddDecision={data.addDecision}
          onDeleteDecision={data.deleteDecision}
        />
      )}
    </div>
  );
}

const styles = {
  topBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: spacing.md, marginBottom: spacing.lg, flexWrap: 'wrap',
  },
  rightControls: { display: 'flex', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  subTabs: { display: 'flex', gap: spacing.xs, background: colors.whiteA03, borderRadius: radii.md, padding: spacing.xs },
  subTab: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: 'transparent', border: 'none',
    borderRadius: radii.sm, color: colors.textSubtle, fontSize: fontSizes.md,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  subTabActive: { background: colors.accentSoft, color: colors.accentFg, fontWeight: fontWeights.semibold },
  periodChip: {
    fontSize: fontSizes.xs, color: colors.textDim, fontVariantNumeric: 'tabular-nums',
    border: `1px solid ${colors.border}`, borderRadius: radii.pill,
    padding: `${spacing.xs}px ${spacing.md}px`, whiteSpace: 'nowrap',
  },
  recalcAll: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: colors.accentA12,
    border: `1px solid ${colors.accentBorder}`, borderRadius: radii.sm, color: colors.accentFg,
    fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, cursor: 'pointer', fontFamily: 'inherit',
  },
  loading: { color: colors.textDim, fontSize: fontSizes.lg, padding: `${spacing.xl}px 0` },
  error: { color: colors.danger.fg, fontSize: fontSizes.md, padding: `${spacing.xl}px 0` },
  errorInline: {
    color: colors.danger.fgSoft, fontSize: fontSizes.sm, background: colors.danger.bg,
    border: `1px solid ${colors.danger.border}`, borderRadius: radii.md,
    padding: `${spacing.sm}px ${spacing.md}px`, marginBottom: spacing.md,
  },
};
