import React, { useState } from 'react';
import { STATUS_COLORS, STATUS_LABELS } from './postShowConstants';

export default function PhaseTwo({ session, onSessionChange, recipients, settings }) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [clipProgress, setClipProgress] = useState({}); // { [clipId]: 'waiting' | 'uploading' | 'done' | 'error' }

  const clips = (session.clips || []).filter(c => c.status === 'cut' || c.status === 'uploaded' || c.status === 'uploading');
  const shorts = clips.filter(c => c.type === 'short');
  const longs = clips.filter(c => c.type === 'long');

  function updateClipAssignee(clipId, assigneeId) {
    const allClips = session.clips.map(c => {
      if (c.id !== clipId) return c;
      const recipient = recipients.find(r => r.id === assigneeId);
      return { ...c, assignee: assigneeId, driveFolder: recipient?.driveFolderPath || '' };
    });
    onSessionChange({ ...session, clips: allClips });
  }

  async function handleUploadAll() {
    const toUpload = clips.filter(c => c.status === 'cut' && c.assignee);
    if (toUpload.length === 0) {
      alert('No clips ready to upload. Ensure clips are cut and assigned to a recipient.');
      return;
    }
    setUploading(true);
    setUploadProgress({ done: 0, total: toUpload.length });

    // Initialize all clip progress to waiting
    const initialProgress = {};
    toUpload.forEach(c => { initialProgress[c.id] = 'waiting'; });
    setClipProgress(initialProgress);

    // Mark all as uploading status in session
    let allClips = session.clips.map(c =>
      toUpload.find(u => u.id === c.id) ? { ...c, status: 'uploading' } : c
    );
    onSessionChange({ ...session, clips: allClips });

    let doneCount = 0;

    for (const clip of toUpload) {
      // Set this clip to uploading
      setClipProgress(prev => ({ ...prev, [clip.id]: 'uploading' }));

      try {
        const r = recipients.find(r => r.id === clip.assignee);
        const resp = await fetch(`${settings.apiBaseUrl}/api/drive/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clips: [{
              id: clip.id,
              title: clip.title,
              type: clip.type,
              outputFormat: clip.outputFormat,
              assignee: clip.assignee,
              driveFolder: clip.driveFolder || r?.driveFolderPath || '',
            }],
          }),
        });

        if (!resp.ok) throw new Error(await resp.text() || 'Upload failed');
        const result = await resp.json();
        const clipResult = (result.results || [])[0];

        if (clipResult?.success) {
          setClipProgress(prev => ({ ...prev, [clip.id]: 'done' }));
          allClips = allClips.map(c => c.id === clip.id ? { ...c, status: 'uploaded', driveLink: clipResult.driveLink || '' } : c);
        } else {
          setClipProgress(prev => ({ ...prev, [clip.id]: 'error' }));
          allClips = allClips.map(c => c.id === clip.id ? { ...c, status: 'cut' } : c);
        }
      } catch (err) {
        console.error(`Upload error for clip ${clip.id}:`, err);
        setClipProgress(prev => ({ ...prev, [clip.id]: 'error' }));
        allClips = allClips.map(c => c.id === clip.id ? { ...c, status: 'cut' } : c);
      }

      doneCount++;
      setUploadProgress({ done: doneCount, total: toUpload.length });
      onSessionChange({ ...session, clips: allClips });
    }

    setUploading(false);
  }

  function renderClipGroup(title, groupClips) {
    if (groupClips.length === 0) return null;
    return (
      <div style={st.group}>
        <h4 style={st.groupTitle}>{title} ({groupClips.length})</h4>
        <div style={st.table}>
          <div style={st.tableHeader}>
            <span style={{ ...st.cell, flex: 2 }}>Title</span>
            <span style={st.cell}>Status</span>
            <span style={{ ...st.cell, flex: 1.5 }}>Assign To</span>
            <span style={st.cell}>Drive Folder</span>
          </div>
          {groupClips.map(clip => {
            const recipient = recipients.find(r => r.id === clip.assignee);
            const progress = clipProgress[clip.id];
            return (
              <div key={clip.id} style={st.tableRow}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ ...st.cell, flex: 2, color: '#e2e8f0', fontWeight: 500 }}>{clip.title}</span>
                    <span style={st.cell}>
                      <span style={{ ...st.badge, background: STATUS_COLORS[clip.status] + '22', color: STATUS_COLORS[clip.status] }}>
                        {STATUS_LABELS[clip.status]}
                      </span>
                    </span>
                    <span style={{ ...st.cell, flex: 1.5 }}>
                      <select
                        style={st.select}
                        value={clip.assignee}
                        onChange={e => updateClipAssignee(clip.id, e.target.value)}
                        disabled={clip.status === 'uploading'}
                      >
                        <option value="">Assign...</option>
                        {recipients.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </span>
                    <span style={{ ...st.cell, color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>
                      {recipient?.driveFolderPath || '—'}
                    </span>
                  </div>
                  {/* Per-clip progress bar */}
                  {progress && (
                    <div style={st.progressBarTrack}>
                      <div style={{
                        ...st.progressBarFill,
                        ...(progress === 'waiting' ? st.progressWaiting : {}),
                        ...(progress === 'uploading' ? st.progressUploading : {}),
                        ...(progress === 'done' ? st.progressDone : {}),
                        ...(progress === 'error' ? st.progressError : {}),
                      }} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const uploadableCount = clips.filter(c => c.status === 'cut' && c.assignee).length;

  return (
    <div style={st.phase}>
      <style>{`
        @keyframes progressShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
      {clips.length === 0 ? (
        <div style={st.emptyState}>
          <p style={st.emptyText}>No cut clips yet. Complete Phase 1 to cut video clips first.</p>
        </div>
      ) : (
        <>
          {renderClipGroup('Shorts', shorts)}
          {renderClipGroup('Longs', longs)}

          <div style={st.actionBar}>
            {uploadProgress && (
              <span style={st.progressLabel}>
                {uploadProgress.done}/{uploadProgress.total} uploaded
              </span>
            )}
            <span style={st.readyLabel}>{uploadableCount} clip{uploadableCount !== 1 ? 's' : ''} ready to upload</span>
            <button
              style={{ ...st.primaryBtn, ...(uploadableCount === 0 || uploading ? st.disabledBtn : {}) }}
              onClick={handleUploadAll}
              disabled={uploadableCount === 0 || uploading}
            >
              {uploading ? 'Uploading...' : `Upload ${uploadableCount} Clip${uploadableCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const st = {
  phase: { display: 'flex', flexDirection: 'column', gap: '24px' },
  group: { display: 'flex', flexDirection: 'column', gap: '8px' },
  groupTitle: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0', margin: 0 },
  table: { display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', overflow: 'hidden' },
  tableHeader: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px',
    background: 'rgba(255,255,255,0.03)', fontSize: '11px', fontWeight: 600,
    color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  tableRow: {
    display: 'flex', alignItems: 'stretch', gap: '0', padding: '10px 14px',
    borderTop: '1px solid rgba(255,255,255,0.04)', fontSize: '13px', color: 'rgba(255,255,255,0.5)',
  },
  cell: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge: { padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 },
  select: {
    padding: '4px 8px', fontSize: '12px', color: '#e2e8f0',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', outline: 'none', fontFamily: 'inherit', cursor: 'pointer', width: '100%',
  },
  primaryBtn: {
    padding: '7px 16px', fontSize: '13px', fontWeight: 600, color: '#fff',
    background: '#3b82f6', border: 'none', borderRadius: '8px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  disabledBtn: { opacity: 0.4, cursor: 'not-allowed' },
  actionBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px',
    padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  readyLabel: { fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginRight: 'auto' },
  progressLabel: { fontSize: '12px', color: '#22c55e' },
  emptyState: {
    padding: '40px', textAlign: 'center',
    border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '10px',
  },
  emptyText: { fontSize: '13px', color: 'rgba(255,255,255,0.3)', margin: 0 },

  // Per-clip progress bars
  progressBarTrack: {
    height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.06)',
    width: '100%', marginTop: '6px', overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%', borderRadius: '2px', transition: 'width 0.3s, background 0.3s',
    width: '100%',
  },
  progressWaiting: { background: 'rgba(255,255,255,0.1)', width: '100%' },
  progressUploading: {
    background: 'linear-gradient(90deg, #6366f1, #818cf8, #6366f1)',
    backgroundSize: '200% 100%',
    animation: 'progressShimmer 1.5s ease-in-out infinite',
    width: '100%',
  },
  progressDone: { background: '#22c55e', width: '100%' },
  progressError: { background: '#ef4444', width: '100%' },
};
