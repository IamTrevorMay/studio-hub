import React, { useState, useEffect, useRef, useCallback } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily, transitions, zIndex } from '../../lib/styleTokens';
import { pill, button, sectionHeader } from '../../lib/styleRecipes';
import { HarborMesh } from '../../lib/harbor/mesh';
import { joinSignalingChannel } from '../../lib/harbor/signaling';

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
}) {
  const [localStream, setLocalStream] = useState(null);
  const [mediaError, setMediaError] = useState(null);
  const [channelStatus, setChannelStatus] = useState('connecting');
  const [sessionStatus, setSessionStatus] = useState(session?.status || 'scheduled');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  // remotes: clientId → { name, role, stream, connState, micOn, camOn }
  const [remotes, setRemotes] = useState({});
  const [savingStatus, setSavingStatus] = useState(false);

  const meshRef = useRef(null);
  const signalRef = useRef(null);
  const selfStateRef = useRef({ micOn: true, camOn: true });

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

    const handleUnload = () => {
      try {
        signalRef.current?.send('leave');
      } catch {
        /* page is going away */
      }
      onPageUnload?.();
      mesh.close();
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', handleUnload);
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
        {canControlSession && (
          <div style={styles.headerRight}>
            {sessionStatus === 'scheduled' && (
              <button
                type="button"
                style={button({ size: 'sm', disabled: savingStatus })}
                disabled={savingStatus}
                onClick={() => changeSessionStatus('live')}
              >
                Start session
              </button>
            )}
            {sessionStatus === 'live' && (
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
        <LocalTile stream={localStream} name={displayName} micOn={micOn} camOn={camOn} />
        {remoteEntries.map(([id, peer]) => (
          <RemoteTile key={id} peer={peer} />
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

function LocalTile({ stream, name, micOn, camOn }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);
  return (
    <div style={styles.tile}>
      {/* Local preview is always muted (no echo) and mirrored. */}
      <video ref={videoRef} autoPlay playsInline muted style={styles.videoMirrored} />
      {!camOn && (
        <div style={styles.camOffOverlay}>
          <span style={styles.camOffText}>Camera off</span>
        </div>
      )}
      <div style={styles.nameTag}>
        <span style={styles.nameText}>{name} (you)</span>
        {!micOn && <span style={styles.mutedTag}>muted</span>}
      </div>
    </div>
  );
}

function RemoteTile({ peer }) {
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
  return (
    <div style={styles.tile}>
      <video ref={videoRef} autoPlay playsInline style={styles.video} />
      {peer.camOn === false && (
        <div style={styles.camOffOverlay}>
          <span style={styles.camOffText}>Camera off</span>
        </div>
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
