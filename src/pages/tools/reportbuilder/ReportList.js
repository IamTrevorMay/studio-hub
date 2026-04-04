import React, { useState } from 'react';
import { DATA_SOURCE_TYPES, describeSchedule } from './reportBuilderConstants';

const SOURCE_COLORS = { rss: '#f59e0b', triton_api: '#3b82f6', supabase_query: '#22c55e' };
const STATUS_COLORS = { completed: '#22c55e', running: '#f59e0b', failed: '#ef4444', pending: 'rgba(255,255,255,0.25)' };

export default function ReportList({ configs, lastRuns, loading, onNew, onEdit, onToggleEnabled, onDelete }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Reports</h2>
        </div>
        <div style={styles.empty}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Reports</h2>
          <p style={styles.subtitle}>{configs.length} configured report{configs.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={onNew} style={styles.newBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Report
        </button>
      </div>

      {configs.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>No reports configured</div>
          <div style={styles.emptyText}>Create your first report to start generating recurring AI content.</div>
          <button onClick={onNew} style={styles.emptyBtn}>Create Report</button>
        </div>
      ) : (
        <div style={styles.list}>
          {configs.map(cfg => {
            const sources = cfg.data_sources && Array.isArray(cfg.data_sources) && cfg.data_sources.length > 0
              ? cfg.data_sources.map(s => DATA_SOURCE_TYPES.find(t => t.key === s.type) || { key: s.type, label: s.type })
              : [DATA_SOURCE_TYPES.find(t => t.key === cfg.data_source_type) || { key: cfg.data_source_type, label: cfg.data_source_type }];
            const lastRun = lastRuns.get(cfg.id);
            const isDeleting = confirmDeleteId === cfg.id;

            return (
              <div key={cfg.id} style={styles.card}>
                <div style={styles.cardTop}>
                  <div style={styles.cardInfo}>
                    <div style={styles.cardName}>{cfg.name}</div>
                    {cfg.description && <div style={styles.cardDesc}>{cfg.description}</div>}
                  </div>
                  <label style={styles.toggle} title={cfg.enabled ? 'Enabled' : 'Disabled'}>
                    <input
                      type="checkbox"
                      checked={cfg.enabled}
                      onChange={() => onToggleEnabled(cfg.id, !cfg.enabled)}
                      style={{ display: 'none' }}
                    />
                    <div style={{ ...styles.toggleTrack, ...(cfg.enabled ? styles.toggleTrackOn : {}) }}>
                      <div style={{ ...styles.toggleThumb, ...(cfg.enabled ? styles.toggleThumbOn : {}) }} />
                    </div>
                  </label>
                </div>

                <div style={styles.cardMeta}>
                  {sources.map((src, i) => (
                    <span key={i} style={{ ...styles.badge, background: (SOURCE_COLORS[src.key] || '#6366f1') + '22', color: SOURCE_COLORS[src.key] || '#6366f1' }}>
                      {src.label}
                    </span>
                  ))}
                  <span style={styles.metaText}>{describeSchedule(cfg.schedule)}</span>
                  {lastRun && (
                    <span style={styles.metaText}>
                      Last run: {lastRun.date}
                      <span style={{ ...styles.statusDot, background: STATUS_COLORS[lastRun.status] || 'gray' }} />
                    </span>
                  )}
                  {cfg.delivery?.email && <span style={styles.emailBadge}>Email</span>}
                </div>

                <div style={styles.cardActions}>
                  <button onClick={() => onEdit(cfg.id)} style={styles.actionBtn}>Edit</button>
                  {isDeleting ? (
                    <div style={styles.confirmRow}>
                      <span style={styles.confirmText}>Delete?</span>
                      <button onClick={() => { onDelete(cfg.id); setConfirmDeleteId(null); }} style={{ ...styles.actionBtn, color: '#ef4444' }}>Yes</button>
                      <button onClick={() => setConfirmDeleteId(null)} style={styles.actionBtn}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(cfg.id)} style={{ ...styles.actionBtn, color: 'rgba(255,255,255,0.25)' }}>Delete</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '20px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 2px 0',
  },
  subtitle: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
  },
  newBtn: {
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '8px 18px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  empty: {
    textAlign: 'center',
    padding: '60px 24px',
  },
  emptyTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: '8px',
  },
  emptyText: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.3)',
    marginBottom: '20px',
  },
  emptyBtn: {
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '10px 24px',
    cursor: 'pointer',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  card: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    padding: '16px',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '10px',
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '2px',
  },
  cardDesc: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
    marginBottom: '10px',
  },
  badge: {
    fontSize: '11px',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '4px',
  },
  emailBadge: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: '4px',
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
  },
  metaText: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  cardActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    paddingTop: '10px',
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.45)',
    fontSize: '12px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
    transition: 'color 0.12s',
  },
  confirmRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  confirmText: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
  },
  toggle: {
    cursor: 'pointer',
    flexShrink: 0,
  },
  toggleTrack: {
    width: '36px',
    height: '20px',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.1)',
    position: 'relative',
    transition: 'background 0.15s',
  },
  toggleTrackOn: {
    background: '#6366f1',
  },
  toggleThumb: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    background: '#ffffff',
    position: 'absolute',
    top: '2px',
    left: '2px',
    transition: 'left 0.15s',
  },
  toggleThumbOn: {
    left: '18px',
  },
};
