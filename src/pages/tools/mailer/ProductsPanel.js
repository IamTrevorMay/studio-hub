import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { listProducts, createProduct, deleteProduct } from './api';

// Lists existing email products with a tiny inline-create form at the top.
// Click a row to set it as the active product (parent navigates to Templates).

export default function ProductsPanel({ onPick, selected }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', description: '' });

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await listProducts();
      setProducts(res.products || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.slug.trim()) return;
    setCreating(true); setError(null);
    try {
      const res = await createProduct({
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
        description: form.description.trim() || undefined,
        settings: { branding: {}, template: {} },
      });
      setForm({ name: '', slug: '', description: '' });
      await load();
      if (res.product) onPick(res.product);
    } catch (e) { setError(e.message); }
    setCreating(false);
  }

  async function handleDelete(p, e) {
    e.stopPropagation();
    if (!window.confirm(`Delete product "${p.name}"? This cascades to templates, audiences, and sends.`)) return;
    try { await deleteProduct(p.id); await load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.col}>
        <form onSubmit={handleCreate} style={styles.createForm}>
          <div style={styles.createTitle}>New product</div>
          <div style={styles.row2}>
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={styles.input}
              required
            />
            <input
              placeholder="slug-name"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              style={styles.input}
              required
            />
          </div>
          <input
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            style={styles.input}
          />
          <button type="submit" style={styles.primaryBtn} disabled={creating}>
            {creating ? 'Creating…' : 'Create product'}
          </button>
        </form>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Loading…</div>
          ) : products.length === 0 ? (
            <div style={styles.empty}>No products yet.</div>
          ) : (
            products.map((p) => (
              <div
                key={p.id}
                onClick={() => onPick(p)}
                style={{
                  ...styles.card,
                  ...(selected && selected.id === p.id ? styles.cardActive : {}),
                }}
              >
                <div>
                  <div style={styles.cardName}>{p.name}</div>
                  <div style={styles.cardMeta}>{p.slug}{p.description ? ` · ${p.description}` : ''}</div>
                </div>
                <button onClick={(e) => handleDelete(p, e)} style={styles.deleteBtn} title="Delete">×</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: { flex: 1, overflow: 'auto', padding: spacing.xxl, display: 'flex', justifyContent: 'center' },
  col: { width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: spacing.lg },
  createForm: {
    display: 'flex', flexDirection: 'column', gap: spacing.sm,
    padding: spacing.lg, background: colors.bgRaised,
    border: `1px solid ${colors.border}`, borderRadius: radii.md,
  },
  createTitle: { fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, color: colors.textMuted, marginBottom: spacing.xs },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm },
  input: {
    padding: `${spacing.sm}px ${spacing.md}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none',
  },
  primaryBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: colors.accent,
    color: '#fff', border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium, fontFamily: 'inherit',
    alignSelf: 'flex-start',
  },
  error: {
    padding: spacing.md, background: colors.danger.bg, color: colors.danger.fg,
    border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm,
    fontSize: fontSizes.sm,
  },
  list: { display: 'flex', flexDirection: 'column', gap: spacing.sm },
  empty: { padding: spacing.xxl, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  card: {
    padding: spacing.md,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardActive: {
    border: `1px solid ${colors.accentBorder}`,
    background: colors.accentSoft,
  },
  cardName: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.text },
  cardMeta: { fontSize: fontSizes.xs, color: colors.textSubtle, marginTop: 2 },
  deleteBtn: {
    width: 28, height: 28, borderRadius: radii.sm,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.textMuted, cursor: 'pointer', fontSize: 16,
  },
};
