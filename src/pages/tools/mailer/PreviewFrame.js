import React, { useEffect, useRef, useState } from 'react';
import { colors, spacing, fontSizes } from '../../../lib/styleTokens';
import { previewTemplate } from './api';

// Renders an iframe sandbox with srcdoc = the server-rendered HTML for
// the current blocks/subject. Debounces fetches so typing doesn't spam
// /api/emails/preview.

export default function PreviewFrame({ blocks, subject, settings, branding, productName }) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef();

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const text = await previewTemplate({
          blocks,
          subject: subject || '(no subject)',
          settings,
          branding: { ...(branding || {}), fromName: (branding && branding.fromName) || productName || 'Mayday' },
          resolve: false,
        });
        setHtml(text);
      } catch (e) {
        setError(e.message);
      }
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer.current);
  }, [blocks, subject, settings, branding, productName]);

  return (
    <div style={styles.wrap}>
      <div style={styles.bar}>
        Preview {loading && <span style={styles.muted}>· rendering…</span>}
        {error && <span style={styles.err}>· {error}</span>}
      </div>
      <iframe
        title="email preview"
        srcDoc={html}
        sandbox="allow-same-origin"
        style={styles.frame}
      />
    </div>
  );
}

const styles = {
  wrap: {
    width: 420, flexShrink: 0,
    borderLeft: `1px solid ${colors.border}`,
    display: 'flex', flexDirection: 'column',
    background: colors.bg,
  },
  bar: {
    height: 32, flexShrink: 0,
    padding: `0 ${spacing.md}px`,
    fontSize: fontSizes.xs, color: colors.textMuted,
    display: 'flex', alignItems: 'center', gap: spacing.sm,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bgRaised,
  },
  muted: { color: colors.textSubtle },
  err: { color: colors.danger.fg },
  frame: { flex: 1, border: 'none', background: '#ffffff' },
};
