import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { listTemplates, createTemplate, deleteTemplate } from './api';

// Lists templates for the active product. Click a row to open it in the
// full-screen TemplateEditor (parent state); "New template" creates a
// blank one and opens it.

export default function TemplatesPanel({ product, onOpen }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await listTemplates(product.id);
      setTemplates(res.templates || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [product.id]);

  async function handleCreate() {
    setCreating(true); setError(null);
    try {
      const res = await createTemplate({
        product_id: product.id,
        name: 'Untitled',
        subject: '',
        blocks: [],
      });
      setCreating(false);
      if (res.template) onOpen(res.template);
    } catch (e) { setError(e.message); setCreating(false); }
  }

  async function handleDelete(t, e) {
    e.stopPropagation();
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try { await deleteTemplate(t.id); await load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.col}>
        <div style={styles.headerRow}>
          <div style={styles.title}>Templates for {product.name}</div>
          <button onClick={handleCreate} disabled={creating} style={styles.primaryBtn}>
            {creating ? 'Creating…' : '+ New template'}
          </button>
        </div>
        {error && <div style={styles.error}>{error}</div>}
        <div style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Loading…</div>
          ) : templates.length === 0 ? (
            <div style={styles.empty}>No templates yet. Create one to get started.</div>
          ) : (
            templates.map((t) => (
              <div key={t.id} onClick={() => onOpen(t)} style={styles.card}>
                <div>
                  <div style={styles.cardName}>{t.name || 'Untitled'}</div>
                  <div style={styles.cardMeta}>
                    {t.subject ? `“${t.subject}” · ` : ''}
                    {Array.isArray(t.blocks) ? `${t.blocks.length} blocks · ` : ''}
                    Updated {new Date(t.updated_at).toLocaleString()}
                  </div>
                </div>
                <button onClick={(e) => handleDelete(t, e)} style={styles.deleteBtn} title="Delete">×</button>
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
  col: { width: '100%', maxWidth: 880, display: 'flex', flexDirection: 'column', gap: spacing.lg },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: fontSizes.xl, fontWeight: fontWeights.semibold, color: colors.text },
  primaryBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: colors.accent,
    color: colors.text, border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium, fontFamily: 'inherit',
  },
  error: {
    padding: spacing.md, background: colors.danger.bg, color: colors.danger.fg,
    border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm,
    fontSize: fontSizes.sm,
  },
  empty: { padding: spacing.huge, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  list: { display: 'flex', flexDirection: 'column', gap: spacing.sm },
  card: {
    padding: spacing.md, background: colors.bgRaised,
    border: `1px solid ${colors.border}`, borderRadius: radii.md,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  cardName: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.text },
  cardMeta: { fontSize: fontSizes.xs, color: colors.textSubtle, marginTop: 2 },
  deleteBtn: {
    width: 28, height: 28, borderRadius: radii.sm,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.textMuted, cursor: 'pointer', fontSize: 16,
  },
};
