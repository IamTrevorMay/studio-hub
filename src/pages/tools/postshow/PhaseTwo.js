import React, { useState } from 'react';
import { STATUS_COLORS, STATUS_LABELS } from './postShowConstants';

export default function PhaseTwo({ session, onSessionChange, recipients, settings }) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);

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

    // Mark uploading
    let allClips = session.clips.map(c =>
      toUpload.find(u => u.id === c.id) ? { ...c, status: 'uploading' } : c
    );
    onSessionChange({ ...session, clips: allClips });

    try {
      const resp = await fetch(`${settings.apiBaseUrl}/api/drive/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clips: toUpload.map(c => ({
            id: c.id,
            title: c.title,
            type: c.type,
            outputFormat: c.outputFormat,
            assignee: c.assignee,
            driveFolder: c.driveFolder,
          })),
        }),
      });

      if (!resp.ok) throw new Error(await resp.text() || 'Upload failed');
      const result = await resp.json();

      const statusMap = {};
      (result.results || []).forEach(r => {
        statusMap[r.id] = r.success ? 'uploaded' : 'error';
      });
      allClips = session.clips.map(c => statusMap[c.id] ? { ...c, status: statusMap[c.id], driveLink: result.results?.find(r => r.id === c.id)?.driveLink || '' } : c);
      onSessionChange({ ...session, clips: allClips });
      setUploadProgress({ done: toUpload.length, total: toUpload.length });
    } catch (err) {
      console.error('Upload error:', err);
      alert(`Upload failed: ${err.message}\n\nMake sure the local API service is running at ${settings.apiBaseUrl}`);
      allClips = session.clips.map(c =>
        toUpload.find(u => u.id === c.id) ? { ...c, status: 'cut' } : c
      );
      onSessionChange({ ...session, clips: allClips });
    } finally {
      setUploading(false);
    }
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
            return (
              <div key={clip.id} style={st.tableRow}>
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
            );
          })}
        </div>
      </div>
    );
  }

  const uploadableCount = clips.filter(c => c.status === 'cut' && c.assignee).length;

  return (
    <div style={st.phase}>
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
    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px',
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
};
