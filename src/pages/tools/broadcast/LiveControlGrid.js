import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { trigger } from './api';

// 3×4 hardware-style grid mirror of the StreamDeck. Assets land in the
// grid by their hotkey_key (we map keys F1..F12 → slots). Highlighted
// when the asset is currently visible.

const SLOTS = ['F1','F2','F3','F4', 'F5','F6','F7','F8', 'F9','F10','F11','F12'];

export default function LiveControlGrid({ session, assets, visibleAssetIds }) {
  const byKey = new Map();
  for (const a of assets) {
    if (a.hotkey_key) byKey.set(String(a.hotkey_key).toUpperCase(), a);
  }

  async function fire(asset) {
    await trigger({ sid: session.id, aid: asset.id, action: 'toggle' });
  }

  return (
    <div style={styles.grid}>
      {SLOTS.map((key) => {
        const a = byKey.get(key);
        if (!a) {
          return <div key={key} style={{ ...styles.tile, ...styles.tileEmpty }}><span style={styles.kbd}>{key}</span></div>;
        }
        const on = visibleAssetIds.has(a.id);
        return (
          <button
            key={key} onClick={() => fire(a)}
            style={{
              ...styles.tile,
              background: a.hotkey_color || (on ? colors.accent : colors.bgInput),
              // Parens matter: without them this parses as
              // `(a.hotkey_color) || (on ? '#fff' : colors.text)`, so an
              // unselected button with no hotkey_color silently picks up
              // colors.text and tinted buttons get the wrong contrast.
              color: (a.hotkey_color || on) ? '#fff' : colors.text,
              border: on ? `2px solid ${colors.accentFg}` : `1px solid ${colors.border}`,
            }}
          >
            <span style={styles.kbdHot}>{key}</span>
            <span style={styles.tileLbl}>{a.hotkey_label || a.name}</span>
          </button>
        );
      })}
    </div>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: spacing.xs,
    padding: spacing.sm,
    background: colors.bgRaised,
    borderTop: `1px solid ${colors.border}`,
  },
  tile: {
    aspectRatio: '1.4 / 1', padding: spacing.xs,
    borderRadius: radii.sm,
    cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
  },
  tileEmpty: { background: colors.bgInput, border: `1px dashed ${colors.border}`, cursor: 'default' },
  kbd: { fontSize: fontSizes.xxs, color: colors.textSubtle, alignSelf: 'flex-start' },
  kbdHot: { fontSize: fontSizes.xxs, color: 'rgba(255,255,255,0.7)', alignSelf: 'flex-start', fontWeight: fontWeights.bold },
  tileLbl: { fontSize: fontSizes.xxs, fontWeight: fontWeights.medium, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' },
};
