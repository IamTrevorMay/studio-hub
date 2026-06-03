import React, { useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../../lib/styleTokens';
import ProductsPanel from './ProductsPanel';
import TemplatesPanel from './TemplatesPanel';
import AudiencesPanel from './AudiencesPanel';
import SendsPanel from './SendsPanel';
import TemplateEditor from './TemplateEditor';

// Top-level Mailer (Emails) tool. Four modes:
//   products  — list / create / pick a product
//   templates — list / create / edit templates for the picked product
//   audiences — manage audiences + subscribers for the picked product
//   sends     — recent + scheduled sends for the picked product
//
// When a template is opened from TemplatesPanel, this layout's chrome is
// replaced with the full-screen TemplateEditor (own header). Hitting back
// from the editor restores the tabs.

export default function Layout({ onBack }) {
  const [mode, setMode] = useState('products');
  const [product, setProduct] = useState(null);
  const [openTemplate, setOpenTemplate] = useState(null);

  if (openTemplate) {
    return (
      <TemplateEditor
        product={product}
        template={openTemplate}
        onClose={() => setOpenTemplate(null)}
      />
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button onClick={onBack} style={styles.backBtn} title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={styles.headerTitle}>Mailer</span>
        {product && <span style={styles.productPill}>{product.name}</span>}

        <div style={styles.tabs}>
          {[
            { k: 'products',  label: 'Products' },
            { k: 'templates', label: 'Templates', requiresProduct: true },
            { k: 'audiences', label: 'Audiences', requiresProduct: true },
            { k: 'sends',     label: 'Sends',     requiresProduct: true },
          ].map((t) => {
            const disabled = t.requiresProduct && !product;
            const active = mode === t.k;
            return (
              <button
                key={t.k}
                onClick={() => { if (!disabled) setMode(t.k); }}
                disabled={disabled}
                title={disabled ? 'Pick a product first' : ''}
                style={{
                  ...styles.tab,
                  ...(active ? styles.tabActive : {}),
                  ...(disabled ? styles.tabDisabled : {}),
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <div style={styles.body}>
        {mode === 'products' && (
          <ProductsPanel selected={product} onPick={(p) => { setProduct(p); setMode('templates'); }} />
        )}
        {mode === 'templates' && product && (
          <TemplatesPanel product={product} onOpen={(t) => setOpenTemplate(t)} />
        )}
        {mode === 'audiences' && product && (
          <AudiencesPanel product={product} />
        )}
        {mode === 'sends' && product && (
          <SendsPanel product={product} />
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: colors.bg,
    color: colors.text,
    fontFamily,
  },
  header: {
    height: 52,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `0 ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bgRaised,
  },
  backBtn: {
    width: 32,
    height: 32,
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
    borderRadius: radii.sm,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  productPill: {
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
    borderRadius: radii.pill,
  },
  tabs: {
    marginLeft: 'auto',
    display: 'flex',
    gap: spacing.xs,
  },
  tab: {
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    color: colors.textMuted,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tabActive: {
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
  },
  tabDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
};
