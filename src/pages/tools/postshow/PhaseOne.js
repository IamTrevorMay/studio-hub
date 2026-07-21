import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createClip, isClipReady, isValidTimestamp, formatTimestamp, parseTimestamp, CLIP_TYPES, OUTPUT_FORMATS, STATUS_COLORS, STATUS_LABELS } from './postShowConstants';

// ─── ffmpeg.wasm singleton ──────────────────────────────────────────────
// Single-threaded build: no SharedArrayBuffer required, so no Vercel COOP/COEP
// header changes. Slower than the multi-threaded build but plenty for short-form
// social clips. Loaded lazily on first cut.
const CLIP_COLORS = ['#f97316', '#eab308', '#3b82f6', '#ef4444', '#22c55e', '#ec4899', '#8b5cf6', '#06b6d4'];

let ffmpegInstance = null;
let ffmpegLoadPromise = null;

async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ff = new FFmpeg();
    await ff.load();
    ffmpegInstance = ff;
    return ff;
  })();
  return ffmpegLoadPromise;
}

// Read a File or Blob into a Uint8Array. We use FileReader instead of
// fetchFile from @ffmpeg/util because fetchFile uses fetch() under the hood,
// which is overkill for an already-local Blob and doesn't add chunking.
function readFileAsUint8(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// ─── Clip Row ───────────────────────────────────────────────────────────
function ClipRow({ clip, index, onChange, onRemove, onPreview, onDownload, recipients }) {
  const update = (field, value) => {
    if (field === 'assignee') {
      const recipient = recipients.find(r => r.id === value);
      onChange(index, {
        ...clip,
        assignee: value,
        driveFolderId: recipient?.driveFolderId || '',
        driveFolderName: recipient?.driveFolderName || '',
      });
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
        {clip.status && clip.status !== 'pending' && (
          <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: (STATUS_COLORS[clip.status] || '#666') + '22', color: STATUS_COLORS[clip.status] || '#666' }}>
            {STATUS_LABELS[clip.status] || clip.status}
          </span>
        )}
        {isClipReady(clip) && (
          <button style={st.iconBtn} title="Preview in player" onClick={() => onPreview(clip)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </button>
        )}
        {clip._outputUrl && (
          <button style={st.iconBtn} title="Download cut" onClick={() => onDownload(clip)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
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

// ─── Clip Timeline ─────────────────────────────────────────────────────
function ClipTimeline({ clips, duration, videoRef }) {
  if (!duration) return null;
  const markers = clips
    .map((c, i) => {
      const startSec = parseTimestamp(c.startTime);
      const endSec = parseTimestamp(c.endTime);
      if (startSec == null || endSec == null) return null;
      return { index: i, startPct: (startSec / duration) * 100, endPct: (endSec / duration) * 100, color: CLIP_COLORS[i % CLIP_COLORS.length] };
    })
    .filter(Boolean);

  const handleClick = (e) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = Math.max(0, Math.min(pct * duration, duration));
  };

  return (
    <div style={st.timelineTrack} onClick={handleClick}>
      {markers.map((m) => (
        <React.Fragment key={m.index}>
          <div style={{ ...st.timelineRegion, left: m.startPct + '%', width: (m.endPct - m.startPct) + '%', background: m.color + '30' }} />
          <div style={{ ...st.timelineMarker, left: m.startPct + '%', background: m.color }} />
          <div style={{ ...st.timelineMarker, left: m.endPct + '%', background: m.color }} />
          <div style={{ ...st.timelineLabel, left: m.startPct + '%', color: m.color }}>{m.index + 1}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Phase One Component ────────────────────────────────────────────────
export default function PhaseOne({ session, onSessionChange, recipients, settings, onSettingsChange }) {
  const [cutting, setCutting] = useState(false);
  const [cutProgress, setCutProgress] = useState(null); // { done, total, current }
  const [previewClip, setPreviewClip] = useState(null);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  const clips = session.clips || [];
  const sourceFile = session.sourceFileName;
  const framePerfect = settings.framePerfect !== false;

  // Revoke object URLs on unmount so we don't leak memory. The source + clip URLs
  // are minted AFTER mount (file select / ffmpeg export) on new session objects,
  // so a []-dep cleanup capturing the mount-time session revoked nothing — leaking
  // multi-GB video Blobs. Read the latest session from a ref instead.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    return () => {
      const s = sessionRef.current;
      if (s?._sourceObjectUrl) URL.revokeObjectURL(s._sourceObjectUrl);
      (s?.clips || []).forEach(c => { if (c._outputUrl) URL.revokeObjectURL(c._outputUrl); });
    };
  }, []);

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
    // Revoke any prior source URL + clip URLs since the source is changing
    if (session._sourceObjectUrl) URL.revokeObjectURL(session._sourceObjectUrl);
    (session.clips || []).forEach(c => { if (c._outputUrl) URL.revokeObjectURL(c._outputUrl); });

    onSessionChange({
      ...session,
      sourceFileName: file.name,
      _sourceObjectUrl: URL.createObjectURL(file),
      _sourceFile: file,
      // Reset clip output state — old cuts pointed at the old source
      clips: (session.clips || []).map(c => ({
        ...c,
        status: c.status === 'cut' || c.status === 'uploaded' || c.status === 'synced' ? 'pending' : c.status,
        _outputBlob: undefined,
        _outputUrl: undefined,
      })),
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
    const c = clips[index];
    if (c?._outputUrl) URL.revokeObjectURL(c._outputUrl);
    updateClips(clips.filter((_, i) => i !== index));
  }

  // ── Set timestamp from video player ──
  function markTime(field) {
    if (!videoRef.current) return;
    const seconds = Math.floor(videoRef.current.currentTime);
    const ts = formatTimestamp(seconds);
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

  // ── Download cut clip ──
  function handleDownloadClip(clip) {
    if (!clip._outputUrl) return;
    const a = document.createElement('a');
    a.href = clip._outputUrl;
    a.download = `${clip.title.replace(/[^\w-]+/g, '_') || 'clip'}.${clip.outputFormat || 'mp4'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ── Batch cut via ffmpeg.wasm ──
  async function handleBatchCut() {
    const readyClips = clips.filter(isClipReady);
    if (readyClips.length === 0) {
      alert('No clips are ready to cut. Make sure each clip has a title and valid in/out timestamps.');
      return;
    }
    if (!session._sourceFile) {
      alert('Source file is not loaded in memory. Re-select the source file before cutting.');
      return;
    }

    setCutting(true);
    setCutProgress({ done: 0, total: readyClips.length, current: 'Loading ffmpeg…' });

    try {
      setFfmpegLoading(true);
      const ffmpeg = await getFFmpeg();
      setFfmpegLoading(false);

      // Write the source into ffmpeg's virtual FS once for the whole batch
      setCutProgress({ done: 0, total: readyClips.length, current: 'Reading source…' });
      let sourceBytes;
      try {
        sourceBytes = await readFileAsUint8(session._sourceFile);
      } catch (readErr) {
        alert('The source file can no longer be read — the browser lost its handle.\n\nPlease re-select the file using the "Change File" button and try again.');
        return;
      }
      const ext = (session._sourceFile.name.split('.').pop() || 'mp4').toLowerCase();
      const inputName = `input.${ext}`;
      await ffmpeg.writeFile(inputName, sourceBytes);

      let done = 0;
      for (const clip of readyClips) {
        const start = parseTimestamp(clip.startTime);
        const end = parseTimestamp(clip.endTime);
        const outName = `out_${clip.id}.${clip.outputFormat || 'mp4'}`;
        const outMime = clip.outputFormat === 'mov' ? 'video/quicktime' : 'video/mp4';

        setCutProgress({ done, total: readyClips.length, current: `Cutting "${clip.title}"…` });
        // Mark in-progress
        onSessionChange(prev => ({
          ...prev,
          clips: prev.clips.map(c => c.id === clip.id ? { ...c, status: 'cutting' } : c),
        }));

        // Frame-perfect: re-encode H.264 + AAC. Fast: stream copy (snaps to I-frames).
        const args = framePerfect
          ? [
              '-ss', String(start),
              '-to', String(end),
              '-i', inputName,
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-preset', 'ultrafast',
              '-movflags', '+faststart',
              outName,
            ]
          : [
              '-ss', String(start),
              '-to', String(end),
              '-i', inputName,
              '-c', 'copy',
              outName,
            ];

        try {
          await ffmpeg.exec(args);
          const data = await ffmpeg.readFile(outName);
          // ffmpeg.wasm returns either a Uint8Array or an object with .buffer
          const blob = new Blob([data instanceof Uint8Array ? data : data.buffer], { type: outMime });
          const url = URL.createObjectURL(blob);

          onSessionChange(prev => ({
            ...prev,
            clips: prev.clips.map(c => c.id === clip.id ? {
              ...c,
              status: 'cut',
              _outputBlob: blob,
              _outputUrl: url,
            } : c),
          }));

          // Clean up the per-clip output from ffmpeg's FS so memory doesn't grow unbounded
          try { await ffmpeg.deleteFile(outName); } catch (e) { /* ignore */ }
        } catch (clipErr) {
          console.error(`Cut failed for clip "${clip.title}":`, clipErr);
          onSessionChange(prev => ({
            ...prev,
            clips: prev.clips.map(c => c.id === clip.id ? { ...c, status: 'error' } : c),
          }));
        }

        done++;
        setCutProgress({ done, total: readyClips.length, current: done === readyClips.length ? 'Complete' : '' });
      }

      // Source out of ffmpeg's FS too
      try { await ffmpeg.deleteFile(inputName); } catch (e) { /* ignore */ }
    } catch (err) {
      console.error('Batch cut error:', err);
      alert(`Cut failed: ${err.message || err}`);
    } finally {
      setCutting(false);
      setFfmpegLoading(false);
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
            {!session._sourceObjectUrl && (
              <span style={st.fileWarn}>(reload the file — it's not in memory)</span>
            )}
          </div>
        )}

        {session._sourceObjectUrl && (
          <div style={st.playerWrapper}>
            <video
              ref={videoRef}
              src={session._sourceObjectUrl}
              controls
              style={st.videoPlayer}
              onLoadedMetadata={() => {
                if (videoRef.current) setDuration(videoRef.current.duration || 0);
              }}
              onTimeUpdate={() => {
                if (previewClip && videoRef.current) {
                  const endSec = parseTimestamp(previewClip.endTime);
                  if (endSec != null && videoRef.current.currentTime >= endSec) {
                    videoRef.current.pause();
                    setPreviewClip(null);
                  }
                }
              }}
            />
            <ClipTimeline clips={clips} duration={duration} videoRef={videoRef} />
            <div style={st.markBtns}>
              <button style={st.markBtn} onClick={() => markTime('startTime')}>Mark In</button>
              <button style={st.markBtn} onClick={() => markTime('endTime')}>Mark Out</button>
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
                onDownload={handleDownloadClip}
                recipients={recipients}
              />
            ))}
          </div>
        )}
      </div>

      {/* Batch cut action */}
      {clips.length > 0 && (
        <div style={st.actionBar}>
          <label style={st.precisionToggle}>
            <input
              type="checkbox"
              checked={framePerfect}
              onChange={e => onSettingsChange({ ...settings, framePerfect: e.target.checked })}
              style={st.checkbox}
            />
            Frame-perfect (slower)
          </label>
          <span style={st.readyLabel}>
            {readyCount} of {clips.length} clip{clips.length !== 1 ? 's' : ''} ready
          </span>
          {cutProgress && (
            <span style={st.progressLabel}>
              {ffmpegLoading
                ? 'Loading ffmpeg…'
                : `${cutProgress.done}/${cutProgress.total} cut${cutProgress.current ? ` · ${cutProgress.current}` : ''}`}
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
  fileWarn: { color: '#f59e0b', fontSize: '12px' },
  playerWrapper: { display: 'flex', flexDirection: 'column', gap: '8px' },
  videoPlayer: { width: '100%', maxHeight: '360px', borderRadius: '8px', background: '#000' },
  timelineTrack: {
    position: 'relative', width: '100%', height: '8px', background: 'rgba(255,255,255,0.06)',
    borderRadius: '4px', cursor: 'pointer', overflow: 'visible',
  },
  timelineRegion: { position: 'absolute', top: 0, height: '100%', borderRadius: '4px' },
  timelineMarker: { position: 'absolute', top: '-6px', width: '2px', height: '14px', borderRadius: '1px' },
  timelineLabel: { position: 'absolute', top: '-20px', fontSize: '10px', fontWeight: 700, transform: 'translateX(-50%)', pointerEvents: 'none' },
  markBtns: { display: 'flex', gap: '8px' },
  markBtn: {
    padding: '6px 16px', fontSize: '12px', fontWeight: 600, color: '#e2e8f0',
    background: 'rgba(91, 143, 199,0.15)', border: '1px solid rgba(91, 143, 199,0.3)',
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
  checkbox: { accentColor: '#5b8fc7' },
  iconBtn: {
    padding: '4px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  },
  removeBtn: {
    padding: '4px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: '#ef4444', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', opacity: 0.6,
  },
  primaryBtn: {
    padding: '7px 16px', fontSize: '13px', fontWeight: 600, color: '#fff',
    background: '#5b8fc7', border: 'none', borderRadius: '8px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  disabledBtn: { opacity: 0.4, cursor: 'not-allowed' },
  actionBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px',
    padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  precisionToggle: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', marginRight: 'auto' },
  readyLabel: { fontSize: '13px', color: 'rgba(255,255,255,0.4)' },
  progressLabel: { fontSize: '12px', color: '#f59e0b' },
  emptyState: {
    padding: '40px', textAlign: 'center',
    border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '10px',
  },
  emptyText: { fontSize: '13px', color: 'rgba(255,255,255,0.3)', margin: 0 },
};
