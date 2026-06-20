import React, { useState } from 'react';
import {
  Heading,
  AlignLeft,
  Image as ImageIcon,
  MousePointer,
  Minus,
  Move,
  Code,
  PanelTop,
  PanelBottom,
  Share2,
  Columns,
  SquareDashedBottom,
  Type,
  UserCheck,
  Rss,
  Trophy,
  Star,
  TrendingUp,
  X,
} from 'lucide-react';
import { CATEGORIES, getBlocksByCategory } from './blockRegistry';

// Categorized add-block picker. Replaces the flat list of "+ heading"
// buttons in BlockEditor with a tabbed/grouped grid keyed off
// blockRegistry. Filters out categories with no entries so future-empty
// categories don't render a blank section.

const ICON_MAP = {
  Heading,
  AlignLeft,
  Image: ImageIcon,
  MousePointer,
  Minus,
  Move,
  Code,
  PanelTop,
  PanelBottom,
  Share2,
  Columns,
  SquareDashedBottom,
  Type,
  UserCheck,
  Rss,
  Trophy,
  Star,
  TrendingUp,
};

export default function BlockPalette({ onAdd, onCancel }) {
  const [activeCat, setActiveCat] = useState('content');
  const populatedCats = CATEGORIES.filter((c) => getBlocksByCategory(c.key).length > 0);
  const activeBlocks = getBlocksByCategory(activeCat);

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <span style={styles.title}>Add a block</span>
        <button onClick={onCancel} style={styles.closeBtn} title="Cancel">
          <X size={14} />
        </button>
      </div>

      <div style={styles.tabs}>
        {populatedCats.map((c) => (
          <button
            key={c.key}
            onClick={() => setActiveCat(c.key)}
            style={{ ...styles.tab, ...(c.key === activeCat ? styles.tabActive : {}) }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div style={styles.grid}>
        {activeBlocks.map((b) => {
          const Icon = ICON_MAP[b.icon] || Code;
          return (
            <button
              key={b.type}
              onClick={() => onAdd(b.type)}
              style={styles.card}
              title={b.description}
            >
              <Icon size={18} style={{ color: '#a5b4fc' }} />
              <span style={styles.cardLabel}>{b.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: {
    fontSize: 11, fontWeight: 800, color: '#c7d2fe',
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  closeBtn: {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
    color: 'rgba(255,255,255,0.6)', borderRadius: 4,
    width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.06)' },
  tab: {
    background: 'transparent', border: 'none',
    color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600,
    padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit',
    borderBottom: '2px solid transparent',
  },
  tabActive: { color: '#fff', borderBottom: '2px solid #818cf8' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
    gap: 6,
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '10px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: 'rgba(255,255,255,0.8)',
  },
  cardLabel: { fontSize: 11, fontWeight: 600 },
};
