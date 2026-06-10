import React, { useEffect, useMemo } from 'react';
import { colors, spacing, fontSizes } from '../../../lib/styleTokens';
import { trigger } from './api';

// Mirrors the connected StreamDeck's grid in the producer console and
// listens for hardware button presses. Maps assets to keys by
// `hotkey_key` (numeric "0".."14" for the 15-key Mk.2, or F1..F12).
//
// When the deck is connected, we paint each key with the asset's color
// (or accent if currently visible). When a key is pressed, fire the
// asset's toggle trigger.

export default function StreamDeckGrid({ deck, session, assets, visibleAssetIds }) {
  const slotMap = useMemo(() => buildSlotMap(deck && deck.dims, assets), [deck && deck.dims, assets]);

  // Paint keys whenever map/visibility changes.
  useEffect(() => {
    if (!deck || !deck.dims) return;
    const keyCount = deck.dims.keyCount || 0;
    for (let i = 0; i < keyCount; i++) {
      const a = slotMap.get(i);
      if (!a) { deck.clear(i); continue; }
      const hex = (a.hotkey_color && /^#[0-9a-fA-F]{6}$/.test(a.hotkey_color))
        ? a.hotkey_color
        : (visibleAssetIds.has(a.id) ? '#6366f1' : '#1a1a2e');
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      deck.fillRgb(i, r, g, b);
    }
  }, [deck, slotMap, visibleAssetIds]);

  // Hardware press handler.
  useEffect(() => {
    if (!deck || !deck.onKey) return;
    deck.onKey(async (idx, edge) => {
      if (edge !== 'down') return;
      const a = slotMap.get(idx);
      if (!a) return;
      try { await trigger({ sid: session.id, aid: a.id, action: 'toggle' }); }
      catch { /* ignore */ }
    });
    return () => { if (deck && deck.onKey) deck.onKey(null); };
  }, [deck, slotMap, session.id]);

  if (!deck) return null;
  if (deck.status !== 'connected') {
    return (
      <div style={styles.empty}>
        {deck.status === 'unsupported'
          ? 'WebHID is unavailable in this browser.'
          : 'No StreamDeck connected — open setup to pair one.'}
      </div>
    );
  }

  const cols = (deck.dims && deck.dims.columns) || 5;
  const rows = (deck.dims && deck.dims.rows) || 3;

  return (
    <div style={{ ...styles.grid, gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: rows * cols }, (_, i) => {
        const a = slotMap.get(i);
        const on = a && visibleAssetIds.has(a.id);
        const bg = a && a.hotkey_color ? a.hotkey_color : (on ? colors.accent : colors.bgInput);
        return (
          <div
            key={i}
            style={{
              ...styles.tile,
              background: bg,
              outline: on ? `2px solid ${colors.accentFg}` : `1px solid ${colors.border}`,
            }}
          >
            <span style={styles.slot}>{i}</span>
            <span style={styles.label}>{a ? (a.hotkey_label || a.name) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

// Build a Map<keyIndex, asset>. Asset.hotkey_key can be either a numeric
// slot ("3") or "F1"..."F<n>". Slots out of range are ignored.
function buildSlotMap(dims, assets) {
  const map = new Map();
  if (!dims) return map;
  for (const a of assets) {
    const raw = (a.hotkey_key || '').toString().toUpperCase();
    if (!raw) continue;
    let idx = null;
    if (/^\d+$/.test(raw)) idx = parseInt(raw, 10);
    else if (/^F\d+$/.test(raw)) idx = parseInt(raw.slice(1), 10) - 1;
    if (idx == null || idx < 0 || idx >= dims.keyCount) continue;
    if (!map.has(idx)) map.set(idx, a);
  }
  return map;
}

const styles = {
  grid: { display: 'grid', gap: spacing.xs, padding: spacing.sm },
  tile: {
    aspectRatio: '1 / 1', borderRadius: 6,
    padding: 4, color: '#fff',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
    fontSize: fontSizes.xxs,
  },
  slot: { alignSelf: 'flex-start', opacity: 0.6 },
  label: { textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' },
  empty: { padding: spacing.md, fontSize: fontSizes.xs, color: colors.textSubtle, textAlign: 'center' },
};
