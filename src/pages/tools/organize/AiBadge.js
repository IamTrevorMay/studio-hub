import React from 'react';

// Badge shown on files the AI auto-tagged. Green when confidence cleared the
// auto-accept threshold; amber "review" otherwise so the user double-checks it.
export default function AiBadge({ conf, threshold = 0.8 }) {
  if (typeof conf !== 'number') return null;
  const high = conf >= threshold;
  const pct = Math.round(conf * 100);

  return (
    <div
      style={{ ...styles.badge, ...(high ? styles.high : styles.low) }}
      title={`AI suggestion · ${pct}% confidence${high ? '' : ' · review'}`}
    >
      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2z" />
      </svg>
      {high ? 'AI' : 'Review'}
    </div>
  );
}

const styles = {
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: '2px 6px',
    borderRadius: '5px',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  high: {
    background: 'rgba(34,197,94,0.15)',
    color: '#86efac',
  },
  low: {
    background: 'rgba(245,158,11,0.15)',
    color: '#fcd34d',
  },
};
