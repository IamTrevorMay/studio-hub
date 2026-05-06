import React, { useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { STATUS_COLORS, STATUS_LABELS } from './postShowConstants';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;

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

// Strip file extension from a Drive filename to use as a clip title
function titleFromFilename(name) {
  return name.replace(/\.[^.]+$/, '');
}

export default function PhaseFour({ session, onSessionChange, recipients }) {
  const { profile } = useAuth();
  const [syncing, setSyncing] = useState(false);

  // Import from Drive state
  const [driveFiles, setDriveFiles] = useState([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState(null);
  const [driveSelected, setDriveSelected] = useState(new Set());
  const [driveSynced, setDriveSynced] = useState(new Set()); // webViewLinks already in shorts_queue
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveImporting, setDriveImporting] = useState(false);

  // Find Alana's folder ID from recipients
  const alanaRecipient = recipients.find(r =>
    r.name && r.name.toLowerCase().includes('alana'),
  );
  const alanaFolderId = alanaRecipient?.driveFolderId;

  async function fetchDriveFiles() {
    if (!alanaFolderId) {
      setDriveError('No Drive folder configured for Alana. Set it in Settings → Recipients.');
      return;
    }
    setDriveLoading(true);
    setDriveError(null);
    setDriveFiles([]);
    setDriveSelected(new Set());
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${SUPABASE_URL}/functions/v1/drive-list-clips?folderId=${encodeURIComponent(alanaFolderId)}`,
        { headers: { Authorization: `Bearer ${authSession.access_token}` } },
      );
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Failed to list Drive files');

      const files = json.files || [];
      setDriveFiles(files);

      // Cross-reference existing shorts_queue rows by drive_link
      if (files.length > 0) {
        const links = files.map(f => f.webViewLink).filter(Boolean);
        const { data: existing } = await supabase
          .from('shorts_queue')
          .select('drive_link')
          .in('drive_link', links);
        const syncedLinks = new Set((existing || []).map(r => r.drive_link));
        setDriveSynced(syncedLinks);
      }
    } catch (err) {
      setDriveError(err.message);
    } finally {
      setDriveLoading(false);
    }
  }

  function toggleDriveFile(webViewLink) {
    setDriveSelected(prev => {
      const next = new Set(prev);
      if (next.has(webViewLink)) next.delete(webViewLink);
      else next.add(webViewLink);
      return next;
    });
  }

  function selectAllUnsyncedDrive() {
    const unsyncedLinks = driveFiles
      .filter(f => !driveSynced.has(f.webViewLink))
      .map(f => f.webViewLink);
    setDriveSelected(new Set(unsyncedLinks));
  }

  async function handleDriveImport() {
    if (driveSelected.size === 0) return;
    setDriveImporting(true);
    try {
      const filesToImport = driveFiles.filter(f => driveSelected.has(f.webViewLink));
      for (const file of filesToImport) {
        const sourceDate = file.createdTime ? file.createdTime.split('T')[0] : null;
        const row = {
          title: titleFromFilename(file.name),
          drive_link: file.webViewLink,
          source_show: sourceDate,
          urgency: 'evergreen',
          stage: 'editing',
          sort_order: 0,
          created_by: profile?.id || null,
        };
        const { error } = await supabase.from('shorts_queue').insert(row);
        if (error) {
          console.error(`Import failed for ${file.name}:`, error);
          continue;
        }
        setDriveSynced(prev => new Set([...prev, file.webViewLink]));
      }
      setDriveSelected(new Set());
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setDriveImporting(false);
    }
  }

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

  const unsyncedDriveCount = driveFiles.filter(f => !driveSynced.has(f.webViewLink)).length;

  return (
    <div style={st.phase}>
      {/* Import from Drive */}
      <div style={st.driveSection}>
        <div style={st.sectionHeader}>
          <h4 style={st.sectionTitle}>Import from Drive</h4>
          <button
            style={{ ...st.driveBtn, ...(driveLoading ? st.disabledBtn : {}) }}
            onClick={() => { setDriveOpen(true); fetchDriveFiles(); }}
            disabled={driveLoading}
          >
            {driveLoading ? 'Loading...' : 'Scan Folder'}
          </button>
        </div>
        <span style={st.driveHint}>
          Pull clips from Alana's Drive folder into the Shorts Queue — useful for catching uploads that weren't auto-synced.
        </span>

        {driveOpen && (
          <div style={st.drivePanel}>
            {driveError && (
              <div style={st.driveError}>{driveError}</div>
            )}

            {driveLoading && (
              <div style={st.driveLoadingText}>Scanning Drive folder...</div>
            )}

            {!driveLoading && !driveError && driveFiles.length === 0 && (
              <div style={st.driveEmptyText}>No video files found in folder.</div>
            )}

            {!driveLoading && driveFiles.length > 0 && (
              <>
                <div style={st.driveToolbar}>
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
                    {driveFiles.length} file{driveFiles.length !== 1 ? 's' : ''} found
                    {unsyncedDriveCount < driveFiles.length && ` · ${driveFiles.length - unsyncedDriveCount} already synced`}
                  </span>
                  {unsyncedDriveCount > 0 && (
                    <button style={st.driveSelectAll} onClick={selectAllUnsyncedDrive}>
                      Select all unsynced ({unsyncedDriveCount})
                    </button>
                  )}
                </div>

                <div style={st.driveList}>
                  {driveFiles.map(file => {
                    const alreadySynced = driveSynced.has(file.webViewLink);
                    const checked = driveSelected.has(file.webViewLink);
                    const dateStr = file.createdTime
                      ? new Date(file.createdTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                      : '';
                    return (
                      <div
                        key={file.id}
                        style={{ ...st.driveRow, ...(alreadySynced ? { opacity: 0.45 } : {}) }}
                        onClick={() => !alreadySynced && toggleDriveFile(file.webViewLink)}
                      >
                        <input
                          type="checkbox"
                          checked={alreadySynced || checked}
                          disabled={alreadySynced}
                          onChange={() => !alreadySynced && toggleDriveFile(file.webViewLink)}
                          style={{ accentColor: '#6366f1', cursor: alreadySynced ? 'default' : 'pointer' }}
                        />
                        <div style={st.rowInfo}>
                          <span style={st.rowTitle}>{titleFromFilename(file.name)}</span>
                          <span style={st.rowMeta}>
                            {dateStr}
                            {alreadySynced && <> &middot; <span style={{ color: '#22c55e' }}>Already synced</span></>}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {driveSelected.size > 0 && (
                  <button
                    style={{ ...st.primaryBtn, ...(driveImporting ? st.disabledBtn : {}), marginTop: '8px' }}
                    onClick={handleDriveImport}
                    disabled={driveImporting}
                  >
                    {driveImporting ? 'Importing...' : `Import ${driveSelected.size} Clip${driveSelected.size !== 1 ? 's' : ''} to Queue`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

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
  // Drive import styles
  driveSection: {
    display: 'flex', flexDirection: 'column', gap: '8px', padding: '14px 16px',
    background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.12)',
    borderRadius: '10px',
  },
  driveHint: { fontSize: '12px', color: 'rgba(255,255,255,0.35)', lineHeight: 1.4 },
  driveBtn: {
    padding: '6px 14px', fontSize: '12px', fontWeight: 600, color: '#6366f1',
    background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  },
  drivePanel: {
    display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px',
  },
  driveError: {
    fontSize: '12px', color: '#ef4444', padding: '8px 12px',
    background: 'rgba(239,68,68,0.06)', borderRadius: '6px',
  },
  driveLoadingText: { fontSize: '12px', color: 'rgba(255,255,255,0.35)', padding: '8px 0' },
  driveEmptyText: { fontSize: '12px', color: 'rgba(255,255,255,0.3)', padding: '8px 0' },
  driveToolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
  },
  driveSelectAll: {
    padding: '4px 10px', fontSize: '11px', fontWeight: 600, color: '#6366f1',
    background: 'none', border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit',
  },
  driveList: {
    display: 'flex', flexDirection: 'column', gap: '4px',
    maxHeight: '280px', overflowY: 'auto',
  },
  driveRow: {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '6px', cursor: 'pointer',
  },
};
