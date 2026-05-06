import React, { useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { STATUS_COLORS, STATUS_LABELS } from './postShowConstants';

const FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/drive-upload-init`;

// Open a Drive resumable upload session for `clip` and PUT the cut Blob to it.
// Returns { id, webViewLink } from Drive on success.
async function uploadClipToDrive(clip, parentFolderId, accessToken) {
  if (!clip._outputBlob) throw new Error('Clip has no cut output yet — run Phase 1 first.');
  if (!parentFolderId) throw new Error('Recipient has no Drive folder configured.');

  const blob = clip._outputBlob;
  const mimeType = blob.type || (clip.outputFormat === 'mov' ? 'video/quicktime' : 'video/mp4');
  const filename = `${clip.title.replace(/[^\w\-. ]+/g, '_').trim() || 'clip'}.${clip.outputFormat || 'mp4'}`;

  // Step 1: ask our edge function to open a Drive resumable session on our behalf.
  // The function uses the shared service-account refresh token and returns the
  // upload URL — the actual bytes never pass through Supabase.
  const initRes = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename,
      parentFolderId,
      mimeType,
      sizeBytes: blob.size,
    }),
  });
  if (!initRes.ok) {
    const errBody = await initRes.json().catch(() => ({}));
    throw new Error(errBody.error || `Init failed: ${initRes.status}`);
  }
  const { uploadUrl } = await initRes.json();
  if (!uploadUrl) throw new Error('No upload URL returned');

  // Step 2: PUT the bytes directly to Drive. For files under ~100 MB a single
  // PUT is the simplest path — Drive's resumable URL accepts the whole body.
  // (Chunking with Content-Range would be needed for very large uploads.)
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`Drive upload failed: ${putRes.status} ${errText}`);
  }
  const result = await putRes.json();

  // Drive returns minimal fields by default; build a webViewLink from the id.
  return {
    id: result.id,
    webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
  };
}

export default function PhaseTwo({ session, onSessionChange, recipients, profileId }) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [clipProgress, setClipProgress] = useState({}); // { [clipId]: 'waiting' | 'uploading' | 'done' | 'error' }

  const clips = (session.clips || []).filter(c => c.status === 'cut' || c.status === 'uploaded' || c.status === 'uploading');
  const shorts = clips.filter(c => c.type === 'short');
  const longs = clips.filter(c => c.type === 'long');


  async function handleUploadAll() {
    const toUpload = clips.filter(c => c.status === 'cut' && c.assignee && c._outputBlob);
    if (toUpload.length === 0) {
      alert('No clips ready to upload. Each clip needs to be cut, assigned, and have its cut output still in memory.');
      return;
    }

    // Confirm we have a fresh user session to authorize the edge function call
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const accessToken = authSession?.access_token;
    if (!accessToken) {
      alert('Not signed in. Refresh the page and sign in again.');
      return;
    }

    const uploadStartedAt = new Date().toISOString();

    setUploading(true);
    setUploadProgress({ done: 0, total: toUpload.length });

    const initialProgress = {};
    toUpload.forEach(c => { initialProgress[c.id] = 'waiting'; });
    setClipProgress(initialProgress);

    // Mark all as uploading in session
    let allClips = session.clips.map(c =>
      toUpload.find(u => u.id === c.id) ? { ...c, status: 'uploading' } : c,
    );
    onSessionChange({ ...session, clips: allClips });

    let doneCount = 0;
    for (const clip of toUpload) {
      setClipProgress(prev => ({ ...prev, [clip.id]: 'uploading' }));
      const recipient = recipients.find(r => r.id === clip.assignee);
      const folderId = clip.driveFolderId || recipient?.driveFolderId || '';

      try {
        const result = await uploadClipToDrive(clip, folderId, accessToken);
        setClipProgress(prev => ({ ...prev, [clip.id]: 'done' }));
        allClips = allClips.map(c => c.id === clip.id ? {
          ...c,
          status: 'uploaded',
          driveLink: result.webViewLink,
          driveFileId: result.id,
        } : c);
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

    // Log the upload job (fire-and-forget)
    try {
      const successCount = toUpload.filter(c => allClips.find(ac => ac.id === c.id)?.status === 'uploaded').length;
      const failCount = toUpload.length - successCount;
      const recipientNames = [...new Set(
        toUpload
          .map(c => recipients.find(r => r.id === c.assignee)?.name)
          .filter(Boolean)
      )];
      const errorTitles = toUpload
        .filter(c => allClips.find(ac => ac.id === c.id)?.status !== 'uploaded')
        .map(c => c.title);
      const jobStatus = failCount === 0 ? 'completed' : successCount === 0 ? 'failed' : 'partial';

      if (profileId) {
        await supabase.from('clipping_job_logs').insert({
          created_by: profileId,
          source_filename: session.sourceFileName || '',
          video_title: session.sourceFileName?.replace(/\.[^.]+$/, '') || '',
          total_clips: toUpload.length,
          successful_clips: successCount,
          failed_clips: failCount,
          recipients: recipientNames,
          status: jobStatus,
          error_output: errorTitles.length > 0 ? `Failed clips: ${errorTitles.join(', ')}` : null,
          started_at: uploadStartedAt,
          completed_at: new Date().toISOString(),
        });
      }
    } catch (logErr) {
      console.error('Failed to log clipping job:', logErr);
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
                    <span style={{ ...st.cell, flex: 1.5, color: clip.assignee ? '#e2e8f0' : 'rgba(255,255,255,0.3)', fontSize: '13px' }}>
                      {recipient?.name || (clip.assignee ? clip.assignee : '—')}
                    </span>
                    <span style={{ ...st.cell, color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>
                      {recipient?.driveFolderName || (recipient?.driveFolderId ? '(folder)' : '—')}
                    </span>
                  </div>
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

  const uploadableCount = clips.filter(c => c.status === 'cut' && c.assignee && c._outputBlob).length;
  const missingBlobCount = clips.filter(c => c.status === 'cut' && !c._outputBlob).length;

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
          {missingBlobCount > 0 && (
            <div style={st.warnBox}>
              {missingBlobCount} clip{missingBlobCount !== 1 ? 's' : ''} marked as cut but no longer in memory. Re-cut to upload.
            </div>
          )}
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
  warnBox: {
    padding: '10px 14px', background: 'rgba(245,158,11,0.08)',
    border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px',
    color: '#f59e0b', fontSize: '13px',
  },
  emptyState: {
    padding: '40px', textAlign: 'center',
    border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '10px',
  },
  emptyText: { fontSize: '13px', color: 'rgba(255,255,255,0.3)', margin: 0 },
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
