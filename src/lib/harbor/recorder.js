// Harbor local recorder engine — framework-free (no React imports).
//
// Phase 2's redundancy story: every participant records THEIR OWN camera/mic
// at source quality with MediaRecorder (video+audio webm, 720p cap for v1 —
// the stream is already constrained by LOCAL_MEDIA_CONSTRAINTS in mesh.js),
// so recording quality never depends on the live call. Chunks are produced on
// a ~5s timeslice and uploaded progressively — by the time a guest closes the
// laptop, the recording is already safe in storage.
//
// The engine is transport-agnostic: it takes a MediaStream plus a transport
// adapter (see recorderTransports.js — staff upload directly under RLS,
// guests go through the harbor-track edge function with the session token as
// credential). One engine, two transports.
//
// Transport contract (all methods async, all may throw):
//   createTrack({ kind, mimeType })          → { trackId, storagePrefix }
//   uploadChunk(index, blob, mimeType)       → resolves when the chunk is safe
//   progress({ bytesUploaded, chunkCount })  → fire-and-forget health ping
//   finalize({ chunkCount, bytes, durationMs, status }) → 'complete'|'failed'
//
// Upload queue: chunks queue in memory and upload sequentially with
// exponential backoff. Upload failures NEVER stop the recording — while
// recording, retries are unbounded and chunks keep queueing (memory cost is
// ~1.6MB per 5s chunk at the default bitrate; an hour fully behind is ~1.2GB,
// accepted for v1). Once stopped, the flush retries each chunk a bounded
// number of times before finalizing 'failed'.
//
// States: idle → starting → recording → flushing → complete | failed.
// Health (for the UI): 'safe' (nothing pending), 'behind' (N chunks pending),
// 'failed' (recorder error or flush gave up).

export const RECORDING_TIMESLICE_MS = 5000;
export const RECORDING_VIDEO_BPS = 2500000; // ~2.5 Mbps — good 720p webm
export const RECORDING_AUDIO_BPS = 128000;
export const PROGRESS_INTERVAL_MS = 15000; // throttle for transport.progress
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;
const FLUSH_MAX_ATTEMPTS_PER_CHUNK = 10; // post-stop only; ~3.5 min of backoff

export const HARBOR_RECORDINGS_BUCKET = 'harbor-recordings';

/** File extension for a recording container mime. */
export function containerExt(mimeType) {
  return (mimeType || '').startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** Chunk object path inside the bucket. Mirrors chunkPath() in
 *  supabase/functions/harbor-track/index.ts — keep in sync. */
export function chunkPath(storagePrefix, index, ext = 'webm') {
  return `${storagePrefix}/${String(index).padStart(6, '0')}.${ext}`;
}

/** Best supported recording mime. MP4 (H.264/AAC) preferred — Premiere
 *  doesn't import webm — with webm fallback (Firefox has no mp4 recorder).
 *  Chrome 126+/Safari emit fragmented MP4 under timeslice, so sequential
 *  chunks concatenate into a valid file just like webm. */
export function pickRecordingMimeType(kind = 'video') {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = kind === 'audio'
    ? [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
      ]
    : [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* isTypeSupported can throw on exotic UAs */
    }
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class HarborRecorder {
  /**
   * @param {object} opts
   * @param {MediaStream} opts.stream       the local A/V stream to record
   * @param {object} opts.transport         see contract above
   * @param {'video'|'audio'} [opts.kind]   'video' = combined A/V webm (v1)
   * @param {(state: object) => void} [opts.onState]  snapshot on every change
   * @param {MediaStreamTrack[]} [opts.ownedTracks]
   *        tracks the recorder OWNS (clones taken for mute-proof recording —
   *        see CallStage.startRecording). Stopped the moment MediaRecorder
   *        fully stops, on start failure, and on the failure path, so cloned
   *        mic tracks never outlive the recording (no mic-light leaks). The
   *        flush/upload phase doesn't need them.
   */
  constructor({ stream, transport, kind = 'video', onState, ownedTracks = [] }) {
    this.stream = stream;
    this.transport = transport;
    this.kind = kind;
    this.onState = onState;
    this.ownedTracks = ownedTracks;

    this.status = 'idle';
    this.trackId = null;
    this.storagePrefix = null;
    this.mimeType = '';
    this.error = null;

    this.queue = []; // [{ index, blob }] — uploads run head-first, in order
    this.chunksRecorded = 0;
    this.chunksUploaded = 0;
    this.bytesRecorded = 0;
    this.bytesUploaded = 0;
    this.durationMs = 0;

    this._recorder = null;
    this._startedAt = 0;
    this._pumpPromise = null;
    this._stopPromise = null;
    this._lastProgressAt = 0;
  }

  getState() {
    const pending = this.queue.length;
    let health = 'safe';
    if (this.status === 'failed') health = 'failed';
    else if (pending > 0) health = 'behind';
    return {
      status: this.status,
      trackId: this.trackId,
      chunksRecorded: this.chunksRecorded,
      chunksUploaded: this.chunksUploaded,
      bytesRecorded: this.bytesRecorded,
      bytesUploaded: this.bytesUploaded,
      durationMs: this.durationMs,
      pending,
      health,
      error: this.error,
    };
  }

  hasPendingUploads() {
    return (
      this.queue.length > 0 || this.status === 'recording' || this.status === 'flushing'
    );
  }

  _emit() {
    this.onState?.(this.getState());
  }

  /** Create the track row, then start MediaRecorder. Throws on failure. */
  async start() {
    if (this.status !== 'idle') return;
    this.status = 'starting';
    this._emit();
    try {
      this.mimeType = pickRecordingMimeType(this.kind);
      const { trackId, storagePrefix } = await this.transport.createTrack({
        kind: this.kind,
        mimeType: this.mimeType || (this.kind === 'audio' ? 'audio/webm' : 'video/webm'),
      });
      this.trackId = trackId;
      this.storagePrefix = storagePrefix;

      const options = {
        ...(this.kind === 'audio' ? {} : { videoBitsPerSecond: RECORDING_VIDEO_BPS }),
        audioBitsPerSecond: RECORDING_AUDIO_BPS,
      };
      if (this.mimeType) options.mimeType = this.mimeType;
      const recorder = new MediaRecorder(this.stream, options);
      this._recorder = recorder;

      recorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        this.queue.push({ index: this.chunksRecorded, blob: e.data });
        this.chunksRecorded += 1;
        this.bytesRecorded += e.data.size;
        this._pump();
        this._emit();
      };
      recorder.onerror = (e) => {
        console.error('harbor recorder: MediaRecorder error', e?.error || e);
        this._failAndFinalize(e?.error?.message || 'MediaRecorder error');
      };

      recorder.start(RECORDING_TIMESLICE_MS);
      this._startedAt = performance.now();
      this.status = 'recording';
      this._emit();
    } catch (err) {
      this.status = 'failed';
      this.error = err?.message || 'Could not start recording';
      this._releaseOwnedTracks();
      this._emit();
      throw err;
    }
  }

  /** Stop tracks the recorder owns (mute-proof mic clones). Idempotent. */
  _releaseOwnedTracks() {
    for (const track of this.ownedTracks) {
      try {
        track.stop();
      } catch {
        /* already stopped */
      }
    }
    this.ownedTracks = [];
  }

  /** Stop → flush remaining chunks → finalize. Idempotent; resolves when the
   *  track is finalized (or the flush gave up). Safe to fire-and-forget. */
  stop() {
    if (this._stopPromise) return this._stopPromise;
    if (this.status !== 'recording' && this.status !== 'starting') {
      return Promise.resolve();
    }
    this._stopPromise = this._doStop();
    return this._stopPromise;
  }

  async _doStop() {
    this.durationMs = Math.round(performance.now() - this._startedAt);
    this.status = 'flushing';
    this._emit();

    const recorder = this._recorder;
    if (recorder && recorder.state !== 'inactive') {
      // The final dataavailable fires before onstop, so after this await the
      // queue holds every chunk of the recording.
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      try {
        recorder.stop();
        await stopped;
      } catch (err) {
        console.warn('harbor recorder: stop failed', err);
      }
    }

    // MediaRecorder is fully stopped (final dataavailable already fired) —
    // owned clone tracks are no longer needed; the flush is upload-only.
    this._releaseOwnedTracks();

    await this._drain();
    if (this.status === 'failed') return; // flush gave up — already finalized

    try {
      await this.transport.finalize({
        chunkCount: this.chunksRecorded,
        bytes: this.bytesRecorded,
        durationMs: this.durationMs,
        status: 'complete',
      });
      this.status = 'complete';
    } catch (err) {
      console.error('harbor recorder: finalize failed', err);
      this.status = 'failed';
      this.error = err?.message || 'Finalize failed';
    }
    this._emit();
  }

  /** Sequential upload pump with exponential backoff. Single-flight. */
  _pump() {
    if (this._pumpPromise) return this._pumpPromise;
    this._pumpPromise = this._pumpLoop().finally(() => {
      this._pumpPromise = null;
    });
    return this._pumpPromise;
  }

  async _pumpLoop() {
    while (this.queue.length > 0 && this.status !== 'failed') {
      const item = this.queue[0];
      let attempt = 0;
      for (;;) {
        try {
          await this.transport.uploadChunk(item.index, item.blob, this.mimeType || 'video/webm');
          break;
        } catch (err) {
          attempt += 1;
          const flushing = this.status === 'flushing';
          if (flushing && attempt >= FLUSH_MAX_ATTEMPTS_PER_CHUNK) {
            console.error('harbor recorder: flush gave up on chunk', item.index, err);
            await this._failAndFinalize(`Upload failed at chunk ${item.index}`);
            return;
          }
          // While recording: retry forever — recording never stops because
          // upload hiccuped. Chunks keep queueing in memory meanwhile.
          const backoff = Math.min(RETRY_BASE_MS * 2 ** Math.min(attempt - 1, 6), RETRY_MAX_MS);
          console.warn(
            `harbor recorder: chunk ${item.index} upload failed (attempt ${attempt}), retrying in ${backoff}ms`,
            err,
          );
          this._emit(); // surface 'behind' state while we wait
          await sleep(backoff);
          if (this.status === 'failed') return;
        }
      }
      this.queue.shift();
      this.chunksUploaded += 1;
      this.bytesUploaded += item.blob.size;
      this._maybeProgress();
      this._emit();
    }
  }

  /** Wait for the pump to clear the queue (it self-restarts after failures,
   *  so poll the pump promise until the queue is empty or we've failed). */
  async _drain() {
    for (;;) {
      if (this.status === 'failed') return;
      if (this.queue.length === 0 && !this._pumpPromise) return;
      await (this._pumpPromise || this._pump());
    }
  }

  /** Throttled health ping so the producer's tracks panel stays honest. */
  _maybeProgress() {
    const now = Date.now();
    if (now - this._lastProgressAt < PROGRESS_INTERVAL_MS) return;
    this._lastProgressAt = now;
    this.transport
      .progress({ bytesUploaded: this.bytesUploaded, chunkCount: this.chunksUploaded })
      .catch((err) => console.warn('harbor recorder: progress ping failed', err));
  }

  async _failAndFinalize(message) {
    if (this.status === 'failed') return;
    this.status = 'failed';
    this.error = message;
    try {
      const recorder = this._recorder;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* already stopping */
    }
    this._releaseOwnedTracks();
    this._emit();
    try {
      await this.transport.finalize({
        chunkCount: this.chunksUploaded,
        bytes: this.bytesUploaded,
        durationMs: this.durationMs || Math.round(performance.now() - this._startedAt),
        status: 'failed',
      });
    } catch (err) {
      console.error('harbor recorder: failed-state finalize also failed', err);
    }
  }
}
