import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { getBlockDef } from '../../../lib/emails/blockRegistry';

// Middle pane: vertical stack of the template's blocks. Each row shows a
// short label + summary, can be selected, moved up/down, or deleted.
// Visual fidelity is intentionally low — the live HTML preview lives on
// the right side and is the source of truth.

export default function BlockCanvas({ blocks, selectedId, onSelect, onMove, onDelete }) {
  return (
    <div style={styles.wrap}>
      {blocks.length === 0 ? (
        <div style={styles.empty}>Pick a block from the left to add it.</div>
      ) : (
        blocks.map((b, i) => {
          const def = getBlockDef(b.type);
          const active = b.id === selectedId;
          return (
            <div
              key={b.id}
              onClick={() => onSelect(b.id)}
              style={{ ...styles.row, ...(active ? styles.rowActive : {}) }}
            >
              <div style={styles.rowMain}>
                <div style={styles.rowType}>{def ? def.label : b.type}</div>
                <div style={styles.rowSummary}>{summary(b)}</div>
              </div>
              <div style={styles.rowActions} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => onMove(i, i - 1)} disabled={i === 0} style={styles.iconBtn} title="Move up">↑</button>
                <button onClick={() => onMove(i, i + 1)} disabled={i === blocks.length - 1} style={styles.iconBtn} title="Move down">↓</button>
                <button onClick={() => onDelete(b.id)} style={{ ...styles.iconBtn, color: colors.danger.fg }} title="Delete">×</button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function summary(block) {
  const c = block.config || {};
  switch (block.type) {
    case 'header':         return c.title || '(banner / logo)';
    case 'footer':         return c.text || '(unsubscribe + branding)';
    case 'rich-text':      return stripHtml(c.html).slice(0, 60) || '(empty)';
    case 'image':          return c.src || '(no image)';
    case 'button':         return `${c.text || 'Button'} → ${c.url || '(no url)'}`;
    case 'divider':        return '—';
    case 'spacer':         return `${c.height || 24}px`;
    case 'social-links':   return `${(c.links || []).filter((l) => l.url).length} links`;
    case 'custom-html':    return c.html ? '(custom HTML)' : '(empty)';
    case 'rss-card':       return (block.binding && block.binding.rssUrl) || '(no feed)';
    case 'poll':           return c.question || '(no question)';
    case 'countdown':      return c.targetDate || '(no target)';
    case 'personalization': return c.template || '';
    case 'columns':        return `${c.columnCount || 2} columns`;
    case 'section':        return c.title || '(no title)';
    default:               return '';
  }
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const styles = {
  wrap: {
    flex: 1, overflow: 'auto', padding: spacing.lg,
    display: 'flex', flexDirection: 'column', gap: spacing.sm,
    background: colors.bg,
  },
  empty: {
    padding: spacing.huge, textAlign: 'center',
    color: colors.textSubtle, fontSize: fontSizes.sm,
  },
  row: {
    padding: spacing.md, background: colors.bgRaised,
    border: `1px solid ${colors.border}`, borderRadius: radii.md,
    cursor: 'pointer', display: 'flex', alignItems: 'center',
  },
  rowActive: { border: `1px solid ${colors.accentBorder}`, background: colors.accentSoft },
  rowMain: { flex: 1, minWidth: 0 },
  rowType: { fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, color: colors.text },
  rowSummary: { fontSize: fontSizes.xs, color: colors.textSubtle, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowActions: { display: 'flex', gap: 4 },
  iconBtn: {
    width: 26, height: 26, borderRadius: radii.sm,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.textMuted, cursor: 'pointer', fontSize: 14,
  },
};
