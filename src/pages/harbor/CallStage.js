import React, { useState, useEffect, useRef, useCallback } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily, transitions, zIndex } from '../../lib/styleTokens';
import { pill, button, sectionHeader } from '../../lib/styleRecipes';
import { HarborMesh } from '../../lib/harbor/mesh';
import { joinSignalingChannel } from '../../lib/harbor/signaling';
import { HarborRecorder } from '../../lib/harbor/recorder';

// Shared live-call surface for Harbor — used by both HarborRoom (staff /
// producer side) and HarborJoin (public guest side). Owns the mesh +
// signaling lifecycle: acquire media, join the broadcast channel, connect
// peers as presence/hello reveals them, tear everything down on unmount
// (no camera-light-stuck-on bugs).
//
// Session control: when canControlSession (producer), Start/End buttons call
// onUpdateSessionStatus (the parent does the DB write under RLS) and then the
// new status is broadcast as a 'state' message so guests — who can't read the
// table — follow along live.

const CONN_TONES = {
  connected: 'success',
  connecting: 'warning',
  new: 'warning',
  disconnected: 'warning',
  failed: 'danger',
  closed: 'danger',
};

const STATUS_LABELS = { scheduled: 'Scheduled', live: 'Live', ended: 'Ended' };
const STATUS_TONES = { scheduled: 'info', live: 'success', ended: 'danger' };

// While recording, 'record-state' rebroadcasts are throttled to this cadence
// (status transitions always broadcast immediately).
const REC_BROADCAST_THROTTLE_MS = 5000;

/** Upload-health label for the SELF tile, from a recorder state snapshot. */
function recHealthLabel(state) {
  if (!state) return null;
  switch (state.status) {
    case 'starting':
      return 'Starting…';
    case 'recording':
      return state.pending > 0 ? `Saving — ${state.pending} behind` : 'All safe';
    case 'flushing':
      return `Saving — ${state.pending} to go`;
    case 'complete':
      return 'Saved';
    case 'failed':
      return 'Recording failed';
    default:
      return null;
  }
}

/** Upload-health label for a REMOTE tile, from its record-state broadcast. */
function remoteRecLabel(rec) {
  if (!rec) return null;
  if (rec.status === 'failed' || rec.health === 'failed') return 'Recording failed';
  if (rec.recording) return rec.pending > 0 ? `Saving — ${rec.pending} behind` : 'All safe';
  if (rec.status === 'complete') return 'Saved';
  return null;
}

export default function CallStage({
  channelName,
  clientId,
  displayName,
  role, // 'producer' | 'guest'
  session, // { id, title, status }
  initialStream = null, // reuse a device-check preview stream (guest flow)
  canControlSession = false,
  onUpdateSessionStatus, // async (nextStatus) => void — parent writes the DB
  onLeave, // (reason: 'left' | 'ended') => void
  onPageUnload, // best-effort hard-unload hook (guest leave beacon)
  createRecorderTransport = null, // () => transport (see recorderTransports.js)
}) {
  const [localStream, setLocalStream] = useState(null);
  const [mediaError, setMediaError] = useState(null);
  const [channelStatus, setChannelStatus] = useState('connecting');
  const [sessionStatus, setSessionStatus] = useState(session?.status || 'scheduled');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  // remotes: clientId → { name, role, stream, connState, micOn, camOn, rec }
  const [remotes, setRemotes] = useState({});
  const [savingStatus, setSavingStatus] = useState(false);
  const [recState, setRecState] = useState(null); // own recorder snapshot

  const meshRef = useRef(null);
  const signalRef = useRef(null);
  const selfStateRef = useRef({ micOn: true, camOn: true });
  const recorderRef = useRef(null);
  const transportFactoryRef = useRef(createRecorderTransport);
  transportFactoryRef.current = createRecorderTransport;
  const presenceRolesRef = useRef({}); // clientId → presence-verified role
  const lastRecBroadcastRef = useRef({ at: 0, status: null });

  const upsertRemote = useCallback((id, patch) => {
    setRemotes((prev) => ({
      ...prev,
      [id]: { name: 'Guest', role: 'guest', micOn: true, camOn: true, ...(prev[id] || {}), ...patch },
    }));
  }, []);

  const dropRemote = useCallback((id) => {
    setRemotes((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // ── Local recording (Phase 2) ────────────────────────────────
  // Every client records its OWN camera/mic and uploads through its
  // transport — recording quality never depends on the call. 'record'
  // commands arrive over signaling; 'record-state' broadcasts drive the
  // producer's tile badges (immediate on transitions, throttled while
  // recording — chunk uploads emit ~every 5s anyway).
  const broadcastRecState = useCallback((state) => {
    const last = lastRecBroadcastRef.current;
    const now = Date.now();
    const transition = state.status !== last.status;
    if (!transition && now - last.at < REC_BROADCAST_THROTTLE_MS) return;
    lastRecBroadcastRef.current = { at: now, status: state.status };
    signalRef.current?.send('record-state', {
      recording:
        state.status === 'starting' || state.status === 'recording' || state.status === 'flushing',
      trackId: state.trackId,
      recStatus: state.status,
      health: state.health,
      pending: state.pending,
    });
  }, []);

  const startRecording = useCallback(async () => {
    const factory = transportFactoryRef.current;
    const stream = meshRef.current?.localStream;
    if (!factory || !stream) return;
    const current = recorderRef.current?.getState().status;
    if (current === 'starting' || current === 'recording' || current === 'flushing') return;
    const recorder = new HarborRecorder({
      stream,
      transport: factory(),
      onState: (state) => {
        setRecState(state);
        broadcastRecState(state);
      },
    });
    recorderRef.current = recorder;
    setRecState(recorder.getState());
    try {
      await recorder.start();
    } catch (err) {
      console.error('Harbor: recording failed to start:', err);
    }
  }, [broadcastRecState]);

  const stopRecording = useCallback(() => {
    // Flush + finalize continue async — uploads don't need the media stream.
    recorderRef.current?.stop();
  }, []);

  // ── Mesh + signaling lifecycle (mount once) ──────────────────
  useEffect(() => {
    let cancelled = false;

    const mesh = new HarborMesh({
      clientId,
      sendSignal: (to, msg) => signalRef.current?.send(msg.type, msg, to),
      onRemoteStream: (id, stream) => upsertRemote(id, { stream }),
      onPeerState: (id, connState) => upsertRemote(id, { connState }),
      onPeerRemoved: (id) => dropRemote(id),
    });
    meshRef.current = mesh;

    const handleSignal = (payload) => {
      switch (payload.type) {
        case 'hello':
          upsertRemote(payload.from, { name: payload.name, role: payload.role });
          mesh.connectTo(payload.from);
          // Tell the newcomer our current mute state (they missed past broadcasts).
          signalRef.current?.send('state', { ...selfStateRef.current }, payload.from);
          break;
        case 'offer':
        case 'answer':
        case 'ice':
          mesh.handleSignal(payload.from, payload);
          break;
        case 'leave':
          mesh.removePeer(payload.from);
          dropRemote(payload.from);
          break;
        case 'state':
          if (payload.status) setSessionStatus(payload.status);
          if (typeof payload.micOn === 'boolean' || typeof payload.camOn === 'boolean') {
            upsertRemote(payload.from, {
              ...(typeof payload.micOn === 'boolean' ? { micOn: payload.micOn } : {}),
              ...(typeof payload.camOn === 'boolean' ? { camOn: payload.camOn } : {}),
            });
          }
          break;
        case 'record':
          // Only honor commands from a presence-verified producer, addressed
          // to us or to the whole room. Presence meta is the role source;
          // the token-derived channel secret is the trust boundary.
          if (presenceRolesRef.current[payload.from] !== 'producer') break;
          if (payload.target !== 'all' && payload.target !== clientId) break;
          if (payload.action === 'start') startRecording();
          else if (payload.action === 'stop') stopRecording();
          break;
        case 'record-state':
          upsertRemote(payload.from, {
            rec: {
              recording: !!payload.recording,
              status: payload.recStatus,
              health: payload.health || 'safe',
              pending: payload.pending || 0,
            },
          });
          break;
        default:
          break;
      }
    };

    (async () => {
      try {
        const stream = await mesh.startLocalMedia(initialStream);
        if (cancelled) {
          mesh.close();
          return;
        }
        setLocalStream(stream);

        const signal = joinSignalingChannel({
          channelName,
          clientId,
          meta: { name: displayName, role },
          onSignal: handleSignal,
          onPresence: (others) => {
            const roles = {};
            for (const o of others) roles[o.clientId] = o.role;
            presenceRolesRef.current = roles;
            const present = new Set(others.map((o) => o.clientId));
            for (const o of others) {
              upsertRemote(o.clientId, { name: o.name, role: o.role });
              mesh.connectTo(o.clientId);
            }
            // Presence leave: peer teardown for anyone no longer tracked.
            for (const id of [...mesh.peers.keys()]) {
              if (!present.has(id)) {
                mesh.removePeer(id);
                dropRemote(id);
              }
            }
            setRemotes((prev) => {
              const next = {};
              for (const [id, r] of Object.entries(prev)) if (present.has(id)) next[id] = r;
              return Object.keys(next).length === Object.keys(prev).length ? prev : next;
            });
          },
          onStatus: (status) => {
            setChannelStatus(status === 'SUBSCRIBED' ? 'connected' : status.toLowerCase());
            if (status === 'SUBSCRIBED') {
              signalRef.current?.send('hello', { name: displayName, role });
            }
          },
        });
        signalRef.current = signal;
      } catch (err) {
        console.error('Harbor call setup failed:', err);
        if (!cancelled) setMediaError(err?.message || 'Could not access camera and microphone.');
      }
    })();

    // beforeunload only WARNS (it's cancellable); destructive teardown lives
    // on pagehide, which fires only when the page is really going away. With
    // recording in play, teardown-on-beforeunload would kill the call even
    // when the user cancels the "uploads still saving" dialog.
    const handleBeforeUnload = (e) => {
      if (recorderRef.current?.hasPendingUploads()) {
        e.preventDefault();
        e.returnValue = ''; // Chrome requires returnValue to show the dialog
      }
    };
    const handlePageHide = () => {
      try {
        signalRef.current?.send('leave');
      } catch {
        /* page is going away */
      }
      onPageUnload?.();
      mesh.close();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      recorderRef.current?.stop(); // flush + finalize continue past unmount
      try {
        signalRef.current?.send('leave');
      } catch {
        /* channel may be gone */
      }
      signalRef.current?.leave();
      signalRef.current = null;
      mesh.close(); // stops local tracks — camera light off
      meshRef.current = null;
    };
    // eslint-disable-next-line
  }, []); // channel + identity are fixed for the life of a call

  // Session ended (by us or via 'state' broadcast): stop all media.
  const ended = sessionStatus === 'ended';
  useEffect(() => {
    if (ended) {
      // Stop the recorder BEFORE killing tracks: MediaRecorder.stop() flushes
      // its final chunk, and the upload flush doesn't need the stream.
      recorderRef.current?.stop();
      meshRef.current?.close();
      setRemotes({});
      setLocalStream(null);
    }
  }, [ended]);

  const toggleMic = () => {
    const next = !micOn;
    meshRef.current?.setAudioEnabled(next);
    setMicOn(next);
    selfStateRef.current = { ...selfStateRef.current, micOn: next };
    signalRef.current?.send('state', { micOn: next });
  };

  const toggleCam = () => {
    const next = !camOn;
    meshRef.current?.setVideoEnabled(next);
    setCamOn(next);
    selfStateRef.current = { ...selfStateRef.current, camOn: next };
    signalRef.current?.send('state', { camOn: next });
  };

  const changeSessionStatus = async (next) => {
    if (!onUpdateSessionStatus) return;
    setSavingStatus(true);
    try {
      await onUpdateSessionStatus(next);
      setSessionStatus(next);
      signalRef.current?.send('state', { status: next });
    } catch (err) {
      console.error('Harbor: session status update failed:', err);
    } finally {
      setSavingStatus(false);
    }
  };

  const remoteEntries = Object.entries(remotes);

  // ── Producer record controls ─────────────────────────────────
  const isProducer = role === 'producer';
  const canRecord = !!createRecorderTransport;
  const selfRecording =
    recState?.status === 'starting' ||
    recState?.status === 'recording' ||
    recState?.status === 'flushing';
  const anyoneRecording = selfRecording || remoteEntries.some(([, r]) => r.rec?.recording);

  const recordAll = () => {
    signalRef.current?.send('record', { action: 'start', target: 'all' });
    startRecording();
  };
  const stopRecordAll = () => {
    signalRef.current?.send('record', { action: 'stop', target: 'all' });
    stopRecording();
  };
  const toggleRemoteRecord = (id, isRec) => {
    signalRef.current?.send('record', { action: isRec ? 'stop' : 'start', target: id }, id);
  };

  if (mediaError) {
    return (
      <div style={styles.centerWrap}>
        <div style={styles.notice}>
          <h2 style={sectionHeader(2)}>Camera & microphone needed</h2>
          <p style={styles.noticeText}>{mediaError}</p>
          <p style={styles.noticeText}>
            Check browser permissions for this site, then reload the page.
          </p>
          <button type="button" style={button({ variant: 'ghost' })} onClick={() => onLeave?.('left')}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (ended) {
    return (
      <div style={styles.centerWrap}>
        <div style={styles.notice}>
          <span style={pill('danger')}>Session ended</span>
          <p style={styles.noticeText}>
            {session?.title ? `"${session.title}" has ended.` : 'This session has ended.'}
          </p>
          <button type="button" style={button()} onClick={() => onLeave?.('ended')}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.stage}>
      {/* Header: title, session status, channel status, producer controls */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.title}>{session?.title || 'Harbor session'}</span>
          <span style={pill(STATUS_TONES[sessionStatus] || 'info')}>
            {STATUS_LABELS[sessionStatus] || sessionStatus}
          </span>
          {channelStatus !== 'connected' && (
            <span style={pill('warning')}>signaling: {channelStatus}</span>
          )}
        </div>
        {(canControlSession || (isProducer && canRecord)) && (
          <div style={styles.headerRight}>
            {isProducer && canRecord && (
              anyoneRecording ? (
                <button
                  type="button"
                  style={button({ variant: 'danger', size: 'sm' })}
                  onClick={stopRecordAll}
                >
                  Stop all recording
                </button>
              ) : (
                <button
                  type="button"
                  style={button({ variant: 'secondary', size: 'sm' })}
                  onClick={recordAll}
                >
                  Record all
                </button>
              )
            )}
            {canControlSession && sessionStatus === 'scheduled' && (
              <button
                type="button"
                style={button({ size: 'sm', disabled: savingStatus })}
                disabled={savingStatus}
                onClick={() => changeSessionStatus('live')}
              >
                Start session
              </button>
            )}
            {canControlSession && sessionStatus === 'live' && (
              <button
                type="button"
                style={button({ variant: 'danger', size: 'sm', disabled: savingStatus })}
                disabled={savingStatus}
                onClick={() => changeSessionStatus('ended')}
              >
                End session
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tile grid: local preview + up to 3 remote peers, responsive wrap */}
      <div style={styles.grid}>
        <LocalTile
          stream={localStream}
          name={displayName}
          micOn={micOn}
          camOn={camOn}
          recState={recState}
          onToggleRecord={
            isProducer && canRecord ? (selfRecording ? stopRecording : startRecording) : null
          }
        />
        {remoteEntries.map(([id, peer]) => (
          <RemoteTile
            key={id}
            peer={peer}
            showRecHealth={isProducer}
            onToggleRecord={
              isProducer && canRecord
                ? () => toggleRemoteRecord(id, !!peer.rec?.recording)
                : null
            }
          />
        ))}
        {remoteEntries.length === 0 && (
          <div style={styles.emptyTile}>
            <span style={styles.emptyTileText}>Waiting for others to join…</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <button
          type="button"
          style={micOn ? styles.ctrlBtnOn : styles.ctrlBtnOff}
          onClick={toggleMic}
          title={micOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          {micOn ? 'Mic on' : 'Mic off'}
        </button>
        <button
          type="button"
          style={camOn ? styles.ctrlBtnOn : styles.ctrlBtnOff}
          onClick={toggleCam}
          title={camOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {camOn ? 'Cam on' : 'Cam off'}
        </button>
        <button type="button" style={button({ variant: 'danger' })} onClick={() => onLeave?.('left')}>
          Leave
        </button>
      </div>
    </div>
  );
}

function LocalTile({ stream, name, micOn, camOn, recState, onToggleRecord }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const recording =
    recState?.status === 'starting' ||
    recState?.status === 'recording' ||
    recState?.status === 'flushing';
  const healthLabel = recHealthLabel(recState);

  return (
    <div style={styles.tile}>
      {/* Local preview is always muted (no echo) and mirrored. */}
      <video ref={videoRef} autoPlay playsInline muted style={styles.videoMirrored} />
      {!camOn && (
        <div style={styles.camOffOverlay}>
          <span style={styles.camOffText}>Camera off</span>
        </div>
      )}
      {/* Own recording state — every participant sees this clearly. */}
      {recState && recState.status !== 'idle' && (
        <div style={styles.recBadge}>
          {recording && <span style={styles.recDot} />}
          {recording && <span style={styles.recText}>REC</span>}
          {healthLabel && (
            <span style={recState.status === 'failed' ? styles.recHealthBad : styles.recHealthText}>
              {healthLabel}
            </span>
          )}
        </div>
      )}
      {onToggleRecord && (
        <button type="button" style={styles.tileRecordBtn} onClick={onToggleRecord}>
          {recording ? 'Stop rec' : 'Record'}
        </button>
      )}
      <div style={styles.nameTag}>
        <span style={styles.nameText}>{name} (you)</span>
        {!micOn && <span style={styles.mutedTag}>muted</span>}
      </div>
    </div>
  );
}

function RemoteTile({ peer, showRecHealth, onToggleRecord }) {
  const videoRef = useRef(null);
  const [needsUnmute, setNeedsUnmute] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !peer.stream) return;
    el.srcObject = peer.stream;
    // Safari/iOS autoplay policy: try with sound (we're post-user-gesture in
    // most flows); on rejection fall back to muted playback + tap-to-unmute.
    el.muted = false;
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        el.muted = true;
        el.play().catch(() => {});
        setNeedsUnmute(true);
      });
    }
  }, [peer.stream]);

  const unmute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.play().catch(() => {});
    setNeedsUnmute(false);
  };

  const connState = peer.connState || 'connecting';
  const recLabel = remoteRecLabel(peer.rec);
  return (
    <div style={styles.tile}>
      <video ref={videoRef} autoPlay playsInline style={styles.video} />
      {peer.camOn === false && (
        <div style={styles.camOffOverlay}>
          <span style={styles.camOffText}>Camera off</span>
        </div>
      )}
      {/* REC is visible to everyone; upload health is producer-only. */}
      {peer.rec && (peer.rec.recording || (showRecHealth && recLabel)) && (
        <div style={styles.recBadge}>
          {peer.rec.recording && <span style={styles.recDot} />}
          {peer.rec.recording && <span style={styles.recText}>REC</span>}
          {showRecHealth && recLabel && (
            <span
              style={
                peer.rec.status === 'failed' || peer.rec.health === 'failed'
                  ? styles.recHealthBad
                  : styles.recHealthText
              }
            >
              {recLabel}
            </span>
          )}
        </div>
      )}
      {onToggleRecord && (
        <button type="button" style={styles.tileRecordBtn} onClick={onToggleRecord}>
          {peer.rec?.recording ? 'Stop rec' : 'Record'}
        </button>
      )}
      {connState !== 'connected' && (
        <span style={{ ...pill(CONN_TONES[connState] || 'warning'), ...styles.connBadge }}>
          {connState}
        </span>
      )}
      {needsUnmute && (
        <button type="button" style={styles.unmuteBtn} onClick={unmute}>
          Tap for audio
        </button>
      )}
      <div style={styles.nameTag}>
        <span style={styles.nameText}>{peer.name}</span>
        {peer.micOn === false && <span style={styles.mutedTag}>muted</span>}
      </div>
    </div>
  );
}

const styles = {
  stage: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
    width: '100%',
    flex: 1,
    minHeight: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
    minWidth: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    gap: spacing.md,
    width: '100%',
    alignContent: 'start',
    flex: 1,
  },
  tile: {
    position: 'relative',
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    overflow: 'hidden',
    aspectRatio: '16 / 9',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    background: colors.bg,
  },
  videoMirrored: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    background: colors.bg,
    transform: 'scaleX(-1)',
  },
  emptyTile: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colors.bgInput,
    border: `1px dashed ${colors.borderStrong}`,
    borderRadius: radii.lg,
    aspectRatio: '16 / 9',
  },
  emptyTileText: {
    fontSize: fontSizes.md,
    color: colors.textSubtle,
  },
  nameTag: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    background: colors.bgOverlay,
    borderRadius: radii.sm,
    maxWidth: '85%',
  },
  nameText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  mutedTag: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.bold,
    color: colors.danger.fgSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  connBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
  recBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    background: colors.bgOverlay,
    borderRadius: radii.sm,
    maxWidth: '85%',
  },
  recDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radii.circle,
    background: colors.danger.fg,
    flexShrink: 0,
  },
  recText: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.bold,
    color: colors.danger.fgSoft,
    letterSpacing: 0.5,
  },
  recHealthText: {
    fontSize: fontSizes.xxs,
    color: colors.textMuted,
    whiteSpace: 'nowrap',
  },
  recHealthBad: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    color: colors.danger.fgSoft,
    whiteSpace: 'nowrap',
  },
  tileRecordBtn: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    ...button({ variant: 'secondary', size: 'sm' }),
    zIndex: zIndex.base,
  },
  unmuteBtn: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    ...button({ size: 'sm' }),
    zIndex: zIndex.base,
  },
  camOffOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colors.bgHover,
  },
  camOffText: {
    fontSize: fontSizes.md,
    color: colors.textSubtle,
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.md,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
    flexWrap: 'wrap',
  },
  ctrlBtnOn: {
    ...button({ variant: 'secondary' }),
    transition: transitions.fast,
  },
  ctrlBtnOff: {
    ...button({ variant: 'secondary' }),
    background: colors.danger.bg,
    border: `1px solid ${colors.danger.border}`,
    color: colors.danger.fgSoft,
    transition: transitions.fast,
  },
  centerWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    width: '100%',
    fontFamily,
  },
  notice: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xxxl,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
    maxWidth: 420,
    textAlign: 'center',
  },
  noticeText: {
    fontSize: fontSizes.md,
    color: colors.textMuted,
    lineHeight: 1.6,
    margin: 0,
  },
};
