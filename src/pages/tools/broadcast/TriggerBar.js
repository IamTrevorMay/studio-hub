import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { trigger } from './api';

// Horizontal row of toggle buttons — one per asset. Background lights up
// when the asset is currently visible on stage. Used directly under the
// canvas for fast keyboard-style triggering.

export default function TriggerBar({ session, assets, visibleAssetIds, onTriggered }) {
  async function fire(asset) {
    await trigger({ sid: session.id, aid: asset.id, action: 'toggle' });
    if (onTriggered) onTriggered();
  }

  return (
    <div style={styles.wrap}>
      {assets.length === 0 && <div style={styles.empty}>No assets to trigger.</div>}
      {assets.map((a) => {
        const on = visibleAssetIds.has(a.id);
        return (
          <button
            key={a.id}
            onClick={() => fire(a)}
            style={{
              ...styles.btn,
              ...(on ? styles.btnOn : {}),
              ...(a.hotkey_color ? { borderColor: a.hotkey_color } : {}),
            }}
            title={a.hotkey_key ? `${a.name} (${a.hotkey_key})` : a.name}
          >
            {a.hotkey_key && <span style={styles.kbd}>{a.hotkey_key}</span>}
            <span style={styles.lbl}>{a.hotkey_label || a.name}</span>
          </button>
        );
      })}
    </div>
  );
}

const styles = {
  wrap: {
    display: 'flex', gap: spacing.xs, padding: spacing.sm,
    background: colors.bgRaised,
    borderTop: `1px solid ${colors.border}`,
    overflowX: 'auto',
  },
  empty: { padding: spacing.md, fontSize: fontSizes.xs, color: colors.textSubtle },
  btn: {
    flexShrink: 0,
    minWidth: 84, padding: `${spacing.xs}px ${spacing.sm}px`,
    background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.xs, fontFamily: 'inherit',
    cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  },
  btnOn: {
    background: colors.accentSoft, borderColor: colors.accentBorder, color: colors.accentFg,
  },
  kbd: {
    fontSize: 10, fontWeight: fontWeights.bold,
    color: colors.textMuted, background: 'rgba(0,0,0,0.3)',
    padding: '1px 5px', borderRadius: 3,
  },
  lbl: { fontWeight: fontWeights.medium, whiteSpace: 'nowrap' },
};
