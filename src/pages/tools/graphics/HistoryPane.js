import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

export default function HistoryPane({ history, error, onRestore, onDelete }) {
  return (
    <div style={styles.container}>
      <div style={styles.label}>Recent exports</div>
      {error ? <div style={styles.errorMsg}>{error}</div> : null}
      {history.length === 0 ? (
        <div style={styles.empty}>No exports yet</div>
      ) : (
        <ul style={styles.list}>
          {history.map((row) => (
            <li key={row.id} style={styles.item}>
              <button
                onClick={() => onRestore(row)}
                style={styles.itemBtn}
                title={row.title}
              >
                {row.thumbnail_url && (
                  <img src={row.thumbnail_url} alt="" style={styles.thumb} />
                )}
                <span style={styles.itemTitle}>{row.title}</span>
              </button>
              <button
                onClick={() => onDelete(row)}
                style={styles.delBtn}
                title="Delete"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles = {
  container: {
    flexShrink: 0,
    padding: `${spacing.md}px ${spacing.sm}px`,
    borderTop: `1px solid ${colors.border}`,
    maxHeight: 240,
    overflowY: 'auto',
  },
  label: {
    padding: `${spacing.xs}px ${spacing.sm}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  empty: {
    padding: `${spacing.md}px ${spacing.sm}px`,
    fontSize: fontSizes.sm,
    color: colors.textPlaceholder,
  },
  errorMsg: {
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
    alignItems: 'center',
    gap: spacing.xs,
  },
  itemBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xs,
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: radii.sm,
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: fontSizes.sm,
    textAlign: 'left',
  },
  thumb: {
    width: 36,
    height: 36,
    objectFit: 'cover',
    borderRadius: radii.xs,
    background: colors.bgInput,
  },
  itemTitle: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  delBtn: {
    width: 28,
    height: 28,
    border: 'none',
    background: 'transparent',
    color: colors.textDim,
    cursor: 'pointer',
    borderRadius: radii.sm,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
