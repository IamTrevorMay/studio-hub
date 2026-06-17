// Progress Kanban — 4-column production pipeline for short-form videos
// Cards are created/moved automatically by the sync-progress-cards edge function
// based on Google Drive folder contents.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

// ─── Column config ───────────────────────────────────────────

const COLUMNS = [
  { key: 'write_film', label: 'Write & Film', color: 'rgba(168,85,247,0.15)', textColor: 'rgba(168,85,247,0.8)' },
  { key: 'editing',    label: 'Editing',      color: 'rgba(251,191,36,0.15)', textColor: 'rgba(251,191,36,0.8)' },
  { key: 'ready',      label: 'Ready',        color: 'rgba(96,165,250,0.15)', textColor: 'rgba(96,165,250,0.8)' },
  { key: 'scheduled',  label: 'Scheduled',    color: 'rgba(52,211,153,0.15)', textColor: 'rgba(52,211,153,0.8)' },
];

const CONTENT_TYPE_COLORS = {
  short: { bg: 'rgba(96,165,250,0.15)', text: 'rgba(96,165,250,0.9)' },
  long:  { bg: 'rgba(168,85,247,0.15)', text: 'rgba(168,85,247,0.9)' },
};

// ─── Helpers ─────────────────────────────────────────────────

function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function archiveCountdown(movedAt) {
  if (!movedAt) return null;
  const diff = 3 * 24 * 60 * 60 * 1000 - (Date.now() - new Date(movedAt).getTime());
  if (diff <= 0) return 'Archiving soon';
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return `Archiving in ${days}d`;
}

// ─── Component ───────────────────────────────────────────────

export default function ProgressKanban() {
  const { isAdmin } = useAuth();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, card }
  const menuRef = useRef(null);

  const fetchCards = useCallback(async () => {
    const { data, error } = await supabase
      .from('progress_cards')
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (!error) setCards(data || []);
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => { fetchCards(); }, [fetchCards]);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(fetchCards, 60000);
    return () => clearInterval(id);
  }, [fetchCards]);

  // Tab re-focus refresh
  useVisibilityRefresh(fetchCards);

  // Close context menu on click outside or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  const handleContextMenu = (e, card) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, card });
  };

  const handleDelete = async () => {
    if (!contextMenu?.card) return;
    const cardId = contextMenu.card.id;
    setContextMenu(null);
    // Optimistic removal
    setCards(prev => prev.filter(c => c.id !== cardId));
    await supabase
      .from('progress_cards')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', cardId);
    fetchCards();
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/sync-progress-cards`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      );
      await fetchCards();
    } catch (err) {
      console.error('Manual sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  // Group cards by status
  const grouped = {};
  for (const col of COLUMNS) grouped[col.key] = [];
  for (const card of cards) {
    if (grouped[card.status]) grouped[card.status].push(card);
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <h2 style={styles.title}>Progress</h2>
        <span style={styles.subtitle}>Production pipeline</span>
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            ...styles.syncBtn,
            opacity: syncing ? 0.5 : 1,
            cursor: syncing ? 'default' : 'pointer',
          }}
          title="Sync with Google Drive"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={syncing ? { animation: 'spin 1s linear infinite' } : {}}>
            <path d="M21.5 2v6h-6" /><path d="M2.5 22v-6h6" />
            <path d="M2.5 11.5a10 10 0 0 1 18.8-4.3" /><path d="M21.5 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </div>

      <div style={styles.columns}>
        {COLUMNS.map(col => {
            const items = grouped[col.key];
            return (
              <div key={col.key} style={styles.column}>
                <div style={{ ...styles.colHeader, background: col.color }}>
                  <span style={{ ...styles.colLabel, color: col.textColor }}>{col.label}</span>
                  {items.length > 0 && (
                    <span style={{ ...styles.colCount, color: col.textColor }}>{items.length}</span>
                  )}
                </div>

                <div style={styles.colBody}>
                  {items.length === 0 ? (
                    <div style={styles.emptyState}>No items</div>
                  ) : (
                    items.map(card => (
                      <div key={card.id} style={styles.card} onContextMenu={isAdmin ? e => handleContextMenu(e, card) : undefined}>
                        <div style={styles.cardTitle}>{card.title}</div>
                        <div style={styles.cardMeta}>
                          <span style={{
                            ...styles.typeBadge,
                            background: CONTENT_TYPE_COLORS[card.content_type]?.bg,
                            color: CONTENT_TYPE_COLORS[card.content_type]?.text,
                          }}>
                            {card.content_type === 'short' ? 'Short' : 'Long'}
                          </span>
                          <span style={styles.timeAgo}>{relativeTime(card.created_at)}</span>
                        </div>
                        {card.status === 'scheduled' && card.moved_to_scheduled_at && (
                          <div style={styles.archiveNote}>
                            {archiveCountdown(card.moved_to_scheduled_at)}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
        })}
      </div>

      {loading && cards.length === 0 && (
        <div style={styles.loadingText}>Loading pipeline...</div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            ...styles.contextMenu,
            top: contextMenu.y,
            left: contextMenu.x,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={styles.contextMenuTitle}>{contextMenu.card.title}</div>
          <button style={styles.contextMenuBtn} onClick={handleDelete}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Delete card
          </button>
        </div>
      )}

      {/* Spin animation for sync icon */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = {
  wrapper: {
    marginBottom: 24,
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 14,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
    fontWeight: 400,
  },
  columns: {
    display: 'flex',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  column: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  colHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderRadius: '8px 8px 0 0',
  },
  colLabel: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  colCount: {
    fontSize: 11,
    fontWeight: 600,
    opacity: 0.7,
  },
  colBody: {
    flex: 1,
    minHeight: 60,
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '0 0 8px 8px',
    border: '1px solid rgba(255,255,255,0.06)',
    borderTop: 'none',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.2)',
    fontSize: 12,
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    padding: '10px 12px',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 1.35,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  typeBadge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  timeAgo: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
  archiveNote: {
    marginTop: 6,
    fontSize: 11,
    color: 'rgba(52,211,153,0.6)',
    fontStyle: 'italic',
  },
  loadingText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    padding: '16px 0',
  },
  syncBtn: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: 500,
    padding: '4px 10px',
    transition: 'background 0.15s, color 0.15s',
  },
  contextMenu: {
    position: 'fixed',
    zIndex: 9999,
    background: '#1e1e2e',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: 4,
    minWidth: 160,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  contextMenuTitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    padding: '6px 10px 4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  contextMenuBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    background: 'none',
    border: 'none',
    borderRadius: 5,
    padding: '7px 10px',
    color: '#f87171',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'left',
  },
};
