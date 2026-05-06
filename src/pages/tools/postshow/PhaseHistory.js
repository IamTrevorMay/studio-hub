import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';

function relativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const STATUS_CONFIG = {
  completed: { label: 'Completed', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  partial: { label: 'Partial', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  failed: { label: 'Failed', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

export default function PhaseHistory() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    async function fetchLogs() {
      const { data, error } = await supabase
        .from('clipping_job_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error && data) setLogs(data);
      setLoading(false);
    }
    fetchLogs();
  }, []);

  if (loading) {
    return (
      <div style={st.emptyState}>
        <p style={st.emptyText}>Loading history...</p>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div style={st.emptyState}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
          <path d="M12 8v4l3 3" />
          <circle cx="12" cy="12" r="10" />
        </svg>
        <p style={st.emptyText}>No upload history yet. Complete an upload in the Review & Upload phase to see logs here.</p>
      </div>
    );
  }

  return (
    <div style={st.phase}>
      <div style={st.header}>
        <h3 style={st.title}>Upload History</h3>
        <span style={st.subtitle}>{logs.length} session{logs.length !== 1 ? 's' : ''}</span>
      </div>
      <div style={st.list}>
        {logs.map(log => {
          const sc = STATUS_CONFIG[log.status] || STATUS_CONFIG.completed;
          const isExpanded = expandedId === log.id;
          return (
            <div key={log.id} style={st.card}>
              <div style={st.cardTop}>
                <div style={st.cardLeft}>
                  <span style={st.videoTitle}>{log.video_title || log.source_filename || 'Untitled'}</span>
                  {log.source_filename && log.video_title !== log.source_filename && (
                    <span style={st.filename}>{log.source_filename}</span>
                  )}
                </div>
                <div style={st.cardRight}>
                  <span style={st.timestamp}>{relativeTime(log.started_at)}</span>
                  <span style={{ ...st.statusBadge, background: sc.bg, color: sc.color }}>{sc.label}</span>
                </div>
              </div>

              <div style={st.cardMeta}>
                <span style={st.metaItem}>
                  <span style={st.metaLabel}>Clips:</span>
                  <span style={{ color: '#22c55e', fontWeight: 600 }}>{log.successful_clips}</span>
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>/{log.total_clips}</span>
                  {log.failed_clips > 0 && (
                    <span style={{ color: '#ef4444', marginLeft: '4px' }}>({log.failed_clips} failed)</span>
                  )}
                </span>
                {log.recipients && log.recipients.length > 0 && (
                  <span style={st.metaItem}>
                    <span style={st.metaLabel}>To:</span>
                    <span style={{ color: 'rgba(255,255,255,0.6)' }}>{log.recipients.join(', ')}</span>
                  </span>
                )}
              </div>

              {log.error_output && (
                <button
                  style={st.expandBtn}
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                >
                  {isExpanded ? '▾ Hide errors' : '▸ Show errors'}
                </button>
              )}
              {isExpanded && log.error_output && (
                <div style={st.errorBox}>{log.error_output}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const st = {
  phase: { display: 'flex', flexDirection: 'column', gap: '16px' },
  header: { display: 'flex', alignItems: 'baseline', gap: '10px' },
  title: { fontSize: '16px', fontWeight: 700, color: '#e2e8f0', margin: 0 },
  subtitle: { fontSize: '12px', color: 'rgba(255,255,255,0.35)' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  card: {
    padding: '14px 16px', background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px',
    display: 'flex', flexDirection: 'column', gap: '10px',
  },
  cardTop: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px',
  },
  cardLeft: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 },
  cardRight: { display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
  videoTitle: {
    fontSize: '14px', fontWeight: 600, color: '#e2e8f0',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  filename: {
    fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  timestamp: { fontSize: '12px', color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' },
  statusBadge: {
    padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  cardMeta: { display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '13px' },
  metaItem: { display: 'flex', alignItems: 'center', gap: '4px' },
  metaLabel: { color: 'rgba(255,255,255,0.35)', fontSize: '12px' },
  expandBtn: {
    alignSelf: 'flex-start', padding: '4px 0', background: 'none', border: 'none',
    color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer',
    fontFamily: 'inherit',
  },
  errorBox: {
    padding: '10px 12px', background: 'rgba(239,68,68,0.06)',
    border: '1px solid rgba(239,68,68,0.15)', borderRadius: '8px',
    color: '#fca5a5', fontSize: '12px', lineHeight: 1.5, fontFamily: 'monospace',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  emptyState: {
    padding: '60px 40px', textAlign: 'center',
    border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '10px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
  },
  emptyText: { fontSize: '13px', color: 'rgba(255,255,255,0.3)', margin: 0, maxWidth: '320px' },
};
