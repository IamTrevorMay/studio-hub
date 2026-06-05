import React from 'react';
import { supabase } from '../../supabaseClient';
import { colors } from '../../lib/styleTokens';

// Shared scaffold for not-yet-built tool pages. Each Phase 1 stub uses this
// instead of repeating the layout. Once a tool is implemented, its file
// stops importing this and renders its real UI.

const TRITON_BASE = 'https://www.tritonapex.io';

function openTritonTool(targetPath) {
  // Open the tab synchronously so the browser doesn't block it as a popup
  // while we mint the SSO link.
  const win = window.open('about:blank', '_blank');
  (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('triton-link', {
        body: { target: targetPath },
      });
      if (error || !data?.url) throw new Error(error?.message || 'No URL returned');
      if (win) win.location.href = data.url;
    } catch {
      const fallback = `${TRITON_BASE}${targetPath}`;
      if (win) win.location.href = fallback;
      else window.open(fallback, '_blank', 'noopener');
    }
  })();
}

export default function ToolScaffold({ onBack, title, description, tritonPath, status }) {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backBtn} title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={styles.headerTitle}>{title}</span>
      </div>

      <div style={styles.body}>
        <div style={styles.card}>
          <div style={styles.badgeRow}>
            <span style={styles.badge}>{status || 'Coming soon'}</span>
          </div>
          <h1 style={styles.cardTitle}>{title}</h1>
          {description && <p style={styles.cardDesc}>{description}</p>}
          {tritonPath && (
            <button
              onClick={() => openTritonTool(tritonPath)}
              style={styles.tritonBtn}
            >
              Open in Triton
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 6 }}>
                <path d="M7 17L17 7M7 7h10v10" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: colors.bg,
    color: colors.text,
    fontFamily: "'DM Sans', sans-serif",
  },
  header: {
    height: 52,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 16px',
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bgRaised,
  },
  backBtn: {
    width: 32,
    height: 32,
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: colors.text,
  },
  body: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    maxWidth: 480,
    width: '100%',
    padding: 32,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    textAlign: 'center',
  },
  badgeRow: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 16,
  },
  badge: {
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
    borderRadius: 999,
  },
  cardTitle: {
    margin: '0 0 12px',
    fontSize: 24,
    fontWeight: 700,
    color: colors.text,
  },
  cardDesc: {
    margin: '0 0 24px',
    fontSize: 14,
    lineHeight: 1.6,
    color: colors.textMuted,
  },
  tritonBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: colors.text,
    background: colors.accent,
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
