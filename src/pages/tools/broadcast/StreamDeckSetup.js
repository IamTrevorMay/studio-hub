import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, shadows, zIndex } from '../../../lib/styleTokens';

// Lightweight setup card / modal for the StreamDeck WebHID flow. Shows
// supported state, prompts for device picker, lets user disconnect.

export default function StreamDeckSetup({ deck, onClose }) {
  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>StreamDeck</div>
        {!deck.supported && (
          <div style={styles.note}>
            WebHID is not available in this browser. Use Chrome, Edge, or Arc to connect a StreamDeck.
          </div>
        )}
        {deck.supported && (
          <>
            <div style={styles.statusRow}>
              <span style={statusStyle(deck.status)}>{deck.status}</span>
              {deck.dims && (
                <span style={styles.dimsTxt}>
                  {deck.dims.keyCount} keys · {deck.dims.columns}×{deck.dims.rows}
                </span>
              )}
            </div>
            {deck.error && <div style={styles.error}>{deck.error}</div>}
            <div style={styles.actions}>
              {deck.status !== 'connected' ? (
                <button onClick={deck.request} style={styles.primary}>Pick device…</button>
              ) : (
                <button onClick={deck.close} style={styles.disconnect}>Disconnect</button>
              )}
              <button onClick={onClose} style={styles.cancel}>Close</button>
            </div>
            <div style={styles.note}>
              The browser remembers your selection. Future sessions reopen the device automatically.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function statusStyle(s) {
  const base = { fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, textTransform: 'uppercase', letterSpacing: '0.06em' };
  if (s === 'connected') return { ...base, color: colors.success.fg };
  if (s === 'requesting') return { ...base, color: colors.warning.fg };
  if (s === 'error') return { ...base, color: colors.danger.fg };
  if (s === 'unsupported') return { ...base, color: colors.danger.fg };
  return { ...base, color: colors.textMuted };
}

const styles = {
  backdrop: { position: 'fixed', inset: 0, background: colors.bgOverlay, zIndex: zIndex.modal, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '90%', maxWidth: 420,
    background: colors.bgModal, border: `1px solid ${colors.border}`,
    borderRadius: radii.lg, boxShadow: shadows.modal,
    padding: spacing.xxl, display: 'flex', flexDirection: 'column', gap: spacing.md,
  },
  title: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text },
  statusRow: { display: 'flex', alignItems: 'center', gap: spacing.sm },
  dimsTxt: { fontSize: fontSizes.xs, color: colors.textMuted },
  error: { padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg, border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, fontSize: fontSizes.xs },
  note: { fontSize: fontSizes.xs, color: colors.textSubtle, lineHeight: 1.5 },
  actions: { display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' },
  primary: { padding: `${spacing.sm}px ${spacing.lg}px`, background: colors.accent, color: colors.text, border: 'none', borderRadius: radii.sm, cursor: 'pointer', fontSize: fontSizes.sm, fontWeight: fontWeights.medium, fontFamily: 'inherit' },
  disconnect: { padding: `${spacing.sm}px ${spacing.lg}px`, background: 'transparent', border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, color: colors.danger.fg, cursor: 'pointer', fontSize: fontSizes.sm, fontFamily: 'inherit' },
  cancel: { padding: `${spacing.sm}px ${spacing.lg}px`, background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: radii.sm, color: colors.textMuted, cursor: 'pointer', fontSize: fontSizes.sm, fontFamily: 'inherit' },
};
