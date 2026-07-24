import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// ─── Remuxer ─────────────────────────────────────────────────────────────
// Repackages .mkv / .mov / .avi / … into .mp4 WITHOUT re-encoding (ffmpeg
// `-c copy`) — fast and lossless. Runs entirely in-browser via ffmpeg.wasm;
// the file never leaves the user's machine (no upload).
//
// Single-threaded core (@ffmpeg/core, no -mt): avoids the SharedArrayBuffer /
// cross-origin-isolation (COOP/COEP) requirement, so we don't have to add
// site-wide headers that would break other cross-origin resources. Remux is
// I/O-bound (no encode), so single-thread is plenty fast.

// @ffmpeg/ffmpeg 0.12 spawns its worker as a MODULE worker (`type: "module"`),
// where `importScripts` is unavailable — so it loads the core via
// `(await import(coreURL)).default`. That requires the ESM core build (which has
// `export default createFFmpegCore`); the UMD build has no default export and
// fails with "failed to import ffmpeg-core.js". Verified headless against
// core@0.12.9. Keep this on /esm/.
const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.9/dist/esm';
const SIZE_WARN_BYTES = 2 * 1024 * 1024 * 1024; // ~2GB — ffmpeg.wasm loads the whole file into memory

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function outName(name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.mp4`;
}

function extFromName(name) {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'mkv';
}

// Pull the most useful line(s) out of an ffmpeg log tail for display on failure.
function extractError(logLines) {
  const meaningful = logLines
    .map(l => (l || '').trim())
    .filter(Boolean)
    .filter(l =>
      /error|could not|invalid|unsupported|not currently supported|does not|failed|no such/i.test(l),
    );
  const pick = meaningful.slice(-2).join(' — ');
  return pick || (logLines.filter(Boolean).slice(-1)[0] || '').trim() || 'Conversion failed.';
}

let uidSeq = 0;
function makeItem(file) {
  uidSeq += 1;
  return {
    id: `rx_${Date.now()}_${uidSeq}`,
    file,
    name: file.name,
    size: file.size,
    status: 'queued', // queued | converting | done | failed
    progress: 0,
    url: null,
    outSize: 0,
    error: '',
    canRetryAac: false,
    oversize: file.size > SIZE_WARN_BYTES,
  };
}

export default function Remuxer() {
  const [items, setItems] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [coreState, setCoreState] = useState('idle'); // idle | loading | ready | error
  const [coreError, setCoreError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const ffmpegRef = useRef(null);
  const loadedRef = useRef(false);
  const itemsRef = useRef([]);
  const currentIdRef = useRef(null);
  const logBufRef = useRef([]);
  const processingRef = useRef(false);
  const fileInputRef = useRef(null);

  useEffect(() => { itemsRef.current = items; }, [items]);

  // Cleanup: revoke blob URLs + terminate the worker on unmount.
  useEffect(() => () => {
    itemsRef.current.forEach(it => { if (it.url) URL.revokeObjectURL(it.url); });
    try { ffmpegRef.current && ffmpegRef.current.terminate(); } catch { /* noop */ }
  }, []);

  const patchItem = useCallback((id, patch) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  async function ensureLoaded() {
    if (loadedRef.current && ffmpegRef.current) return ffmpegRef.current;
    setCoreState('loading');
    setCoreError('');
    const ffmpeg = ffmpegRef.current || new FFmpeg();
    ffmpegRef.current = ffmpeg;
    ffmpeg.on('log', ({ message }) => {
      logBufRef.current.push(message);
      if (logBufRef.current.length > 80) logBufRef.current.shift();
    });
    ffmpeg.on('progress', ({ progress }) => {
      const id = currentIdRef.current;
      if (id == null) return;
      const p = Math.max(0, Math.min(1, progress || 0));
      setItems(prev => prev.map(it => (it.id === id ? { ...it, progress: p } : it)));
    });
    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      loadedRef.current = true;
      setCoreState('ready');
      return ffmpeg;
    } catch (e) {
      setCoreState('error');
      setCoreError(e?.message || 'Failed to load the converter.');
      throw e;
    }
  }

  // Remux a single item. mode: 'copy' (default, lossless) | 'aac' (re-encode audio only).
  async function remuxOne(item, mode) {
    const ffmpeg = await ensureLoaded();
    const ext = extFromName(item.name);
    const inputName = `in_${item.id}.${ext}`;
    const outputName = `out_${item.id}.mp4`;
    logBufRef.current = [];
    currentIdRef.current = item.id;
    patchItem(item.id, { status: 'converting', progress: 0, error: '' });
    try {
      await ffmpeg.writeFile(inputName, await fetchFile(item.file));
      const args = mode === 'aac'
        ? ['-i', inputName, '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', outputName]
        : ['-i', inputName, '-c', 'copy', '-movflags', '+faststart', outputName];
      const ret = await ffmpeg.exec(args);
      if (ret !== 0) {
        const err = new Error(extractError(logBufRef.current));
        err._ffmpegFail = true;
        throw err;
      }
      const data = await ffmpeg.readFile(outputName);
      if (!data || !data.length) throw new Error('Conversion produced an empty file.');
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      patchItem(item.id, { status: 'done', progress: 1, url, outSize: blob.size, canRetryAac: false });
    } catch (e) {
      // If a lossless copy failed, an audio-only re-encode may still succeed.
      const canRetryAac = mode !== 'aac';
      patchItem(item.id, {
        status: 'failed',
        error: e?.message || 'Conversion failed.',
        canRetryAac,
      });
    } finally {
      currentIdRef.current = null;
      try { await ffmpeg.deleteFile(inputName); } catch { /* noop */ }
      try { await ffmpeg.deleteFile(outputName); } catch { /* noop */ }
    }
  }

  // Sequentially drain every 'queued' item — including ones appended mid-run.
  const drainQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const next = itemsRef.current.find(it => it.status === 'queued');
        if (!next) break;
        // eslint-disable-next-line no-await-in-loop
        await remuxOne(next, next._mode || 'copy');
      }
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, []);

  const addFiles = useCallback((fileList) => {
    const vids = Array.from(fileList || []).filter(f =>
      f && (f.type.startsWith('video/') || /\.(mkv|mov|avi|webm|ts|m4v|mp4|flv|wmv|mpg|mpeg)$/i.test(f.name)),
    );
    if (!vids.length) return;
    setItems(prev => [...prev, ...vids.map(makeItem)]);
  }, []);

  // Auto-continue the drain when new files are appended during an active run.
  useEffect(() => {
    if (processingRef.current && items.some(it => it.status === 'queued')) {
      drainQueue();
    }
  }, [items, drainQueue]);

  function onPick(e) {
    addFiles(e.target.files);
    e.target.value = ''; // allow re-picking the same file
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function removeItem(id) {
    setItems(prev => {
      const target = prev.find(it => it.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter(it => it.id !== id);
    });
  }

  function clearCompleted() {
    setItems(prev => {
      prev.filter(it => it.status === 'done' && it.url).forEach(it => URL.revokeObjectURL(it.url));
      return prev.filter(it => it.status !== 'done');
    });
  }

  function retryAac(id) {
    setItems(prev => prev.map(it =>
      it.id === id ? { ...it, status: 'queued', error: '', progress: 0, canRetryAac: false, _mode: 'aac' } : it,
    ));
    // itemsRef updates on next render; kick the drain after the state flush.
    setTimeout(() => drainQueue(), 0);
  }

  function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadAll() {
    const done = items.filter(it => it.status === 'done' && it.url);
    done.forEach((it, i) => setTimeout(() => triggerDownload(it.url, outName(it.name)), i * 400));
  }

  const queuedOrRunning = items.filter(it => it.status === 'queued' || it.status === 'converting').length;
  const finished = items.filter(it => it.status === 'done' || it.status === 'failed').length;
  const doneCount = items.filter(it => it.status === 'done').length;
  const totalTracked = items.length;
  const queuedCount = items.filter(it => it.status === 'queued').length;
  const canConvert = queuedCount > 0 && !processing;

  return (
    <div style={st.wrap}>
      <div style={st.intro}>
        <div style={st.introTitle}>Remuxer</div>
        <div style={st.introText}>
          Repackage <b>.mkv / .mov / .avi / .webm / .ts</b> and other containers into <b>.mp4</b> without
          re-encoding — fast and lossless (<code style={st.code}>-c copy</code>). Everything runs in your
          browser; files never leave your machine.
        </div>
      </div>

      {/* Dropzone */}
      <div
        style={{ ...st.drop, ...(dragOver ? st.dropOver : {}) }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mkv,.mov,.avi,.webm,.ts,.m4v,.flv,.wmv"
          multiple
          onChange={onPick}
          style={{ display: 'none' }}
        />
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5b8fc7" strokeWidth="2">
          <path d="M12 16V4M6 10l6-6 6 6" />
          <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
        <div style={st.dropTitle}>Drop videos here or click to choose</div>
        <div style={st.dropHint}>Add as many as you like — they'll be added to the queue. MKV/MOV/AVI/WEBM/TS and more.</div>
      </div>

      {coreState === 'error' && (
        <div style={st.coreErr}>Couldn't load the converter: {coreError}</div>
      )}

      {/* Controls */}
      {items.length > 0 && (
        <div style={st.controls}>
          <button
            style={{ ...st.primaryBtn, ...(canConvert ? {} : st.btnDisabled) }}
            onClick={drainQueue}
            disabled={!canConvert}
          >
            {processing
              ? `Converting ${Math.min(finished + 1, totalTracked)} of ${totalTracked}…`
              : coreState === 'loading'
                ? 'Loading converter…'
                : `Convert ${queuedCount} to MP4`}
          </button>
          {doneCount > 1 && (
            <button style={st.secondaryBtn} onClick={downloadAll}>Download all ({doneCount})</button>
          )}
          {doneCount > 0 && (
            <button style={st.ghostBtn} onClick={clearCompleted}>Clear completed</button>
          )}
          <span style={st.summary}>
            {queuedOrRunning > 0 ? `${queuedOrRunning} pending · ` : ''}{doneCount} done
          </span>
        </div>
      )}

      {/* Queue */}
      {items.length > 0 && (
        <div style={st.list}>
          {items.map(it => (
            <div key={it.id} style={st.row}>
              <div style={st.rowMain}>
                <div style={st.rowHead}>
                  <span style={st.fileName} title={it.name}>{it.name}</span>
                  <span style={st.badge(it.status)}>{STATUS_LABEL[it.status]}</span>
                  {(it.status === 'queued' || it.status === 'converting') && (
                    <button style={st.iconBtn} onClick={() => removeItem(it.id)} title="Remove" disabled={it.status === 'converting'}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                  {(it.status === 'done' || it.status === 'failed') && (
                    <button style={st.iconBtn} onClick={() => removeItem(it.id)} title="Remove">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                <div style={st.metaRow}>
                  <span style={st.meta}>{formatBytes(it.size)}{it.status === 'done' && it.outSize ? ` → ${formatBytes(it.outSize)} mp4` : ''}</span>
                  {it.oversize && it.status === 'queued' && (
                    <span style={st.warn}>Large file (&gt;2GB) — may exhaust browser memory. Proceed at your own risk.</span>
                  )}
                </div>

                {it.status === 'converting' && (
                  <div style={st.progressTrack}>
                    <div style={{ ...st.progressFill, width: `${Math.round(it.progress * 100)}%` }} />
                    <span style={st.progressPct}>{Math.round(it.progress * 100)}%</span>
                  </div>
                )}

                {it.status === 'failed' && (
                  <div style={st.failBox}>
                    <div style={st.failMsg}>{it.error}</div>
                    {it.canRetryAac && (
                      <button style={st.retryBtn} onClick={() => retryAac(it.id)}>
                        Re-encode audio to AAC &amp; retry
                      </button>
                    )}
                  </div>
                )}
              </div>

              {it.status === 'done' && it.url && (
                <button style={st.downloadBtn} onClick={() => triggerDownload(it.url, outName(it.name))}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Download .mp4
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL = { queued: 'Queued', converting: 'Converting', done: 'Done', failed: 'Failed' };
const STATUS_COLORS = {
  queued: { bg: 'rgba(255,255,255,0.06)', fg: 'rgba(255,255,255,0.5)' },
  converting: { bg: 'rgba(91,143,199,0.18)', fg: '#8fbce8' },
  done: { bg: 'rgba(34,197,94,0.18)', fg: '#86efac' },
  failed: { bg: 'rgba(239,68,68,0.18)', fg: '#fca5a5' },
};

const st = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '820px', margin: '0 auto', width: '100%' },
  intro: { display: 'flex', flexDirection: 'column', gap: '6px' },
  introTitle: { fontSize: '16px', fontWeight: 700, color: '#e2e8f0' },
  introText: { fontSize: '13px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 },
  code: {
    fontFamily: 'monospace', fontSize: '12px', padding: '1px 5px',
    background: 'rgba(255,255,255,0.06)', borderRadius: '4px', color: 'rgba(255,255,255,0.7)',
  },

  drop: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: '8px', padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
    background: 'rgba(255,255,255,0.02)', border: '1.5px dashed rgba(255,255,255,0.14)',
    borderRadius: '12px', transition: 'all 0.15s',
  },
  dropOver: { background: 'rgba(91,143,199,0.08)', borderColor: 'rgba(91,143,199,0.5)' },
  dropTitle: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0' },
  dropHint: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', maxWidth: '460px', lineHeight: 1.4 },

  coreErr: {
    fontSize: '13px', color: '#fca5a5', background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '10px 14px',
  },

  controls: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  primaryBtn: {
    padding: '9px 18px', fontSize: '13px', fontWeight: 700, color: '#fff',
    background: '#5b8fc7', border: 'none', borderRadius: '8px', cursor: 'pointer',
    fontFamily: 'inherit',
  },
  secondaryBtn: {
    padding: '9px 16px', fontSize: '13px', fontWeight: 600, color: '#5b8fc7',
    background: 'rgba(91,143,199,0.1)', border: '1px solid rgba(91,143,199,0.25)',
    borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
  },
  ghostBtn: {
    padding: '9px 14px', fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.55)',
    background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  btnDisabled: { opacity: 0.45, cursor: 'default' },
  summary: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginLeft: 'auto' },

  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  row: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '14px 16px', background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px',
  },
  rowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '7px' },
  rowHead: { display: 'flex', alignItems: 'center', gap: '8px' },
  fileName: {
    fontSize: '13px', fontWeight: 600, color: '#e2e8f0',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
  },
  badge: (status) => ({
    fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
    flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.4px',
    background: (STATUS_COLORS[status] || STATUS_COLORS.queued).bg,
    color: (STATUS_COLORS[status] || STATUS_COLORS.queued).fg,
  }),
  iconBtn: {
    padding: '3px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  metaRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  meta: { fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' },
  warn: { fontSize: '11px', color: '#eab308' },

  progressTrack: {
    position: 'relative', height: '18px', background: 'rgba(255,255,255,0.06)',
    borderRadius: '999px', overflow: 'hidden',
  },
  progressFill: {
    position: 'absolute', left: 0, top: 0, bottom: 0, background: '#5b8fc7',
    borderRadius: '999px', transition: 'width 0.2s ease-out', minWidth: '2px',
  },
  progressPct: {
    position: 'absolute', right: '8px', top: 0, bottom: 0, display: 'flex', alignItems: 'center',
    fontSize: '10px', fontWeight: 700, color: '#e2e8f0',
  },

  failBox: { display: 'flex', flexDirection: 'column', gap: '8px' },
  failMsg: { fontSize: '12px', color: '#fca5a5', lineHeight: 1.4, wordBreak: 'break-word' },
  retryBtn: {
    alignSelf: 'flex-start', padding: '6px 12px', fontSize: '12px', fontWeight: 600,
    color: '#fcd34d', background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)',
    borderRadius: '7px', cursor: 'pointer', fontFamily: 'inherit',
  },

  downloadBtn: {
    display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0,
    padding: '8px 14px', fontSize: '12px', fontWeight: 700, color: '#fff',
    background: '#22a355', border: 'none', borderRadius: '8px', cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
