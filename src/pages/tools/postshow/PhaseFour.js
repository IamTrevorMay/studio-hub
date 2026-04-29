import React, { useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { STATUS_COLORS, STATUS_LABELS } from './postShowConstants';

// Map a clip into a shorts_queue row. The schema (id, title, source_show,
// urgency, post_by, stage, sort_order, drive_link, ...) is enforced by
// Postgres; we just fill the columns we care about.
function clipToShortsQueueRow(clip, session, profileId) {
  const urgency = clip.timeSensitive ? 'time_sensitive' : 'evergreen';
  return {
    title: clip.title,
    source_show: session.showDate || null,
    urgency,
    post_by: clip.postByDate || null,
    stage: 'editing',
    sort_order: 0,
    drive_link: clip.driveLink || null,
    created_by: profileId || null,
  };
}

export default function PhaseFour({ session, onSessionChange, recipients }) {
  const { profile } = useAuth();
  const [syncing, setSyncing] = useState(false);

  // Only show clips that have been uploaded or further
  const eligibleClips = (session.clips || []).filter(c =>
    ['uploaded', 'synced'].includes(c.status),
  );

  // Auto-sync rule (unchanged): shorts assigned to Alana
  const autoSyncClips = eligibleClips.filter(c =>
    c.type === 'short' && c.assignee === 'alana' && c.status !== 'synced',
  );
  const syncedClips = eligibleClips.filter(c => c.status === 'synced');
  const otherClips = eligibleClips.filter(c =>
    c.status !== 'synced' && !(c.type === 'short' && c.assignee === 'alana'),
  );

  async function syncOne(clip) {
    const row = clipToShortsQueueRow(clip, session, profile?.id);
    const { error } = await supabase.from('shorts_queue').insert(row);
    if (error) throw error;
    onSessionChange(prev => ({
      ...prev,
      clips: prev.clips.map(c => c.id === clip.id ? { ...c, status: 'synced' } : c),
    }));
  }

  async function handleSync() {
    if (autoSyncClips.length === 0) return;
    setSyncing(true);
    try {
      // Insert each clip; the RLS policy on shorts_queue is permissive for
      // authenticated users so a single insert call works per row.
      for (const clip of autoSyncClips) {
        try {
          await syncOne(clip);
        } catch (err) {
          console.error(`Kanban sync failed for clip ${clip.id}:`, err);
        }
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleManualSync(clipId) {
    setSyncing(true);
    try {
      const clip = session.clips.find(c => c.id === clipId);
      if (!clip) return;
      await syncOne(clip);
    } catch (err) {
      alert(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={st.phase}>
      <div style={st.infoBox}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: '#22c55e' }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span style={st.infoText}>
          Shorts assigned to Alana auto-sync into the editing column with title, urgency, post-by date, and Drive link.
        </span>
      </div>

      {eligibleClips.length === 0 ? (
        <div style={st.emptyState}>
          <p style={st.emptyText}>No clips ready for Kanban sync. Complete Phases 1-2 first.</p>
        </div>
      ) : (
        <>
          {autoSyncClips.length > 0 && (
            <div style={st.section}>
              <div style={st.sectionHeader}>
                <h4 style={st.sectionTitle}>Auto-Sync Queue ({autoSyncClips.length})</h4>
                <button
                  style={{ ...st.primaryBtn, ...(syncing ? st.disabledBtn : {}) }}
                  onClick={handleSync}
                  disabled={syncing}
                >
                  {syncing ? 'Syncing...' : `Sync ${autoSyncClips.length} Card${autoSyncClips.length !== 1 ? 's' : ''}`}
                </button>
              </div>
              <div style={st.list}>
                {autoSyncClips.map(clip => (
                  <div key={clip.id} style={st.row}>
                    <div style={st.rowInfo}>
                      <span style={st.rowTitle}>{clip.title}</span>
                      <span style={st.rowMeta}>
                        Short &middot; Alana
                        {clip.timeSensitive && <> &middot; <span style={{ color: '#ef4444' }}>Time-sensitive</span></>}
                        {clip.postByDate && <> &middot; Post by {clip.postByDate}</>}
                      </span>
                    </div>
                    <span style={{ ...st.badge, background: STATUS_COLORS[clip.status] + '22', color: STATUS_COLORS[clip.status] }}>
                      {STATUS_LABELS[clip.status]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {otherClips.length > 0 && (
            <div style={st.section}>
              <h4 style={st.sectionTitle}>Other Clips</h4>
              <div style={st.list}>
                {otherClips.map(clip => {
                  const recipient = recipients.find(r => r.id === clip.assignee);
                  return (
                    <div key={clip.id} style={st.row}>
                      <div style={st.rowInfo}>
                        <span style={st.rowTitle}>{clip.title}</span>
                        <span style={st.rowMeta}>
                          {clip.type === 'short' ? 'Short' : 'Long'} &middot; {recipient?.name || 'Unassigned'}
                        </span>
                      </div>
                      <span style={{ ...st.badge, background: STATUS_COLORS[clip.status] + '22', color: STATUS_COLORS[clip.status] }}>
                        {STATUS_LABELS[clip.status]}
                      </span>
                      <button
                        style={{ ...st.syncBtn, ...(syncing ? st.disabledBtn : {}) }}
                        onClick={() => handleManualSync(clip.id)}
                        disabled={syncing}
                      >
                        Sync
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {syncedClips.length > 0 && (
            <div style={st.section}>
              <h4 style={st.sectionTitle}>Synced ({syncedClips.length})</h4>
              <div style={st.list}>
                {syncedClips.map(clip => {
                  const recipient = recipients.find(r => r.id === clip.assignee);
                  return (
                    <div key={clip.id} style={{ ...st.row, opacity: 0.6 }}>
                      <div style={st.rowInfo}>
                        <span style={st.rowTitle}>{clip.title}</span>
                        <span style={st.rowMeta}>
                          {clip.type === 'short' ? 'Short' : 'Long'} &middot; {recipient?.name || 'Unassigned'}
                        </span>
                      </div>
                      <span style={{ ...st.badge, background: STATUS_COLORS.synced + '22', color: STATUS_COLORS.synced }}>
                        Synced
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const st = {
  phase: { display: 'flex', flexDirection: 'column', gap: '20px' },
  infoBox: {
    display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 16px',
    background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)',
    borderRadius: '10px',
  },
  infoText: { fontSize: '13px', color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 },
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0', margin: 0 },
  list: { display: 'flex', flexDirection: 'column', gap: '6px' },
  row: {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
  },
  rowInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' },
  rowTitle: { fontSize: '13px', fontWeight: 600, color: '#e2e8f0' },
  rowMeta: { fontSize: '11px', color: 'rgba(255,255,255,0.35)' },
  badge: { padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, flexShrink: 0 },
  primaryBtn: {
    padding: '7px 16px', fontSize: '13px', fontWeight: 600, color: '#fff',
    background: '#22c55e', border: 'none', borderRadius: '8px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  syncBtn: {
    padding: '5px 12px', fontSize: '12px', fontWeight: 600, color: '#22c55e',
    background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)',
    borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  },
  disabledBtn: { opacity: 0.4, cursor: 'not-allowed' },
  emptyState: {
    padding: '40px', textAlign: 'center',
    border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '10px',
  },
  emptyText: { fontSize: '13px', color: 'rgba(255,255,255,0.3)', margin: 0 },
};
