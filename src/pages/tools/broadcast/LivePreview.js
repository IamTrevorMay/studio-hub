import React, { useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

// Iframe-based live preview of the overlay. The overlay page itself
// lives at /broadcast-overlay/<channel_name> (deferred — Phase 5L wires
// the public overlay route). This component currently shows a placeholder
// if the overlay hasn't shipped yet; once the route exists it embeds it.

export default function LivePreview({ session }) {
  const [iframeOk, setIframeOk] = useState(false);
  const url = `/broadcast-overlay/${encodeURIComponent(session.channel_name)}`;
  return (
    <div style={styles.wrap}>
      <div style={styles.bar}>
        Live overlay preview · <code style={{ color: colors.accentFg }}>{session.channel_name}</code>
        <a href={url} target="_blank" rel="noopener noreferrer" style={styles.openLink}>open ↗</a>
      </div>
      {iframeOk ? (
        // Sandbox without allow-same-origin → opaque origin, so the
        // overlay can't reach the producer console's DOM, cookies, or
        // localStorage. The overlay is public (no auth needed) and only
        // talks to Supabase via Realtime/fetch, both of which still work
        // from an opaque-origin frame.
        <iframe
          title="live preview"
          src={url}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={styles.frame}
        />
      ) : (
        <div style={styles.placeholder}>
          Public overlay route ships in 5L. For OBS, use the URL above as a Browser Source
          once available — the page subscribes to <code>{session.channel_name}</code> via
          Supabase Realtime.
          <button onClick={() => setIframeOk(true)} style={styles.tryBtn}>Try embed anyway</button>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { flex: 1, minHeight: 200, display: 'flex', flexDirection: 'column', border: `1px solid ${colors.border}`, borderRadius: radii.md, overflow: 'hidden', background: '#000' },
  bar: {
    height: 28, flexShrink: 0, padding: `0 ${spacing.sm}px`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: colors.bgRaised, fontSize: fontSizes.xxs, color: colors.textSubtle,
    borderBottom: `1px solid ${colors.border}`,
  },
  openLink: { fontSize: fontSizes.xxs, color: colors.accentFg, textDecoration: 'none' },
  frame: { flex: 1, border: 'none', background: '#000' },
  placeholder: {
    flex: 1, display: 'flex', flexDirection: 'column', gap: spacing.md,
    alignItems: 'center', justifyContent: 'center',
    padding: spacing.xxl, textAlign: 'center',
    color: colors.textSubtle, fontSize: fontSizes.xs, fontWeight: fontWeights.medium,
  },
  tryBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: 'transparent',
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.textMuted, fontSize: fontSizes.xxs, cursor: 'pointer', fontFamily: 'inherit',
  },
};
