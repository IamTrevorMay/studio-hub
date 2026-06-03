import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

// Left rail of the Generator. Lists the caller's saved templates
// (RLS scopes by auth.uid()) and lets them pick one. Empty + loading +
// error states inline.

export default function TemplateList({
  templates,
  loading,
  error,
  selectedId,
  onSelect,
  onRefresh,
  onDelete,
}) {
  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <div style={styles.label}>Templates</div>
        <button onClick={onRefresh} style={styles.refreshBtn} title="Refresh">
          ↻
        </button>
      </div>

      {error && <div style={styles.err}>{error}</div>}

      {loading ? (
        <div style={styles.dim}>Loading…</div>
      ) : (templates || []).length === 0 ? (
        <div style={styles.dim}>
          No templates yet. Build one in the Builder tab and hit Save.
        </div>
      ) : (
        <ul style={styles.list}>
          {(templates || []).map((t) => {
            const active = t.id === selectedId;
            return (
              <li key={t.id} style={styles.item}>
                <button
                  onClick={() => onSelect(t)}
                  style={{ ...styles.itemBtn, ...(active ? styles.itemBtnActive : {}) }}
                >
                  <span style={styles.itemTitle}>{t.name || 'Untitled'}</span>
                  <span style={styles.itemMeta}>
                    {t.width}×{t.height}
                    {t.updated_at ? ` · ${new Date(t.updated_at).toLocaleDateString()}` : ''}
                  </span>
                </button>
                <button
                  onClick={() => onDelete(t)}
                  style={styles.deleteBtn}
                  title="Delete template"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    padding: `${spacing.md}px ${spacing.sm}px`,
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    padding: `${spacing.xs}px ${spacing.sm}px`,
  },
  label: {
    flex: 1,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  refreshBtn: {
    width: 26,
    height: 26,
    fontSize: fontSizes.md,
    color: colors.textMuted,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
  },
  dim: {
    padding: spacing.md,
    fontSize: fontSizes.sm,
    color: colors.textPlaceholder,
    textAlign: 'center',
  },
  err: {
    margin: `${spacing.xs}px ${spacing.sm}px`,
    padding: spacing.sm,
    fontSize: fontSizes.xs,
    color: colors.danger?.fg || '#ef4444',
    background: colors.danger?.bg || 'rgba(239,68,68,0.15)',
    border: `1px solid ${colors.danger?.border || 'rgba(239,68,68,0.35)'}`,
    borderRadius: radii.sm,
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  item: {
    display: 'flex',
    alignItems: 'stretch',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  itemBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: `${spacing.sm}px ${spacing.md}px`,
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  itemBtnActive: {
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
  },
  itemTitle: {
    fontWeight: fontWeights.medium,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    width: '100%',
  },
  itemMeta: {
    marginTop: 2,
    fontSize: fontSizes.xxs,
    color: colors.textDim,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  deleteBtn: {
    width: 28,
    border: `1px solid ${colors.border}`,
    background: 'transparent',
    color: colors.textDim,
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontSize: fontSizes.md,
    padding: 0,
  },
};
