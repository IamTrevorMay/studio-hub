import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

const TIMELINE_SERVICE_URL = 'http://localhost:8420';
const DRIVE_UPLOAD_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/drive-upload-init`;

const WHISPER_MODELS = [
  { value: 'base', label: 'Base (fastest)' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium (recommended)' },
  { value: 'large-v3', label: 'Large v3 (most accurate)' },
];

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Timeline() {
  const { profile } = useAuth();

  // Step state
  const [step, setStep] = useState('setup'); // setup | processing | done

  // Setup state
  const [sheets, setSheets] = useState([]);
  const [selectedSheetId, setSelectedSheetId] = useState('');
  const [videoPaths, setVideoPaths] = useState(['']); // array of file paths
  const [whisperModel, setWhisperModel] = useState('medium');
  const [serviceOnline, setServiceOnline] = useState(null);

  // Processing state
  const [processStatus, setProcessStatus] = useState('');
  const [processProgress, setProcessProgress] = useState(0);

  // Done state
  const [doneInfo, setDoneInfo] = useState(null);
  // { sourceFilename, matched, total, unmatched, multiTakeCount, fileCount, driveUploaded }

  // ─── Fetch beat sheets ──────────────────────────────────────────────────────
  const fetchSheets = useCallback(async () => {
    const { data } = await supabase
      .from('beat_sheets')
      .select('id, title, beats, drive_folder_id, updated_at')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false });
    setSheets(data || []);
  }, []);

  useEffect(() => { fetchSheets(); }, [fetchSheets]);

  // ─── Check service health ──────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    async function check() {
      try {
        const res = await fetch(`${TIMELINE_SERVICE_URL}/health`);
        if (mounted) setServiceOnline(res.ok);
      } catch {
        if (mounted) setServiceOnline(false);
      }
    }
    check();
    const interval = setInterval(check, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // ─── Multi-file path management ────────────────────────────────────────────
  function addPathField() {
    setVideoPaths(prev => [...prev, '']);
  }
  function updatePath(index, value) {
    setVideoPaths(prev => prev.map((p, i) => i === index ? value : p));
  }
  function removePath(index) {
    setVideoPaths(prev => prev.filter((_, i) => i !== index));
  }
  function movePathUp(index) {
    if (index === 0) return;
    setVideoPaths(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }
  function movePathDown(index) {
    setVideoPaths(prev => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  const validPaths = videoPaths.filter(p => p.trim());

  // ─── Drive upload helper ───────────────────────────────────────────────────
  async function uploadAAFToDrive(blob, filename, folderId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return false;

      const initRes = await fetch(DRIVE_UPLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename,
          parentFolderId: folderId,
          mimeType: 'application/octet-stream',
          sizeBytes: blob.size,
        }),
      });

      if (!initRes.ok) return false;
      const { uploadUrl } = await initRes.json();

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': blob.size.toString(),
        },
        body: blob,
      });

      return putRes.ok;
    } catch (e) {
      console.error('Drive upload failed:', e);
      return false;
    }
  }

  // ─── Process: send file paths to local service ─────────────────────────────
  async function handleProcess() {
    const sheet = sheets.find(s => s.id === selectedSheetId);
    if (!sheet || !validPaths.length) return;

    setStep('processing');
    setProcessProgress(10);

    const fileCount = validPaths.length;
    if (fileCount > 1) {
      setProcessStatus(`Concatenating ${fileCount} video files...`);
    } else {
      setProcessStatus('Starting Whisper transcription...');
    }

    const beatSheet = {
      id: sheet.id,
      title: sheet.title,
      beats: (sheet.beats || []).map(b => ({
        id: b.id,
        title: b.title || '',
        context: b.context || '',
        videos: b.videos || [],
        graphics: b.graphics || [],
        notes: b.notes || '',
      })),
    };

    try {
      setProcessProgress(20);
      setProcessStatus('Transcribing audio with Whisper (this takes 2-3 min for a 20 min video)...');

      const res = await fetch(`${TIMELINE_SERVICE_URL}/process-steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_paths: validPaths,
          beat_sheet: beatSheet,
          whisper_model: whisperModel,
          use_llm_fallback: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || `Service error ${res.status}`);
      }

      setProcessProgress(80);
      setProcessStatus('Aligning beats to transcript...');

      const data = await res.json();

      const aligned = data.alignment.aligned_beats;
      const unmatched = data.alignment.unmatched_beat_ids;
      const matched = aligned.length - unmatched.length;

      setProcessProgress(90);
      setProcessStatus(`Aligned ${matched}/${aligned.length} beats. Generating AAF...`);

      // Generate AAF
      const aafRes = await fetch(`${TIMELINE_SERVICE_URL}/generate-aaf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aligned_beats: aligned.filter(b => b.confidence > 0 || b.manual),
          source_filename: data.source_filename,
          duration_s: data.duration_s,
          frame_rate: '29.97',
        }),
      });

      if (!aafRes.ok) throw new Error(`AAF generation failed: ${aafRes.status}`);

      const blob = await aafRes.blob();
      const fname = data.source_filename.replace(/\.[^.]+$/, '');
      const aafFilename = `${fname}_timeline.aaf`;

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = aafFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Drive upload (if beat sheet has a drive folder)
      let driveUploaded = false;
      const driveFolderId = sheet.drive_folder_id;
      if (driveFolderId) {
        setProcessProgress(95);
        setProcessStatus('Uploading AAF to Google Drive...');
        driveUploaded = await uploadAAFToDrive(blob, aafFilename, driveFolderId);
      }

      setProcessProgress(100);
      setDoneInfo({
        sourceFilename: data.source_filename,
        matched,
        total: aligned.length,
        unmatched: unmatched.length,
        multiTakeCount: data.multi_take_count || 0,
        fileCount: data.file_count || 1,
        driveUploaded,
      });
      setStep('done');
    } catch (err) {
      console.error('Process error:', err);
      setProcessStatus(`Error: ${err.message}`);
      setProcessProgress(0);
      setTimeout(() => setStep('setup'), 5000);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const selectedSheet = sheets.find(s => s.id === selectedSheetId);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Timeline</h1>
        <div style={styles.headerRight}>
          <div style={{
            ...styles.serviceIndicator,
            background: serviceOnline === null ? 'rgba(255,255,255,0.2)' :
              serviceOnline ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: serviceOnline === null ? '#888' : serviceOnline ? '#22c55e' : '#ef4444',
            }} />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
              {serviceOnline === null ? 'Checking...' : serviceOnline ? 'Service Online' : 'Service Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* Setup Step */}
      {step === 'setup' && (
        <div style={styles.setupContainer}>
          {/* Beat Sheet Selector */}
          <div style={styles.field}>
            <label style={styles.label}>Beat Sheet</label>
            <select
              style={styles.select}
              value={selectedSheetId}
              onChange={e => setSelectedSheetId(e.target.value)}
            >
              <option value="">Select a beat sheet...</option>
              {sheets.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title} ({(s.beats || []).length} beats)
                </option>
              ))}
            </select>
          </div>

          {/* Video File Paths (multi-file) */}
          <div style={styles.field}>
            <label style={styles.label}>
              Source Video{videoPaths.length > 1 ? 's' : ''} ({validPaths.length} file{validPaths.length !== 1 ? 's' : ''})
            </label>
            {videoPaths.map((p, i) => (
              <div key={i} style={styles.pathRow}>
                {videoPaths.length > 1 && (
                  <div style={styles.pathOrder}>
                    <button
                      style={styles.orderBtn}
                      onClick={() => movePathUp(i)}
                      disabled={i === 0}
                    >&#9650;</button>
                    <span style={styles.orderNum}>{i + 1}</span>
                    <button
                      style={styles.orderBtn}
                      onClick={() => movePathDown(i)}
                      disabled={i === videoPaths.length - 1}
                    >&#9660;</button>
                  </div>
                )}
                <input
                  type="text"
                  style={{ ...styles.select, flex: 1 }}
                  placeholder={i === 0
                    ? "Paste file path, e.g. /Users/trevor/Desktop/recording.mp4"
                    : "Additional video file path..."
                  }
                  value={p}
                  onChange={e => updatePath(i, e.target.value)}
                />
                {videoPaths.length > 1 && (
                  <button
                    style={styles.removePathBtn}
                    onClick={() => removePath(i)}
                  >&times;</button>
                )}
              </div>
            ))}
            <button style={styles.addPathBtn} onClick={addPathField}>
              + Add another video file
            </button>
            {videoPaths.length > 1 && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                Files will be concatenated in the order shown above.
                Use arrows to reorder.
              </div>
            )}
          </div>

          {/* Whisper Model */}
          <div style={styles.field}>
            <label style={styles.label}>Whisper Model</label>
            <select
              style={styles.select}
              value={whisperModel}
              onChange={e => setWhisperModel(e.target.value)}
            >
              {WHISPER_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Beat Preview */}
          {selectedSheet && (
            <div style={styles.beatPreview}>
              <div style={styles.previewHeader}>
                {selectedSheet.title} - {(selectedSheet.beats || []).length} beats
                {selectedSheet.drive_folder_id && (
                  <span style={styles.driveBadge}>Drive linked</span>
                )}
              </div>
              {(selectedSheet.beats || []).slice(0, 5).map((b, i) => (
                <div key={b.id || i} style={styles.previewBeat}>
                  <span style={styles.previewIndex}>{i + 1}</span>
                  <span style={styles.previewTitle}>{b.title}</span>
                  {(b.videos || []).length > 0 && (
                    <span style={styles.previewBroll}>
                      {(b.videos || []).length} b-roll
                    </span>
                  )}
                </div>
              ))}
              {(selectedSheet.beats || []).length > 5 && (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: '4px 0 0 28px' }}>
                  +{(selectedSheet.beats || []).length - 5} more...
                </div>
              )}
            </div>
          )}

          {/* Process Button */}
          <button
            style={{
              ...styles.processButton,
              opacity: (!selectedSheetId || !validPaths.length || !serviceOnline) ? 0.4 : 1,
            }}
            disabled={!selectedSheetId || !validPaths.length || !serviceOnline}
            onClick={handleProcess}
          >
            Process{validPaths.length > 1 ? ` (${validPaths.length} files)` : ''}
          </button>

          {(!selectedSheetId || !validPaths.length || !serviceOnline) && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
              Needs: {!selectedSheetId && 'beat sheet · '}{!validPaths.length && 'file path · '}{!serviceOnline && 'service online'}
            </div>
          )}

          {!serviceOnline && serviceOnline !== null && (
            <div style={styles.serviceWarning}>
              Timeline service is offline. Start it with: <code style={styles.code}>cd services/timeline && ./run.sh</code>
            </div>
          )}
        </div>
      )}

      {/* Processing Step */}
      {step === 'processing' && (
        <div style={styles.processingContainer}>
          <div style={styles.processingIcon}>&#9881;</div>
          <div style={styles.processingStatus}>{processStatus}</div>
          <div style={styles.progressBarOuter}>
            <div style={{ ...styles.progressBarInner, width: `${processProgress}%` }} />
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>
            This may take a few minutes depending on video length and model size.
          </div>
        </div>
      )}

      {/* Done Step */}
      {step === 'done' && doneInfo && (
        <div style={styles.doneContainer}>
          <div style={styles.doneIcon}>&#10003;</div>
          <div style={styles.doneTitle}>AAF Downloaded</div>
          <div style={styles.doneSummary}>
            {doneInfo.sourceFilename}
            {doneInfo.fileCount > 1 && ` (+${doneInfo.fileCount - 1} more)`}
            {' — '}
            {doneInfo.matched}/{doneInfo.total} beats aligned
            {doneInfo.unmatched > 0 && ` (${doneInfo.unmatched} unmatched)`}
          </div>

          {doneInfo.multiTakeCount > 0 && (
            <div style={styles.doneDetail}>
              {doneInfo.multiTakeCount} beat{doneInfo.multiTakeCount > 1 ? 's' : ''} had multiple takes — using last take for each
            </div>
          )}

          {doneInfo.driveUploaded && (
            <div style={{ ...styles.doneDetail, color: '#22c55e' }}>
              AAF uploaded to Google Drive
            </div>
          )}

          <button
            style={{ ...styles.processButton, marginTop: 8 }}
            onClick={() => {
              setStep('setup');
              setDoneInfo(null);
              setProcessProgress(0);
              setProcessStatus('');
            }}
          >
            Process Another
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = {
  container: {
    minHeight: '100vh',
    background: '#0f0f1a',
    color: '#fff',
    fontFamily: "'DM Sans', sans-serif",
    padding: '24px 32px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    margin: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  serviceIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    borderRadius: 8,
  },

  // Setup
  setupContainer: {
    maxWidth: 600,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    boxSizing: 'border-box',
  },

  // Multi-file paths
  pathRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  pathOrder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
    width: 28,
    flexShrink: 0,
  },
  orderBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
  orderNum: {
    fontSize: 11,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
  },
  removePathBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 4px',
    flexShrink: 0,
  },
  addPathBtn: {
    background: 'none',
    border: '1px dashed rgba(255,255,255,0.15)',
    borderRadius: 8,
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    padding: '8px 16px',
    cursor: 'pointer',
    width: '100%',
    fontFamily: "'DM Sans', sans-serif",
    marginTop: 4,
  },

  beatPreview: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: '12px 16px',
    marginBottom: 20,
  },
  previewHeader: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  driveBadge: {
    fontSize: 10,
    background: 'rgba(99,102,241,0.2)',
    color: '#818cf8',
    padding: '2px 6px',
    borderRadius: 4,
    fontWeight: 500,
  },
  previewBeat: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0',
    fontSize: 13,
  },
  previewIndex: {
    width: 20,
    textAlign: 'right',
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    fontWeight: 600,
  },
  previewTitle: {
    flex: 1,
    color: 'rgba(255,255,255,0.8)',
  },
  previewBroll: {
    fontSize: 11,
    color: '#6366f1',
    background: 'rgba(99,102,241,0.15)',
    padding: '2px 8px',
    borderRadius: 4,
  },
  processButton: {
    width: '100%',
    padding: '12px 24px',
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  serviceWarning: {
    marginTop: 12,
    padding: '10px 14px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 8,
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  code: {
    background: 'rgba(255,255,255,0.1)',
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'monospace',
  },

  // Processing
  processingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 16,
  },
  processingIcon: {
    fontSize: 48,
  },
  processingStatus: {
    fontSize: 16,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.8)',
  },
  progressBarOuter: {
    width: 320,
    height: 6,
    background: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    background: '#6366f1',
    borderRadius: 3,
    transition: 'width 0.5s ease',
  },

  // Done
  doneContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
    maxWidth: 440,
    margin: '0 auto',
  },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'rgba(34,197,94,0.15)',
    color: '#22c55e',
    fontSize: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitle: {
    fontSize: 20,
    fontWeight: 700,
  },
  doneSummary: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
  },
  doneDetail: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
  },
};
