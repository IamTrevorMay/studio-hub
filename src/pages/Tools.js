import React, { useState } from 'react';
import Teleprompter from './tools/Teleprompter';

const TOOLS = [
  {
    key: 'teleprompter',
    name: 'Teleprompter',
    description: 'Camera monitor with smooth-scrolling script overlay for recording and live presentations.',
    icon: '📺',
    color: '#6366f1',
  },
];

export default function Tools() {
  const [activeTool, setActiveTool] = useState(null);

  if (activeTool === 'teleprompter') {
    return <Teleprompter onBack={() => setActiveTool(null)} />;
  }

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Tools</h1>
          <p style={styles.pageSubtitle}>Utility apps for content creation and production</p>
        </div>
      </div>

      <div style={styles.grid}>
        {TOOLS.map(tool => (
          <button
            key={tool.key}
            onClick={() => setActiveTool(tool.key)}
            style={styles.card}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
            }}
          >
            <div style={{ ...styles.cardStripe, background: tool.color }} />
            <div style={styles.cardBody}>
              <span style={styles.cardIcon}>{tool.icon}</span>
              <div style={styles.cardName}>{tool.name}</div>
              <div style={styles.cardDesc}>{tool.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

const styles = {
  page: {
    padding: '32px 40px',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px',
  },
  pageTitle: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 4px 0',
    letterSpacing: '-0.5px',
  },
  pageSubtitle: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
  },
  card: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
    textAlign: 'left',
    padding: 0,
    fontFamily: 'inherit',
    display: 'flex',
    flexDirection: 'column',
  },
  cardStripe: {
    height: '4px',
    width: '100%',
  },
  cardBody: {
    padding: '20px',
  },
  cardIcon: {
    fontSize: '28px',
    display: 'block',
    marginBottom: '10px',
  },
  cardName: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#e2e8f0',
    marginBottom: '6px',
  },
  cardDesc: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 1.4,
  },
};
