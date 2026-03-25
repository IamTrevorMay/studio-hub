import React, { useState, useRef, useCallback } from 'react';
import { createClip, isClipReady, isValidTimestamp, formatTimestamp, parseTimestamp, CLIP_TYPES, OUTPUT_FORMATS } from './postShowConstants';

// ─── Clip Row ───────────────────────────────────────────────────────────
function ClipRow({ clip, index, onChange, onRemove, onPreview, recipients }) {
  const update = (field, value) => {
    if (field === 'assignee') {
      const recipient = recipients.find(r => r.id === value);
      onChange(index, { ...clip, assignee: value, driveFolder: recipient?.driveFolderPath || '' });
    } else {
      onChange(index, { ...clip, [field]: value });
    }
  };

  return (
    <div style={st.clipRow}>
      <div style={st.clipIndex}>{index + 1}</div>

      <div style={st.clipFields}>
        {/* Row 1: Title + Type */}
        <div style={st.fieldRow}>
          <input
            style={{ ...st.input, flex: 2 }}
            placeholder="Clip title"
            value={clip.title}
            onChange={e => update('title', e.target.value)}
          />
          <select style={st.select} value={clip.type} onChange={e => update('type', e.target.value)}>
            {CLIP_TYPES.map(t => <option key={t} value={t}>{t === 'short' ? 'Short' : 'Long'}</option>)}
          </select>
          <select style={st.select} value={clip.outputFormat} onChange={e => update('outputFormat', e.target.value)}>
            {OUTPUT_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </div>

        {/* Row 2: Timestamps + assignee */}
        <div style={st.fieldRow}>
          <div style={st.tsGroup}>
            <label style={st.tsLabel}>In</label>
            <input
              style={{ ...st.input, ...st.tsInput, ...(clip.startTime && !isValidTimestamp(clip.startTime) ? st.inputError : {}) }}
              placeholder="HH:MM:SS"
              value={clip.startTime}
              onChange={e => update('startTime', e.target.value)}
            />
          </div>
          <div style={st.tsGroup}>
            <label style={st.tsLabel}>Out</label>
            <input
              style={{ ...st.input, ...st.tsInput, ...(clip.endTime && !isValidTimestamp(clip.endTime) ? st.inputError : {}) }}
              placeholder="HH:MM:SS"
              value={clip.endTime}
              onChange={e => update('endTime', e.target.value)}
            />
          </div>
          {clip.startTime && clip.endTime && isValidTimestamp(clip.startTime) && isValidTimestamp(clip.endTime) && (
            <span style={st.duration}>
              {formatTimestamp(parseTimestamp(clip.endTime) - parseTimestamp(clip.startTime))}
            </span>
          )}
          <select
            style={{ ...st.select, flex: 1 }}
            value={clip.assignee}
            onChange={e => update('assignee', e.target.value)}
          >
            <option value="">Assign to...</option>
            {recipients.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        {/* Row 3: Metadata */}
        <div style={st.fieldRow}>
          <label style={st.checkLabel}>
            <input
              type="checkbox"
              checked={clip.timeSensitive}
              onChange={e => update('timeSensitive', e.target.checked)}
              style={st.checkbox}
            />
            Time-sensitive
          </label>
          {clip.timeSensitive && (
            <div style={st.tsGroup}>
              <label style={st.tsLabel}>Post by</label>
              <input
                type="date"
                style={{ ...st.input, ...st.dateInput }}
                value={clip.postByDate}
                onChange={e => update('postByDate', e.target.value)}
              />
            </div>
          )}
          <div style={st.tsGroup}>
            <label style={st.tsLabel}>Show date</label>
            <input
              type="date"
              style={{ ...st.input, ...st.dateInput }}
              value={clip.showDate}
              onChange={e => update('showDate', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={st.clipActions}>
        {isClipReady(clip) && (
          <button style={st.previewBtn} title="Preview in player" onClick={() => onPreview(clip)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </button>
        )}
        <button style={st.removeBtn} title="Remove clip" onClick={() => onRemove(index)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Phase One Component ────────────────────────────────────────────────
export default function PhaseOne({ session, onSessionChange, recipients, settings }) {
  const [cutting, setCutting] = useState(false);
  const [cutProgress, setCutProgress] = useState(null);
  const [previewClip, setPreviewClip] = useState(null);
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  const clips = session.clips || [];
  const sourceFile = session.sourceFileName;

  const updateClips = useCallback((newClips) => {
    onSessionChange({ ...session, clips: newClips });
  }, [session, onSessionChange]);

  // ── Source file selection ──
  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['mp4', 'mov'].includes(ext)) {
      alert('Please select an MP4 or MOV file.');
      return;
    }
    onSessionChange({
      ...session,
      sourceFileName: file.name,
      sourceFilePath: file.name, // Browser can't give full path; user references by name
      _sourceObjectUrl: URL.createObjectURL(file),
      _sourceFile: file,
    });
  }

  // ── Clip CRUD ──
  function addClip() {
    updateClips([...clips, createClip({ showDate: session.showDate })]);
  }

  function updateClip(index, updated) {
    const next = [...clips];
    next[index] = updated;
    updateClips(next);
  }

  function removeClip(index) {
    updateClips(clips.filter((_, i) => i !== index));
  }

  // ── Set timestamp from video player ──
  function markTime(field) {
    if (!videoRef.current) return;
    const seconds = Math.floor(videoRef.current.currentTime);
    const ts = formatTimestamp(seconds);
    // Apply to the last clip's field, or create one
    if (clips.length === 0) {
      updateClips([createClip({ [field]: ts, showDate: session.showDate })]);
    } else {
      const last = clips.length - 1;
      const updated = { ...clips[last], [field]: ts };
      updateClip(last, updated);
    }
  }

  // ── Preview clip in video player ──
  function handlePreviewClip(clip) {
    if (!videoRef.current || !session._sourceObjectUrl) return;
    const start = parseTimestamp(clip.startTime);
    if (start != null) {
      videoRef.current.currentTime = start;
      videoRef.current.play();
      setPreviewClip(clip);
    }
  }

  // ── Batch cut via local API ──
  async function handleBatchCut() {
    const readyClips = clips.filter(isClipReady);
    if (readyClips.length === 0) {
      alert('No clips are ready to cut. Make sure each clip has a title and valid in/out timestamps.');
      return;
    }
    setCutting(true);
    setCutProgress({ done: 0, total: readyClips.length, current: '' });

    try {
      const resp = await fetch(`${settings.apiBaseUrl}/api/videos/cut`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFile: session.sourceFilePath,
          clips: readyClips.map(c => ({
            id: c.id,
            title: c.title,
            startTime: c.startTime,
            endTime: c.endTime,
            type: c.type,
            outputFormat: c.outputFormat,
          })),
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err || 'Cut request failed');
      }

      const result = await resp.json();

      // Update clip statuses
      const statusMap = {};
      (result.results || []).forEach(r => {
        statusMap[r.id] = r.success ? 'cut' : 'error';
      });
      updateClips(clips.map(c => statusMap[c.id] ? { ...c, status: statusMap[c.id] } : c));
      setCutProgress({ done: readyClips.length, total: readyClips.length, current: 'Complete' });
    } catch (err) {
      console.error('Batch cut error:', err);
      alert(`Cut failed: ${err.message}\n\nMake sure the local API service is running at ${settings.apiBaseUrl}`);
    } finally {
      setCutting(false);
    }
  }

  const readyCount = clips.filter(isClipReady).length;
  const shorts = clips.filter(c => c.type === 'short');
  const longs = clips.filter(c => c.type === 'long');

  return (
    <div style={st.phase}>
      {/* Source file + video player */}
      <div style={st.sourceSection}>
        <div style={st.sourceHeader}>
          <h3 style={st.sectionTitle}>Source Recording</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <button style={st.primaryBtn} onClick={() => fileInputRef.current?.click()}>
            {sourceFile ? 'Change File' : 'Select File'}
          </button>
        </div>

        {sourceFile && (
          <div style={st.fileInfo}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span style={st.fileName}>{sourceFile}</span>
          </div>
        )}

        {session._sourceObjectUrl && (
          <div style={st.playerWrapper}>
            <video
              ref={videoRef}
              src={session._sourceObjectUrl}
              controls
              style={st.videoPlayer}
              onTimeUpdate={() => {
                // Stop playback at clip end if previewing
                if (previewClip && videoRef.current) {
                  const endSec = parseTimestamp(previewClip.endTime);
                  if (endSec != null && videoRef.current.currentTime >= endSec) {
                    videoRef.current.pause();
                    setPreviewClip(null);
                  }
                }
              }}
            />
            <div style={st.markBtns}>
              <button style={st.markBtn} onClick={() => markTime('startTime')}>
                Mark In
              </button>
              <button style={st.markBtn} onClick={() => markTime('endTime')}>
                Mark Out
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Show date */}
      <div style={st.fieldRow}>
        <div style={st.tsGroup}>
          <label style={st.tsLabel}>Show Date</label>
          <input
            type="date"
            style={{ ...st.input, ...st.dateInput }}
            value={session.showDate}
            onChange={e => onSessionChange({ ...session, showDate: e.target.value })}
          />
        </div>
      </div>

      {/* Clip list */}
      <div style={st.clipsSection}>
        <div style={st.clipsHeader}>
          <h3 style={st.sectionTitle}>
            Clips
            {clips.length > 0 && (
              <span style={st.clipCount}>
                {clips.length} clip{clips.length !== 1 ? 's' : ''} &middot; {shorts.length} short{shorts.length !== 1 ? 's' : ''} &middot; {longs.length} long{longs.length !== 1 ? 's' : ''}
              </span>
            )}
          </h3>
          <button style={st.primaryBtn} onClick={addClip}>+ Add Clip</button>
        </div>

        {clips.length === 0 ? (
          <div style={st.emptyState}>
            <p style={st.emptyText}>No clips yet. Load a source file and add clips with in/out timestamps.</p>
          </div>
        ) : (
          <div style={st.clipList}>
            {clips.map((clip, i) => (
              <ClipRow
                key={clip.id}
                clip={clip}
                index={i}
                onChange={updateClip}
                onRemove={removeClip}
                onPreview={handlePreviewClip}
                recipients={recipients}
              />
            ))}
          </div>
        )}
      </div>

      {/* Batch cut action */}
      {clips.length > 0 && (
        <div style={st.actionBar}>
          <span style={st.readyLabel}>
            {readyCount} of {clips.length} clip{clips.length !== 1 ? 's' : ''} ready
          </span>
          {cutProgress && (
            <span style={st.progressLabel}>
              {cutProgress.done}/{cutProgress.total} cut &middot; {cutProgress.current}
            </span>
          )}
          <button
            style={{ ...st.primaryBtn, ...(readyCount === 0 || cutting ? st.disabledBtn : {}) }}
            onClick={handleBatchCut}
            disabled={readyCount === 0 || cutting}
          >
            {cutting ? 'Cutting...' : `Cut ${readyCount} Clip${readyCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const st = {
  phase: { display: 'flex', flexDirection: 'column', gap: '24px' },
  sourceSection: { display: 'flex', flexDirection: 'column', gap: '12px' },
  sourceHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: '15px', fontWeight: 700, color: '#e2e8f0', margin: 0 },
  fileInfo: { display: 'flex', alignItems: 'center', gap: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '13px' },
  fileName: { color: '#e2e8f0' },
  playerWrapper: { display: 'flex', flexDirection: 'column', gap: '8px' },
  videoPlayer: { width: '100%', maxHeight: '360px', borderRadius: '8px', background: '#000' },
  markBtns: { display: 'flex', gap: '8px' },
  markBtn: {
    padding: '6px 16px', fontSize: '12px', fontWeight: 600, color: '#e2e8f0',
    background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
  },
  clipsSection: { display: 'flex', flexDirection: 'column', gap: '12px' },
  clipsHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  clipCount: { fontSize: '12px', fontWeight: 400, color: 'rgba(255,255,255,0.4)', marginLeft: '10px' },
  clipList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  clipRow: {
    display: 'flex', alignItems: 'flex-start', gap: '12px',
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px', padding: '14px',
  },
  clipIndex: {
    fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.25)',
    width: '24px', textAlign: 'center', paddingTop: '6px', flexShrink: 0,
  },
  clipFields: { flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' },
  clipActions: { display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '4px' },
  fieldRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  input: {
    padding: '6px 10px', fontSize: '13px', color: '#e2e8f0',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', outline: 'none', fontFamily: 'inherit',
  },
  inputError: { borderColor: '#ef4444' },
  select: {
    padding: '6px 10px', fontSize: '13px', color: '#e2e8f0',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
  },
  tsGroup: { display: 'flex', alignItems: 'center', gap: '4px' },
  tsLabel: { fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  tsInput: { width: '90px', fontFamily: 'monospace' },
  dateInput: { width: '140px' },
  duration: { fontSize: '12px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' },
  checkbox: { accentColor: '#6366f1' },
  previewBtn: {
    padding: '4px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  },
  removeBtn: {
    padding: '4px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: '#ef4444', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', opacity: 0.6,
  },
  primaryBtn: {
    padding: '7px 16px', fontSize: '13px', fontWeight: 600, color: '#fff',
    background: '#6366f1', border: 'none', borderRadius: '8px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  disabledBtn: { opacity: 0.4, cursor: 'not-allowed' },
  actionBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px',
    padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  readyLabel: { fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginRight: 'auto' },
  progressLabel: { fontSize: '12px', color: '#f59e0b' },
  emptyState: {
    padding: '40px', textAlign: 'center',
    border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '10px',
  },
  emptyText: { fontSize: '13px', color: 'rgba(255,255,255,0.3)', margin: 0 },
};
