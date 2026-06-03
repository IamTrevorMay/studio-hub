import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import PlayerSearchField from '../graphics/PlayerSearchField';

// Right rail of the Generator. Player picker + title override + populate
// button + export button. The Generator owns the actual populate +
// export handlers; this is pure form chrome.

export default function PlayerPanel({
  player,
  onPlayerChange,
  title,
  onTitleChange,
  onPopulate,
  populating,
  onExport,
  exporting,
  canExport,
  exportError,
}) {
  return (
    <div style={styles.wrap}>
      <div style={styles.section}>
        <div style={styles.label}>Pitcher</div>
        <PlayerSearchField
          value={player || { playerId: null, playerName: '' }}
          playerType="pitcher"
          placeholder="Search pitchers…"
          onChange={onPlayerChange}
        />
      </div>

      <div style={styles.section}>
        <div style={styles.label}>Title override (optional)</div>
        <input
          type="text"
          value={title || ''}
          placeholder="Auto-fills {title} / {player_name} / {team} in text elements"
          onChange={(e) => onTitleChange(e.target.value)}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <button
          onClick={onPopulate}
          disabled={populating}
          style={{ ...styles.actionBtn, ...(populating ? styles.disabled : {}) }}
        >
          {populating ? 'Populating…' : 'Populate + render'}
        </button>
        <div style={styles.note}>
          Population fills text placeholders + the pitcher's headshot when
          blank. Full per-element data binding (stats, charts, heatmaps)
          flows in once we wire the Triton player-data proxy.
        </div>
      </div>

      <div style={styles.section}>
        <button
          onClick={onExport}
          disabled={!canExport || exporting}
          style={{ ...styles.exportBtn, ...((!canExport || exporting) ? styles.disabled : {}) }}
        >
          {exporting ? 'Exporting…' : 'Export PNG + PDF'}
        </button>
        {exportError && <div style={styles.err}>{exportError}</div>}
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    padding: `${spacing.md}px ${spacing.lg}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
    overflowY: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  section: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  label: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  input: {
    width: '100%',
    padding: `${spacing.sm}px ${spacing.md}px`,
    fontSize: fontSizes.sm,
    color: colors.text,
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  actionBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text,
    background: colors.accent,
    border: 'none',
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  exportBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text,
    background: 'rgba(255,255,255,0.06)',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  disabled: { opacity: 0.4, cursor: 'not-allowed' },
  note: {
    marginTop: spacing.xs,
    fontSize: fontSizes.xxs,
    color: colors.textPlaceholder,
    lineHeight: 1.5,
  },
  err: {
    marginTop: spacing.xs,
    padding: spacing.sm,
    fontSize: fontSizes.xs,
    color: colors.danger?.fg || '#ef4444',
    background: colors.danger?.bg || 'rgba(239,68,68,0.15)',
    border: `1px solid ${colors.danger?.border || 'rgba(239,68,68,0.35)'}`,
    borderRadius: radii.sm,
  },
};
