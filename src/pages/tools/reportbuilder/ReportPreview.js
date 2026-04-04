import React from 'react';

export default function ReportPreview({ html, loading, compiledPrompt, onUseThis }) {
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingState}>
          <div style={styles.spinner} />
          <div style={styles.loadingText}>Generating preview...</div>
          <div style={styles.loadingHint}>Fetching data and running through Claude</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!html) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" style={{ marginBottom: '12px' }}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          <div style={styles.emptyTitle}>Preview</div>
          <div style={styles.emptyText}>Describe your report in the chat and a live preview will appear here.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>Preview</span>
        {compiledPrompt && (
          <button onClick={onUseThis} style={styles.useBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Use this version
          </button>
        )}
      </div>

      {/* HTML Preview in sandboxed iframe */}
      <iframe
        srcDoc={`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      padding: 24px;
      background: #1a1a2e;
      color: rgba(255,255,255,0.8);
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.7;
    }
    h1, h2, h3, h4 { color: #ffffff; margin-top: 1.5em; margin-bottom: 0.5em; }
    h1 { font-size: 22px; }
    h2 { font-size: 18px; }
    h3 { font-size: 15px; }
    a { color: #a5b4fc; }
    ul, ol { padding-left: 20px; }
    li { margin-bottom: 6px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid rgba(255,255,255,0.1); padding: 8px 12px; text-align: left; }
    th { background: rgba(255,255,255,0.04); font-weight: 600; color: #e2e8f0; }
    blockquote { border-left: 3px solid #6366f1; padding-left: 14px; margin-left: 0; color: rgba(255,255,255,0.6); }
    hr { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 20px 0; }
    strong { color: #e2e8f0; }
  </style>
</head>
<body>${html}</body>
</html>`}
        sandbox="allow-same-origin"
        style={styles.iframe}
        title="Report Preview"
      />
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'rgba(255,255,255,0.01)',
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  toolbarLabel: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  useBtn: {
    background: '#22c55e',
    border: 'none',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '6px 14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  iframe: {
    flex: 1,
    border: 'none',
    width: '100%',
    background: '#1a1a2e',
  },
  loadingState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  spinner: {
    width: '28px',
    height: '28px',
    border: '3px solid rgba(99,102,241,0.2)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
  },
  loadingHint: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.25)',
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '40px',
  },
  emptyTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: '6px',
  },
  emptyText: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.2)',
    lineHeight: 1.5,
    maxWidth: '240px',
  },
};
