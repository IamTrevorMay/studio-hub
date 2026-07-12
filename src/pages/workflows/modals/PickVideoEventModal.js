import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import backdropDismiss from '../../../lib/backdropDismiss';

const VIDEO_EVENT_TYPES = ['video_post', 'tmbb_video', 'filming', 'live_recording'];

function formatWhen(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function PickVideoEventModal({ task, onSubmit, onClose }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const now = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, title, event_type, start_date, end_date')
        .in('event_type', VIDEO_EVENT_TYPES)
        .gte('start_date', now)
        .order('start_date', { ascending: true })
        .limit(100);
      if (cancelled) return;
      if (error) console.error('Failed to load events:', error);
      setEvents(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.event_type || '').toLowerCase().includes(q)
    );
  }, [events, query]);

  const handleSubmit = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    try {
      // Self-write the link so this works for one-off tasks too (workflow tasks
      // also run the set_video_event handler — the repeat write is harmless).
      if (task.related_entity_id) {
        await supabase
          .from('sponsor_deliverables')
          .update({ video_event_id: selectedId })
          .eq('id', task.related_entity_id);
      }
      await onSubmit({
        video_event_id: selectedId,
        deliverable_id: task.related_entity_id,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay} {...backdropDismiss(onClose)}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>Connect to a video</div>
            <div style={styles.subtitle}>
              Pick the video event on the calendar this deliverable belongs to.
            </div>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or type…"
          style={styles.search}
        />

        <div style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Loading events…</div>
          ) : filtered.length === 0 ? (
            <div style={styles.empty}>No upcoming video events found.</div>
          ) : (
            filtered.map((ev) => {
              const isSelected = ev.id === selectedId;
              return (
                <div
                  key={ev.id}
                  onClick={() => setSelectedId(ev.id)}
                  style={{
                    ...styles.row,
                    ...(isSelected ? styles.rowSelected : {}),
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.rowTitle}>{ev.title || '(untitled)'}</div>
                    <div style={styles.rowMeta}>
                      <span style={styles.typeBadge}>{ev.event_type.replace('_', ' ')}</span>
                      <span style={styles.dateText}>{formatWhen(ev.start_date)}</span>
                    </div>
                  </div>
                  {isSelected && <span style={styles.checkmark}>✓</span>}
                </div>
              );
            })
          )}
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...styles.submitBtn, opacity: selectedId ? 1 : 0.5, cursor: selectedId ? 'pointer' : 'not-allowed' }}
            onClick={handleSubmit}
            disabled={!selectedId || submitting}
          >
            {submitting ? 'Connecting…' : 'Connect Video'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#15151f', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16, padding: 20, width: 480, maxWidth: '90vw',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14,
  },
  title: { fontSize: 18, fontWeight: 700, color: '#fff' },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
    fontSize: 16, cursor: 'pointer', padding: 4,
  },
  search: {
    width: '100%', boxSizing: 'border-box', padding: '8px 12px',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none', marginBottom: 10,
  },
  list: {
    display: 'flex', flexDirection: 'column', gap: 6,
    maxHeight: 340, overflowY: 'auto', marginBottom: 14,
  },
  empty: { padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  row: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 12px', borderRadius: 10,
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    cursor: 'pointer',
  },
  rowSelected: {
    background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.5)',
  },
  rowTitle: { fontSize: 14, color: '#fff', fontWeight: 500, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowMeta: { display: 'flex', alignItems: 'center', gap: 8 },
  typeBadge: {
    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
    background: 'rgba(99,102,241,0.18)', color: '#a5b4fc',
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  dateText: { fontSize: 12, color: 'rgba(255,255,255,0.5)' },
  checkmark: { color: '#a5b4fc', fontSize: 18, fontWeight: 600 },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  cancelBtn: {
    padding: '8px 16px', borderRadius: 8, background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer', fontSize: 13,
  },
  submitBtn: {
    padding: '8px 18px', borderRadius: 8, background: '#6366f1',
    border: 'none', color: '#fff', fontWeight: 600, fontSize: 13,
  },
};
