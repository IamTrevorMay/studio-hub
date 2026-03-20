import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import Teleprompter from './tools/Teleprompter';
import Organize from './tools/Organize';
import PostShow from './tools/PostShow';

const TOOLS = [
  {
    key: 'teleprompter',
    name: 'Teleprompter',
    description: 'Camera monitor with smooth-scrolling script overlay for recording and live presentations.',
    color: '#6366f1',
  },
  {
    key: 'broadcast',
    name: 'Broadcast',
    description: 'Real-time OBS overlay controller with animated transitions and Stream Deck integration.',
    color: '#ef4444',
    tritonPath: '/broadcast',
  },
  {
    key: 'scene-builder',
    name: 'Scene Builder',
    description: 'Visual scene composer for building data-driven broadcast graphics and overlays.',
    color: '#f59e0b',
    tritonPath: '/visualize/scene-composer',
  },
  {
    key: 'organize',
    name: 'Organize',
    description: 'Browser-based media file organizer. Tag files by type and subtype, then sort them into folders.',
    color: '#10b981',
  },
  {
    key: 'post-show',
    name: 'Post Show',
    description: 'End-to-end post-show workflow: video cutting, Drive uploads, Discord notifications, and Kanban sync.',
    color: '#ec4899',
  },
  {
    key: 'screenwriter',
    name: 'Screenwriter',
    description: 'Industry-standard screenplay editor with scene navigation, character manager, and FDX/PDF export.',
    color: '#a78bfa',
    navigateTo: 'screenwriter',
  },
];

const TRITON_BASE = 'https://tritonapex.io';

async function openTritonTool(targetPath) {
  try {
    const { data, error } = await supabase.functions.invoke('triton-link', {
      body: { target: targetPath },
    });
    if (error || !data?.url) throw new Error(error?.message || 'No URL returned');
    window.open(data.url, '_blank', 'noopener');
  } catch {
    // Fallback: open Triton directly (user will see login page)
    window.open(`${TRITON_BASE}${targetPath}`, '_blank', 'noopener');
  }
}

export default function Tools({ onNavigate }) {
  const [activeTool, setActiveTool] = useState(null);

  if (activeTool === 'teleprompter') {
    return <Teleprompter onBack={() => setActiveTool(null)} />;
  }
  if (activeTool === 'organize') {
    return <Organize onBack={() => setActiveTool(null)} />;
  }
  if (activeTool === 'post-show') {
    return <PostShow onBack={() => setActiveTool(null)} />;
  }

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Toolbox</h1>
          <p style={styles.pageSubtitle}>Utility apps for content creation and production</p>
        </div>
      </div>

      <div style={styles.grid}>
        {TOOLS.map(tool => (
          <button
            key={tool.key}
            onClick={() => {
              if (tool.navigateTo && onNavigate) {
                onNavigate(tool.navigateTo);
              } else if (tool.tritonPath) {
                openTritonTool(tool.tritonPath);
              } else {
                setActiveTool(tool.key);
              }
            }}
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
              <div style={styles.cardNameRow}>
                <div style={styles.cardName}>{tool.name}</div>
                {tool.tritonPath && (
                  <svg style={styles.externalIcon} viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3.75 2a.75.75 0 000 1.5h6.69L2.72 11.22a.75.75 0 101.06 1.06L11.5 4.56v6.69a.75.75 0 001.5 0V2.75a.75.75 0 00-.75-.75H3.75z" />
                  </svg>
                )}
              </div>
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
  cardNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '6px',
  },
  cardName: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#e2e8f0',
  },
  externalIcon: {
    width: '13px',
    height: '13px',
    color: 'rgba(255,255,255,0.3)',
    flexShrink: 0,
  },
  cardDesc: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 1.4,
  },
};
