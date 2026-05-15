import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

const TIMELINE_SERVICE_URL = 'http://localhost:8420';

const CONFIDENCE_COLORS = {
  high:   'rgba(34, 197, 94, 0.85)',
  medium: 'rgba(234, 179, 8, 0.85)',
  low:    'rgba(249, 115, 22, 0.85)',
  manual: 'rgba(239, 68, 68, 0.85)',
  unmatched: 'rgba(239, 68, 68, 0.5)',
};

const WHISPER_MODELS = [
  { value: 'base', label: 'Base (fastest)' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium (recommended)' },
  { value: 'large-v3', label: 'Large v3 (most accurate)' },
];

function formatTimecode(seconds) {
  if (!seconds || seconds <= 0) return '--:--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 30);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

function confidenceTier(beat) {
  if (beat.manual) return 'manual';
  if (beat.confidence >= 0.8) return 'high';
  if (beat.confidence >= 0.5) return 'medium';
  if (beat.confidence > 0) return 'low';
  return 'unmatched';
}

function confidenceLabel(tier) {
  return { high: 'High', medium: 'Med', low: 'Low', manual: 'Manual', unmatched: 'Unmatched' }[tier];
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Timeline() {
  const { profile, isAdmin, isAssistant } = useAuth();

  // Step state
  const [step, setStep] = useState('setup'); // setup | processing | review | exporting | done

  // Setup state
  const [sheets, setSheets] = useState([]);
  const [selectedSheetId, setSelectedSheetId] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [videoPath, setVideoPath] = useState('');
  const [whisperModel, setWhisperModel] = useState('medium');
  const [serviceOnline, setServiceOnline] = useState(null);

  // Processing state
  const [processStatus, setProcessStatus] = useState('');
  const [processProgress, setProcessProgress] = useState(0);

  // Review state
  const [alignedBeats, setAlignedBeats] = useState([]);
  const [unmatchedIds, setUnmatchedIds] = useState([]);
  const [transcript, setTranscript] = useState(null);
  const [duration, setDuration] = useState(0);
  const [sourceFilename, setSourceFilename] = useState('');
  const [placingBeatId, setPlacingBeatId] = useState(null);

  // Video preview
  const videoRef = useRef(null);
  const videoUrlRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);

  // ─── Fetch beat sheets ──────────────────────────────────────────────────────
  const fetchSheets = useCallback(async () => {
    const { data } = await supabase
      .from('beat_sheets')
      .select('id, title, beats, updated_at')
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

  // ─── Set video preview URL from path (streamed via local service) ────────
  useEffect(() => {
    if (videoPath.trim()) {
      videoUrlRef.current = `${TIMELINE_SERVICE_URL}/video?path=${encodeURIComponent(videoPath.trim())}`;
    }
  }, [videoPath]);

  // ─── Handle file selection (for file picker preview) ──────────────────────
  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
  }

  // ─── Process: send file path to local service ──────────────────────────────
  async function handleProcess() {
    const sheet = sheets.find(s => s.id === selectedSheetId);
    if (!sheet || !videoPath.trim()) return;

    setStep('processing');
    setProcessStatus('Starting Whisper transcription...');
    setProcessProgress(15);

    // Build beat sheet payload matching the Python model
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

    // Send file path — service reads directly from disk (no upload needed)
    const filePath = videoPath;

    try {
      setProcessProgress(20);
      setProcessStatus('Transcribing audio with Whisper (this takes 2-3 min for a 20 min video)...');

      const res = await fetch(`${TIMELINE_SERVICE_URL}/process-steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: filePath,
          beat_sheet: beatSheet,
          whisper_model: whisperModel,
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

      // Auto-generate and download AAF
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fname = data.source_filename.replace(/\.[^.]+$/, '');
      a.href = url;
      a.download = `${fname}_timeline.aaf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setAlignedBeats(aligned);
      setUnmatchedIds(unmatched);
      setDuration(data.duration_s);
      setSourceFilename(data.source_filename);
      setProcessProgress(100);
      setProcessStatus(`Done! ${matched}/${aligned.length} beats aligned. AAF downloaded.`);
      setStep('done');
    } catch (err) {
      console.error('Process error:', err);
      setProcessStatus(`Error: ${err.message}`);
      setProcessProgress(0);
      setTimeout(() => setStep('setup'), 5000);
    }
  }

  // ─── Manual beat placement ─────────────────────────────────────────────────
  function handleTimelineClick(e) {
    if (!placingBeatId || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const tc = frac * duration;

    setAlignedBeats(prev => prev.map(b => {
      if (b.beat_id !== placingBeatId) return b;
      // Find the next beat's start for end_tc
      const idx = prev.findIndex(x => x.beat_id === placingBeatId);
      const nextMatched = prev.slice(idx + 1).find(x => x.confidence > 0 || x.manual);
      const endTc = nextMatched ? nextMatched.start_tc : Math.min(tc + 5, duration);
      return { ...b, start_tc: tc, end_tc: endTc, confidence: 1.0, manual: true };
    }));
    setUnmatchedIds(prev => prev.filter(id => id !== placingBeatId));
    setPlacingBeatId(null);
  }

  // ─── Export AAF ────────────────────────────────────────────────────────────
  async function handleExportAAF() {
    setStep('exporting');
    try {
      const res = await fetch(`${TIMELINE_SERVICE_URL}/generate-aaf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aligned_beats: alignedBeats.filter(b => b.confidence > 0 || b.manual),
          source_filename: sourceFilename,
          duration_s: duration,
          frame_rate: '29.97',
        }),
      });

      if (!res.ok) throw new Error(`Export failed: ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const name = sourceFilename.replace(/\.[^.]+$/, '');
      a.href = url;
      a.download = `${name}_timeline.aaf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStep('done');
    } catch (err) {
      console.error('Export error:', err);
      setStep('review');
    }
  }

  // ─── Seek video to beat ────────────────────────────────────────────────────
  function seekToBeat(beat) {
    if (videoRef.current && beat.start_tc > 0) {
      videoRef.current.currentTime = beat.start_tc;
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const selectedSheet = sheets.find(s => s.id === selectedSheetId);
  const matchedCount = alignedBeats.filter(b => b.confidence > 0 || b.manual).length;

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

          {/* Video File Path */}
          <div style={styles.field}>
            <label style={styles.label}>Source Video</label>
            <input
              type="text"
              style={styles.select}
              placeholder="Paste file path, e.g. /Users/trevor/Desktop/recording.mp4"
              value={videoPath}
              onChange={e => {
                setVideoPath(e.target.value);
                // Also set up video preview if path looks valid
                const p = e.target.value.trim();
                if (p && (p.endsWith('.mp4') || p.endsWith('.mov') || p.endsWith('.mkv'))) {
                  setVideoFile({ name: p.split('/').pop(), path: p });
                }
              }}
            />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
              Drag the file from Finder into this field, or right-click → Copy as Pathname
            </div>
          </div>

          {/* Or use file picker for preview */}
          <div style={styles.field}>
            <label style={styles.label}>Or browse for preview</label>
            <div
              style={styles.dropZone}
              onClick={() => document.getElementById('timeline-file-input').click()}
            >
              {videoFile ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>&#127916;</span>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>{videoFile.name}</div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                  Click to select video for preview player (optional)
                </div>
              )}
            </div>
            <input
              id="timeline-file-input"
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={e => {
                handleFileChange(e);
                // Browser won't give us the real path, but we set the preview
              }}
            />
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
              opacity: (!selectedSheetId || !videoPath.trim() || !serviceOnline) ? 0.4 : 1,
            }}
            disabled={!selectedSheetId || !videoPath.trim() || !serviceOnline}
            onClick={handleProcess}
          >
            Process
          </button>

          {/* Debug: show which conditions are blocking */}
          {(!selectedSheetId || !videoPath.trim() || !serviceOnline) && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
              Needs: {!selectedSheetId && 'beat sheet · '}{!videoPath.trim() && 'file path · '}{!serviceOnline && 'service online'}
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
      {step === 'done' && (
        <div style={styles.doneContainer}>
          <div style={styles.doneIcon}>&#10003;</div>
          <div style={styles.doneTitle}>AAF Downloaded</div>
          <div style={styles.doneSummary}>
            {sourceFilename} — {matchedCount}/{alignedBeats.length} beats aligned
            {unmatchedIds.length > 0 && ` (${unmatchedIds.length} unmatched)`}
          </div>
          <button
            style={styles.processButton}
            onClick={() => {
              setStep('setup');
              setAlignedBeats([]);
              setUnmatchedIds([]);
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
    maxWidth: 560,
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
  },
  dropZone: {
    padding: 24,
    border: '2px dashed rgba(255,255,255,0.15)',
    borderRadius: 12,
    cursor: 'pointer',
    transition: 'border-color 0.2s',
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
    animation: 'spin 2s linear infinite',
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
    gap: 16,
    maxWidth: 400,
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
    marginBottom: 16,
  },

  // Review (unused but kept for reference)
  reviewContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  summaryBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(255,255,255,0.04)',
    padding: '12px 16px',
    borderRadius: 10,
    fontSize: 14,
  },
  summaryLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: 'rgba(255,255,255,0.7)',
  },
  summaryDivider: {
    color: 'rgba(255,255,255,0.2)',
  },
  exportButton: {
    padding: '8px 20px',
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  doneButton: {
    padding: '8px 20px',
    background: 'rgba(34,197,94,0.2)',
    color: '#22c55e',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'default',
    fontFamily: "'DM Sans', sans-serif",
  },
  backButton: {
    padding: '8px 16px',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },

  // Timeline
  timelineSection: {
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 16,
  },
  videoPlayer: {
    width: '100%',
    maxHeight: 280,
    borderRadius: 8,
    marginBottom: 12,
    background: '#000',
  },
  timelineBarSection: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  trackLabel: {
    width: 28,
    fontSize: 11,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'right',
    flexShrink: 0,
  },
  timelineBar: {
    flex: 1,
    height: 28,
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  v1Bar: {
    position: 'absolute',
    top: 2,
    left: 0,
    right: 0,
    bottom: 2,
    background: 'rgba(99,102,241,0.25)',
    borderRadius: 3,
  },
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    background: '#fff',
    zIndex: 10,
    pointerEvents: 'none',
  },
  placingHint: {
    textAlign: 'center',
    fontSize: 13,
    color: '#6366f1',
    marginTop: 8,
    fontWeight: 500,
  },

  // Beat List
  beatList: {
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  beatListHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 120px 130px',
    gap: 12,
    padding: '10px 16px',
    fontSize: 11,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  beatRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 120px 130px',
    gap: 12,
    padding: '10px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    cursor: 'pointer',
    transition: 'background 0.15s',
    alignItems: 'center',
  },
  beatIndex: {
    display: 'inline-block',
    width: 22,
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    fontWeight: 600,
  },
  beatTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.85)',
  },
  beatBroll: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  brollChip: {
    fontSize: 11,
    background: 'rgba(99,102,241,0.12)',
    color: 'rgba(255,255,255,0.6)',
    padding: '2px 8px',
    borderRadius: 4,
  },
  beatTimecode: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: 'rgba(255,255,255,0.6)',
  },
  beatConfidence: {
    display: 'flex',
    alignItems: 'center',
  },
  confidenceBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 4,
  },
  placeButton: {
    fontSize: 12,
    padding: '4px 10px',
    background: 'rgba(239,68,68,0.15)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 500,
  },
};
